#!/usr/bin/env node
/**
 * Discover Bend 2 packages from GitHub.
 *
 * A repo is Bend if any of these hold:
 *   1. pack.json / bend-pack.json at the repo root (opt-in catalog manifest)
 *   2. README contains `import 0x…/file.bend` (published on the hub)
 *   3. the git tree has at least one .bend file, and the repo is tagged
 *      bend / bend2 or describes itself as Bend 2
 *
 * Topics alone are not enough (too many false positives).
 * Curated rows in data/packages.json always win by repo key; scan only
 * backfills a missing import line on those.
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
  /import\s+(0x[0-9a-fA-F]{16,}\/[A-Za-z0-9_./-]+\.bend(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?)/;
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

async function github(url, extra = {}) {
  const res = await fetch(url, { headers: { ...headers, ...extra } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res;
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
  const importMatch = readme.match(IMPORT_RE);
  const importLine = importMatch ? `import ${importMatch[1]}` : null;

  let pack = null;
  for (const file of PACK_FILES) {
    const res = await github(`https://api.github.com/repos/${fullName}/contents/${file}`, {
      Accept: "application/vnd.github.raw",
    });
    if (!res) continue;
    try {
      pack = JSON.parse(await res.text());
      break;
    } catch {
      pack = { name: fullName };
    }
  }

  const treeRes = await github(
    `https://api.github.com/repos/${fullName}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`,
  );
  const tree = treeRes ? await treeRes.json() : { tree: [] };
  const bendFiles = (tree.tree ?? []).filter(
    (entry) => entry.type === "blob" && entry.path.endsWith(".bend"),
  ).length;

  return { importLine: pack?.import || importLine, pack, bendFiles };
}

function isBend(item, inspection) {
  if (inspection.pack) return true;
  if (inspection.importLine) return true;
  if (inspection.bendFiles < 1) return false;
  const topics = new Set(item.topics ?? []);
  const blob = `${item.description ?? ""} ${item.name}`.toLowerCase();
  return topics.has("bend") || topics.has("bend2") || topics.has("bend-lang") || blob.includes("bend 2");
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

  if (!isBend(item, inspection)) continue;

  const pkg = {
    id: repo.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: inspection.pack?.name || item.name,
    repo,
    url: item.html_url,
    description: inspection.pack?.description || item.description || "Bend 2 project discovered from GitHub.",
    category: guessCategory(item, inspection.pack),
    source: inspection.importLine ? "hub" : "git",
    stars: item.stargazers_count ?? 0,
    import: inspection.importLine,
    discovered: true,
    signals: {
      pack: Boolean(inspection.pack),
      hubImport: Boolean(inspection.importLine),
      bendFiles: inspection.bendFiles,
    },
  };
  catalog.packages.push(pkg);
  byRepo.set(repo, pkg);
  added += 1;
}

catalog.generated_at = new Date().toISOString();
writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`scan added ${added} repos, backfilled ${backfilled} imports; catalog now ${catalog.packages.length}`);
