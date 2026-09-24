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
  "boostorg/decimal",
  "developerRafu/lapine",
]);

const GENERIC_HUB_NAMES = new Set([
  "main",
  "test",
  "package",
  "core",
  "hub",
  "lib",
  "app",
  "text",
  "json",
  "decimal",
  "exact",
  "consumer",
  "posix_at",
  "range",
  "queue",
  "stack",
  "tree",
  "bytes",
  "csv",
  "url",
  "http",
  "wire",
  "encoding",
  "router",
  "docs",
  "auth",
  "graph",
  "hex",
  "socket",
  "origin-form",
  "deque",
  "bitset",
  "base64",
  "semver",
  "nonempty",
  "prio",
  "ringbuf",
]);

const FOREIGN_LANG = new Set(["C++", "TypeScript", "Go", "Rust", "Java", "PHP", "Ruby", "Swift", "C#", "Kotlin"]);

function looksLikeBendRepo(item) {
  const topics = (item.topics || []).map((t) => String(t).toLowerCase());
  if (topics.includes("bend") || topics.includes("bend2")) return true;
  const blob = `${item.full_name || ""} ${item.description || ""}`.toLowerCase();
  return /\bbend(\s*2)?\b/.test(blob) || blob.includes("bend-lang") || blob.includes("bend-powered");
}

function rejectForeignRepo(item) {
  if (!item) return true;
  if (skip.has(item.full_name)) return true;
  if (FOREIGN_LANG.has(item.language) && !looksLikeBendRepo(item)) return true;
  const blob = `${item.full_name || ""} ${item.description || ""}`.toLowerCase();
  if (/boostorg|ecko-lang|c\+\+14|ieee 754 decimal/.test(blob) && !looksLikeBendRepo(item)) return true;
  return !looksLikeBendRepo(item) && FOREIGN_LANG.has(item.language || "");
}

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

function importHash(line) {
  const match = String(line || "").match(/0x[0-9a-fA-F]{16,}/);
  return match ? match[0].toLowerCase() : "";
}

function pickHubEntry(files) {
  const paths = Object.keys(files || {});
  const prefs = ["lib.bend", "main.bend", "package.bend"];
  for (const path of prefs) {
    if (paths.includes(path)) return path;
  }
  return paths.find((path) => {
    const base = path.split("/").pop();
    return path.endsWith(".bend") && !/^(LAWS|PROOF|CORRECTNESS)\.bend$/i.test(base);
  }) ?? null;
}

function githubReposIn(text) {
  const out = [];
  for (const match of String(text || "").matchAll(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g)) {
    const repo = match[1].replace(/\.git$/i, "");
    if (!skip.has(repo)) out.push(repo);
  }
  return [...new Set(out)];
}

function titleFromHubFile(text) {
  const line = String(text || "")
    .split("\n")
    .find((row) => /^#\s+\S/.test(row) && !/^#\s*MIT /i.test(row));
  if (!line) return "";
  return line.replace(/^#+\s*/, "").split("—")[0].split("--")[0].trim();
}

function nameFromHub(desc, title, entry) {
  const fromDesc = String(desc || "").match(/^([A-Za-z0-9._-]+)(?:\.bend)?\s*:/);
  if (fromDesc) return fromDesc[1].replace(/\.bend$/, "");
  const fromTitle = title.match(/^([A-Za-z0-9._-]+)\b/);
  if (fromTitle && fromTitle[1].length > 1) return fromTitle[1];
  if (/^dns:/i.test(desc || "")) return "dns";
  if (/fixed-point/i.test(desc || "")) return "fixed";
  if (/web framework/i.test(title) || /^air$/i.test(title.split(/\s/)[0] || "")) return "air";
  return (entry || "package").replace(/\.bend$/, "").split("/").pop();
}

function skipHubPackage(desc, title, bytes, name) {
  const blob = `${desc} ${title} ${name}`.toLowerCase();
  if (/minesweeper|tinychess|glider|lorem ipsum|tile set|hello\b|nested \+ foreign/.test(blob)) return true;
  if (/definitional laws|executable laws|^laws\.bend|hub entry:/.test(blob)) return true;
  if (/grab-bcv|byte-exact tcp|selah-bend/.test(blob)) return true;
  if (/^=+$/.test(String(desc || "").trim())) return true;
  if (/^published on the bend hub\.?$/i.test(String(desc || "").trim())) return true;
  if ((bytes || 0) < 4000) return true;
  const key = String(name || "").toLowerCase();
  if (GENERIC_HUB_NAMES.has(key)) return true;
  if (key.includes(".")) return true;
  return false;
}

async function hubFile(hash, file) {
  const res = await fetch(`https://hub.bend-lang.com/${hash}/${file}`);
  if (!res.ok) return "";
  return res.text();
}

async function repoMeta(fullName) {
  const res = await github(`https://api.github.com/repos/${fullName}`);
  if (!res) return null;
  return res.json();
}

function aliasFromEntry(entry) {
  const base = entry.split("/").pop().replace(/\.bend$/, "");
  return base.replace(/(^|[-_])(\w)/g, (_, __, char) => char.toUpperCase()).replaceAll("-", "");
}

const found = [];
const seenSearch = new Set();
for (const item of [
  ...(await search("topic:bend")),
  ...(await search("topic:bend2")),
  ...(await search('"Bend 2" in:description')),
  ...(await search("filename:pack.json bend")),
  ...(await search("hub.bend-lang.com")),
  ...(await search("user:Giulio2002 bend")),
  ...(await search("user:phenomenon0")),
  ...(await search("user:rootagi bend")),
  ...(await search("user:naoeosavio bend")),
  ...(await search("user:LVTD-LLC bend")),
  ...(await search("user:developerRafu cachet")),
  ...(await search("user:Emerging-Patterns")),
  ...(await search("user:KapioKai bend")),
]) {
  if (seenSearch.has(item.full_name)) continue;
  seenSearch.add(item.full_name);
  found.push(item);
}

const byRepo = new Map(catalog.packages.filter((pkg) => pkg.repo).map((pkg) => [pkg.repo, pkg]));
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

try {
  const index = await fetch("https://hub.bend-lang.com/index.json").then((res) => {
    if (!res.ok) throw new Error(`index.json → ${res.status}`);
    return res.json();
  });
  const byHash = new Map();
  const byName = new Set(catalog.packages.map((pkg) => pkg.name.toLowerCase()));
  for (const pkg of catalog.packages) {
    const hash = importHash(pkg.import);
    if (hash) byHash.set(hash, pkg);
  }
  const newestFirst = [...index].sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
  for (const entry of newestFirst) {
    const hash = String(entry.hash || "").toLowerCase();
    const file = pickHubEntry(entry.files);
    if (!file) continue;
    const line = `import ${hash}/${file} as ${aliasFromEntry(file)}`;
    const existing = byHash.get(hash);
    if (existing) {
      if (!existing.import) {
        existing.import = line;
        existing.source = "hub";
        backfilled += 1;
      }
      continue;
    }

    let text = "";
    try {
      text = await hubFile(hash, file);
    } catch (error) {
      console.warn(`hub file ${hash}/${file}: ${error.message}`);
    }
    const title = titleFromHubFile(text);
    const desc = entry.desc || title || "Published on the Bend hub.";
    if (skipHubPackage(desc, title, entry.bytes)) continue;

    const name = nameFromHub(desc, title, file);
    if (byName.has(name.toLowerCase())) continue;
    if (skipHubPackage(desc, title, entry.bytes, name)) continue;

    let repo = githubReposIn(text)[0] || "";
    let url = `https://hub.bend-lang.com/${hash}/${file}`;
    let stars = 0;
    let description = String(desc).split("\n")[0].slice(0, 180);
    if (repo) {
      try {
        const meta = await repoMeta(repo);
        if (meta && !rejectForeignRepo(meta) && looksLikeBendRepo(meta)) {
          url = meta.html_url;
          stars = meta.stargazers_count ?? 0;
          description = meta.description || description;
        } else {
          repo = "";
        }
      } catch (error) {
        console.warn(`repo ${repo}: ${error.message}`);
        repo = "";
      }
    } else if (!GENERIC_HUB_NAMES.has(name.toLowerCase())) {
      const named = await search(`${name} bend`);
      const hit = named.find((item) => {
        const same = item.name.toLowerCase() === name.toLowerCase() || item.full_name.toLowerCase().endsWith(`/${name.toLowerCase()}`);
        return same && looksLikeBendRepo(item) && !rejectForeignRepo(item) && !skip.has(item.full_name) && !byRepo.has(item.full_name);
      });
      if (hit) {
        repo = hit.full_name;
        url = hit.html_url;
        stars = hit.stargazers_count ?? 0;
        description = hit.description || description;
      }
    }

    if (repo && byRepo.has(repo)) continue;

    const pkg = {
      id: repo ? repo.toLowerCase().replace(/[^a-z0-9]+/g, "-") : `hub-${hash.slice(2, 10)}`,
      name,
      repo,
      url,
      description,
      category: guessCategory({ name, description }, null),
      source: "hub",
      stars,
      import: line,
      discovered: true,
    };
    catalog.packages.push(pkg);
    byHash.set(hash, pkg);
    byName.add(name.toLowerCase());
    if (repo) byRepo.set(repo, pkg);
    added += 1;
  }
} catch (error) {
  console.warn(`hub index: ${error.message}`);
}

catalog.generated_at = new Date().toISOString();
writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`scan added ${added} hub packages, backfilled ${backfilled} imports; catalog now ${catalog.packages.length}`);
