#!/usr/bin/env node
/** Refresh optional GitHub popularity without claiming that catalog content was checked. */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeClient, parallel, writeCatalog } from "./scan.mjs";

export async function refreshStars(catalog, request) {
  const repos = [...new Set(catalog.packages.map((row) => row.repo).filter(Boolean))];
  const results = new Map();
  const unavailable = [];
  let deferRemaining = false;
  await parallel(repos, async (repo) => {
    if (deferRemaining) return;
    try {
      const metadata = JSON.parse((await request("https://api.github.com/repos/" + repo)).toString("utf8"));
      if (!Number.isSafeInteger(metadata.stargazers_count) || metadata.stargazers_count < 0) throw new Error("invalid star count");
      results.set(repo, metadata.stargazers_count);
    } catch (error) {
      unavailable.push(repo + ": " + error.message);
      // Optional popularity must not hold a verified catalog hostage to an outage.
      if (error.temporary || /HTTP (?:401|403|429)/.test(error.message)) deferRemaining = true;
    }
  });
  const updated = {
    ...catalog,
    packages: catalog.packages.map((row) => results.has(row.repo) ? { ...row, stars: results.get(row.repo) } : row),
  };
  return { catalog: updated, checked: results.size, total: repos.length, unavailable };
}

async function main() {
  const path = join(dirname(fileURLToPath(import.meta.url)), "../data/packages.json");
  const catalog = JSON.parse(readFileSync(path, "utf8"));
  const result = await refreshStars(catalog, makeClient());
  writeCatalog(path, result.catalog);
  console.log("GitHub stars refreshed for " + result.checked + "/" + result.total + " repositories. Catalog update date is unchanged.");
  if (result.unavailable.length) {
    console.log("Optional star counts unavailable; existing counts were retained:");
    for (const detail of result.unavailable) console.log("  " + detail.replace(/[\r\n]/g, " "));
  }
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { console.error("Cannot refresh stars: " + error.message); process.exitCode = 1; }
}
