#!/usr/bin/env node
/**
 * Discover Bend 2 packages from GitHub.
 *
 * A repo is listed as Hub only if:
 *   - README or pack.json has `import 0xHASH/file.bend`
 *   - `file.bend` exists in THIS repo (not a dependency of another package)
 *   - https://hub.bend-lang.com/0xHASH/file.bend returns 200
 *
 * pack.json at the repo root is an opt-in manifest; its import still has to
 * pass the same file-in-repo + hub live checks.
 * Curated rows in data/packages.json always win by repo key.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(root, "data/packages.json");
const catalog = JSON.parse(readFileSync(path, "utf8"));
const token = process.env.GITHUB_TOKEN ?? "";
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "bend-packages",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

const IMPORT_RE =
  /import\s+(0x[0-9a-fA-F]{16,})\/([A-Za-z0-9_./-]+\.bend)(\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?/g;
const PACK_FILES = ["pack.json", "bend-pack.json"];

const skip = new Set([
  "bendlang/bend",
  "HigherOrderCO/Bend",
  "HigherOrderCO/Bend1",
  "HigherOrderCO/Bend2",
  "777genius/awesome-bend",
  "777genius/bend-packages",
  "naoeosavio/awesome-bend",
]);

function guessCategory(repo, pack) {
  if (pack?.category) return pack.category;
  const blob = `${repo.name} ${repo.description ?? ""}`.toLowerCase();
  if (blob.includes("lsp") || blob.includes("vscode") || blob.includes("tree-sitter") || blob.includes("emacs") || blob.includes("zed")) {
    return "editors";
  }
  if (blob.includes("nix") || blob.includes("flake")) return "packaging";
  if (blob.includes("tutorial") || blob.includes("from zero") || blob.includes("guide")) return "learning";
  if (blob.includes("demo") || blob.includes("game") || blob.includes("raytrac")) return "demos";
  if (blob.includes("cli") || blob.includes("fuzzer") || blob.includes("linter")) return "tools";
  return "packages";
}

function parseImports(text) {
  const out = [];
  if (!text) return out;
  for (const match of text.matchAll(IMPORT_RE)) {
    out.push({
      hash: match[1],
      file: match[2],
      line: `import ${match[1]}/${match[2]}${match[3] ?? ""}`,
    });
  }
  return out;
}

function fileInTree(file, paths) {
  const want = file.toLowerCase();
  const base = want.split("/").pop();
  return paths.some((entry) => {
    const name = entry.toLowerCase();
    return name === want || name.endsWith(`/${want}`) || name.split("/").pop() === base;
  });
}

async function github(url, extra = {}) {
  const res = await fetch(url, { headers: { ...headers, ...extra } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res;
}

async function hubHas(hash, file) {
  const res = await fetch(`https://hub.bend-lang.com/${hash}/${file}`, { method: "HEAD" });
  return res.ok;
}

async function ownHubImport(candidates, treePaths) {
  for (const item of candidates) {
    if (!fileInTree(item.file, treePaths)) continue;
    if (!(await hubHas(item.hash, item.file))) continue;
    return item.line;
  }
  return null;
}

async function search(q) {
  const res = await github(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=30&sort=updated`,
  );
  const json = await res.json();
  return json.items ?? [];
}

async function inspect(fullName, defaultBranch) {
  const readmeRes = await github(`https://api.github.com/repos/${fullName}/readme`, {
    Accept: "application/vnd.github.raw",
  });
  const readme = readmeRes ? await readmeRes.text() : "";

  let pack = null;
  let packText = "";
  for (const file of PACK_FILES) {
    const res = await github(`https://api.github.com/repos/${fullName}/contents/${file}`, {
      Accept: "application/vnd.github.raw",
    });
    if (!res) continue;
    packText = await res.text();
    try {
      pack = JSON.parse(packText);
    } catch {
      pack = { name: fullName };
    }
    break;
  }

  const treeRes = await github(
    `https://api.github.com/repos/${fullName}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
  );
  const tree = treeRes ? await treeRes.json() : { tree: [] };
  const treePaths = (tree.tree ?? [])
    .filter((entry) => entry.type === "blob" && entry.path.endsWith(".bend"))
    .map((entry) => entry.path);

  const candidates = [...parseImports(pack?.import || packText), ...parseImports(readme)];
  const importLine = await ownHubImport(candidates, treePaths);

  return { importLine, pack, bendFiles: treePaths.length };
}

const found = [];
const seenSearch = new Set();
for (const item of [
  ...(await search("topic:bend")),
  ...(await search("topic:bend2")),
  ...(await search('"Bend 2" in:description')),
  ...(await search("filename:pack.json bend")),
]) {
  if (seenSearch.has(item.full_name)) continue;
  seenSearch.add(item.full_name);
  found.push(item);
}

const byRepo = new Map(catalog.packages.map((pkg) => [pkg.repo, pkg]));
let added = 0;
let backfilled = 0;

for (const item of found) {
  const repo = item.full_name;
  if (skip.has(repo)) continue;
  const blob = `${item.description ?? ""} ${item.name}`.toLowerCase();
  if (blob.includes("hvm2") && !blob.includes("bend 2")) continue;

  let inspection;
  try {
    inspection = await inspect(repo, item.default_branch || "main");
  } catch (error) {
    console.warn(`skip ${repo}: ${error.message}`);
    continue;
  }

  const existing = byRepo.get(repo);
  if (existing) {
    if (!existing.import && inspection.importLine) {
      existing.import = inspection.importLine;
      existing.source = "hub";
      backfilled += 1;
    }
    continue;
  }

  if (!inspection.importLine) continue;

  const pkg = {
    id: repo.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: inspection.pack?.name || item.name,
    repo,
    url: item.html_url,
    description: inspection.pack?.description || item.description || "Bend 2 package published to the hub.",
    category: guessCategory(item, inspection.pack),
    source: "hub",
    stars: item.stargazers_count ?? 0,
    import: inspection.importLine,
    discovered: true,
  };
  catalog.packages.push(pkg);
  byRepo.set(repo, pkg);
  added += 1;
}

catalog.generated_at = new Date().toISOString();
writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`scan added ${added} hub packages, backfilled ${backfilled} imports; catalog now ${catalog.packages.length}`);
