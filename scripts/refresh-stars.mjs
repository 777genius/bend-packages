#!/usr/bin/env node
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

for (const pkg of catalog.packages) {
  if (!pkg.repo || !pkg.repo.includes("/")) continue;
  const res = await fetch(`https://api.github.com/repos/${pkg.repo}`, { headers });
  if (!res.ok) {
    console.warn(`skip ${pkg.repo}: ${res.status}`);
    continue;
  }
  const json = await res.json();
  pkg.stars = json.stargazers_count ?? pkg.stars;
}

catalog.generated_at = new Date().toISOString();
writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`updated ${catalog.packages.length} listings`);
