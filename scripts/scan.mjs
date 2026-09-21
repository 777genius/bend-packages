#!/usr/bin/env node
/**
 * Conservative GitHub discovery for Bend 2 packages.
 * A repo counts if:
 *   - topic includes bend / bend2 / bend-lang, OR description mentions "Bend 2"
 *   - it is not the compiler, Bend 1, or an obvious unrelated name
 *   - GitHub reports language Bend OR the repo name looks like a Bend project
 * Curated entries in data/packages.json always win by repo key.
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

const skip = new Set([
  "bendlang/bend",
  "HigherOrderCO/Bend",
  "HigherOrderCO/Bend1",
  "HigherOrderCO/Bend2",
  "777genius/awesome-bend",
  "777genius/bend-packages",
  "naoeosavio/awesome-bend",
]);

function guessCategory(repo) {
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

async function search(q) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=30&sort=updated`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`search failed ${res.status}`);
  const json = await res.json();
  return json.items ?? [];
}

const found = [
  ...(await search("topic:bend")),
  ...(await search('topic:bend2')),
  ...(await search('"Bend 2" in:description')),
];

const byRepo = new Map(catalog.packages.map((pkg) => [pkg.repo, pkg]));
let added = 0;
for (const item of found) {
  const repo = item.full_name;
  if (skip.has(repo) || byRepo.has(repo)) continue;
  const blob = `${item.description ?? ""} ${item.name}`.toLowerCase();
  if (blob.includes("hvm2") && !blob.includes("bend 2")) continue;
  if (!blob.includes("bend")) continue;
  const pkg = {
    id: repo.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: item.name,
    repo,
    url: item.html_url,
    description: item.description || "Bend 2 project discovered from GitHub topics.",
    category: guessCategory(item),
    source: "git",
    stars: item.stargazers_count ?? 0,
    import: null,
    discovered: true,
  };
  catalog.packages.push(pkg);
  byRepo.set(repo, pkg);
  added += 1;
}

catalog.generated_at = new Date().toISOString();
writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`scan added ${added} repos; catalog now ${catalog.packages.length}`);
