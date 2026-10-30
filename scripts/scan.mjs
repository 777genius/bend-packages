#!/usr/bin/env node
/** Refresh reviewed Awesome Bend entries and official named Hub publications. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, rmSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const HUB = "https://hub.bend-lang.com";
const AWESOME = "https://raw.githubusercontent.com/777genius/awesome-bend/main/README.md";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = join(ROOT, "data/packages.json");
const HASH = /^0x[0-9a-f]{32}$/;
const NAME = /^[a-z][a-z0-9-]{0,63}$/;
const VERSION = /^(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){3}$/;
const ENTRY = /^(?:[A-Za-z_][A-Za-z0-9_-]*\/)*[A-Za-z_][A-Za-z0-9_-]*\.bend$/;
const SECTIONS = { Packages: "packages", Tools: "tools", Packaging: "packaging", Learning: "learning", Demos: "demos" };
const CATEGORIES = new Set([...Object.values(SECTIONS), "editors"]);
const sha = (data) => createHash("sha256").update(data).digest("hex");
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const alias = (path) => path.split("/").at(-1).replace(/\.bend$/, "").replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
const plain = (text) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\`/g, "").trim();
const repoOf = (url) => /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:[/?#]|$)/.exec(url)?.[1] ?? "";
const key = (row) => row.url.replace(/^(https:\/\/github\.com\/[^/?#]+\/[^/?#]+)/i, (repo) => repo.toLowerCase()).replace(/\/$/, "");
const allPublications = (row) => [row, ...(row.additional_imports ?? [])];
const target = (ref) => ref.package + "/" + ref.entry;
const importLine = (ref) => "import " + target(ref) + " as " + ref.alias;
const isPackage = (value) => HASH.test(value) || (typeof value === "string" && NAME.test(value.split("@")[0]) && VERSION.test(value.split("@")[1] ?? "") && value.split("@").length === 2);

export class RefreshError extends Error {
  constructor(message, temporary = false) { super(message); this.temporary = temporary; }
}
const need = (condition, message) => { if (!condition) throw new RefreshError(message); };

export function parseImport(line) {
  const m = /^import\s+([^/\s]+)\/([^\s]+)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*(?:#.*)?$/.exec(String(line).trim());
  need(m && isPackage(m[1]) && ENTRY.test(m[2]), "Invalid Hub import: " + line);
  return { package: m[1], entry: m[2], alias: m[3] ?? alias(m[2]) };
}

export function parseAwesome(text, previous = []) {
  need(/^# Awesome Bend\b/m.test(text) && /^## Contributing\s*$/m.test(text), "Awesome README is missing its expected beginning or end");
  let section = "";
  const seen = new Set();
  const packages = [];
  const references = [];
  const previousByUrl = new Map(previous.map((row) => [key(row), row]));
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("## ")) { section = line.slice(3).trim(); continue; }
    if (!SECTIONS[section] || !line.startsWith("- [")) continue;
    const m = /^- \[([^\]]+)\]\((https:\/\/[^)]+)\) - (.+)$/.exec(line);
    need(m, "Cannot parse Awesome entry: " + line);
    seen.add(section);
    const [, name, url, markdown] = m;
    const old = previousByUrl.get(key({ url }));
    const mentions = [...markdown.matchAll(/\`(import\s+[^\`]+)\`/g)].map((match) => parseImport(match[1]));
    references.push(...mentions);
    const imports = mentions.filter((ref, index) => mentions.findIndex((item) => target(item) === target(ref)) === index);
    const first = imports[0];
    const repo = repoOf(url) || repoOf(/\[repo\]\((https:\/\/[^)]+)\)/.exec(markdown)?.[1] ?? "");
    let category = SECTIONS[section];
    if (category === "tools" && /(?:\blsp\b|\blanguage server\b|tree-sitter|textmate|\b(?:vscode|vs code|emacs|neovim|vim|zed|helix|intellij)\b)/i.test(name + " " + markdown)) category = "editors";
    packages.push({
      id: old?.id ?? "awesome-" + slug(name) + "-" + sha(url).slice(0, 8),
      name, repo, url, description: plain(markdown), category,
      source: first ? "hub" : "git",
      stars: old?.stars ?? previous.find((row) => repo && row.repo?.toLowerCase() === repo.toLowerCase())?.stars ?? null,
      import: first ? importLine(first) : null,
      ...(imports.length > 1 ? { additional_imports: imports.slice(1).map((ref) => ({ import: importLine(ref) })) } : {}),
    });
  }
  need(Object.keys(SECTIONS).every((section) => seen.has(section)), "Awesome README is missing a catalog section");
  need(packages.length > 0, "Awesome README has no catalog entries");
  return { packages, references };
}

function validatePublication(item, label) {
  const publication = item.publication;
  need(publication && isPackage(publication.package) && HASH.test(publication.hash), "Missing or invalid publication: " + label);
  need(!HASH.test(publication.package) || publication.package === publication.hash, "Hash publication disagrees with its package: " + label);
  need(publication.entry === null || ENTRY.test(publication.entry), "Invalid published entry: " + label);
  if (publication.aliases !== undefined) need(Array.isArray(publication.aliases) && new Set(publication.aliases).size === publication.aliases.length && publication.aliases.every((pkg) => isPackage(pkg) && !HASH.test(pkg) && pkg !== publication.package), "Invalid publication aliases: " + label);
  if (publication.entry === null) need(item.import === null, "A publication without an entry must not offer an import: " + label);
  else {
    const parsed = parseImport(item.import);
    need(/\sas\s/.test(item.import) && parsed.package === publication.package && parsed.entry === publication.entry, "Import disagrees with its publication: " + label);
  }
}

export function validateCatalog(catalog) {
  need(catalog && Array.isArray(catalog.packages) && catalog.packages.length > 0, "Catalog must contain packages");
  need(typeof catalog.generated_at === "string" && Number.isFinite(Date.parse(catalog.generated_at)), "Catalog needs a valid generated_at timestamp");
  const ids = new Set();
  for (const row of catalog.packages) {
    need(typeof row.id === "string" && row.id && !ids.has(row.id), "Missing or duplicate catalog id: " + row.id);
    ids.add(row.id);
    need(typeof row.name === "string" && row.name.trim() && typeof row.description === "string", "Invalid name or description: " + row.id);
    need(CATEGORIES.has(row.category) && ["hub", "git"].includes(row.source), "Invalid category or source: " + row.id);
    need(typeof row.url === "string" && /^https:\/\/[^/\s]+(?:\/\S*)?$/.test(row.url), "Invalid URL: " + row.id);
    need(typeof row.repo === "string" && (!row.repo || /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(row.repo)), "Invalid repository: " + row.id);
    need(row.stars === null || Number.isSafeInteger(row.stars) && row.stars >= 0, "Invalid stars: " + row.id);
    if (row.source === "git") {
      need(row.import === null && row.publication === undefined && row.additional_imports === undefined, "Source-only row must not claim a publication: " + row.id);
      continue;
    }
    validatePublication(row, row.id);
    if (row.additional_imports !== undefined) {
      need(row.import && Array.isArray(row.additional_imports) && row.additional_imports.length > 0, "Additional imports need a primary import and a nonempty list: " + row.id);
      const offered = new Set([target(parseImport(row.import))]);
      for (const item of row.additional_imports) {
        need(item && typeof item.import === "string" && item.import, "Invalid additional import: " + row.id);
        validatePublication(item, row.id);
        const imported = target(parseImport(item.import));
        need(!offered.has(imported), "Duplicate import on a catalog listing: " + row.id);
        offered.add(imported);
      }
    }
  }
  return catalog;
}

export function makeClient({ fetchImpl = fetch, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  const cache = new Map();
  return function request(url) {
    if (!cache.has(url)) cache.set(url, (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        let temporary = false;
        let detail = "";
        let retryAfter = "";
        try {
          const headers = { "User-Agent": "bend-packages-catalog/2" };
          if (new URL(url).origin === "https://api.github.com") {
            headers.Accept = "application/vnd.github+json";
            if (process.env.GITHUB_TOKEN) headers.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
          }
          const response = await fetchImpl(url, { headers, redirect: "error", signal: AbortSignal.timeout(10000) });
          if (!response.ok) {
            temporary = [408, 425, 429].includes(response.status) || response.status >= 500;
            retryAfter = response.headers.get("retry-after") ?? "";
            detail = "HTTP " + response.status;
            await response.body?.cancel();
            if (!temporary && response.status !== 404) throw new RefreshError(url + ": " + detail);
          } else {
            const chunks = [];
            let bytes = 0;
            for await (const chunk of response.body) {
              bytes += chunk.length;
              need(bytes <= 4 * 1024 * 1024, "Response too large: " + url);
              chunks.push(Buffer.from(chunk));
            }
            return Buffer.concat(chunks);
          }
        } catch (error) {
          if (error instanceof RefreshError) throw error;
          temporary = true;
          detail = error.message;
        }
        if (attempt === 2) throw new RefreshError(url + ": " + detail, temporary);
        let delay = (attempt + 1) * 1000;
        if (retryAfter.trim()) {
          const seconds = retryAfter.trim().replace(/^0+/, "") || "0";
          if (!/^[0-9]{1,2}$/.test(seconds) || Number(seconds) > 10) throw new RefreshError(url + ": " + detail + "; retry deferred for Retry-After", temporary);
          delay = Number(seconds) * 1000;
        }
        await sleep(delay);
      }
    })());
    return cache.get(url);
  };
}

function json(data, context) {
  try { return JSON.parse(data.toString("utf8")); }
  catch { throw new RefreshError("Invalid JSON: " + context); }
}

export async function parallel(items, task) {
  let next = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await task(items[index]); }
  }));
  return results;
}

export async function loadRegistry(request) {
  const packages = [];
  const hashes = new Set();
  let total;
  for (let after = 0; total === undefined || after < total; after += 100) {
    const page = json(await request(HUB + "/packages.json?sort=new&limit=100&after=" + after), "Hub package page");
    need(Number.isSafeInteger(page.total) && page.total > 0 && Array.isArray(page.packages), "Malformed Hub package page");
    if (total === undefined) total = page.total;
    if (page.total !== total) throw new RefreshError("Hub inventory changed during pagination; retry the refresh", true);
    need(page.packages.length > 0 && page.packages.length <= 100, "Hub pagination ended before the reported total");
    for (const pkg of page.packages) {
      need(HASH.test(pkg.hash) && !hashes.has(pkg.hash), "Malformed or duplicate Hub publication");
      hashes.add(pkg.hash); packages.push(pkg);
    }
  }
  need(packages.length === total, "Hub inventory count disagrees with its reported total");
  return packages;
}

export async function verifyPublication(ref, request, expectedHash) {
  need(isPackage(ref.package) && (ref.entry === null || ENTRY.test(ref.entry)), "Invalid publication reference");
  const packageHash = HASH.test(ref.package) ? ref.package : (await request(HUB + "/name/" + ref.package)).toString("utf8").trim();
  need(HASH.test(packageHash) && (!expectedHash || expectedHash === packageHash), "Invalid or inconsistent published hash: " + ref.package);
  const manifest = await request(HUB + "/" + packageHash + "/manifest");
  need(sha(manifest).slice(0, 32) === packageHash.slice(2), "Manifest checksum mismatch: " + ref.package);
  const records = new Map();
  const lines = manifest.toString("utf8").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const m = /^([0-9a-f]{64}) (.+)$/.exec(line);
    need(m && m[2].split("/").every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && ![".", ".."].includes(part)) && !records.has(m[2]), "Invalid manifest: " + ref.package);
    records.set(m[2], m[1]);
  }
  need(records.size > 0, "Empty manifest: " + ref.package);
  if (ref.entry !== null) {
    need(ENTRY.test(ref.entry) && records.has(ref.entry), "Entry is absent from the published manifest: " + ref.package + "/" + ref.entry);
    need(sha(await request(HUB + "/" + packageHash + "/" + ref.entry)) === records.get(ref.entry), "File checksum mismatch: " + ref.package + "/" + ref.entry);
  }
  return { package: ref.package, hash: packageHash, entry: ref.entry };
}

async function collect(items, task, failures) {
  return parallel(items, async (item) => {
    // A failed source already prevents publication; avoid hundreds of redundant retries.
    if (failures.length) return null;
    try { return await task(item); }
    catch (error) { failures.push(error); return null; }
  });
}

function requireComplete(failures) {
  if (failures.length) {
    const error = new RefreshError("Refresh incomplete; the previous catalog is unchanged.", failures.every((item) => item.temporary));
    error.details = failures.map((item) => item.message);
    throw error;
  }
}

export async function refreshCatalog(catalog, awesomeText, request, now = new Date().toISOString()) {
  const curated = parseAwesome(awesomeText, catalog.packages);
  const inventory = await loadRegistry(request);
  const byHash = new Map(inventory.map((row) => [row.hash, row]));
  const names = new Set(inventory.map((row) => row.name).filter(Boolean));
  for (const ref of curated.references) if (!HASH.test(ref.package)) names.add(ref.package.split("@")[0]);
  for (const row of catalog.packages) for (const item of allPublications(row)) {
    const pkg = item.publication?.package ?? (item.import ? parseImport(item.import).package : null);
    for (const known of [pkg, ...(item.publication?.aliases ?? [])]) {
      if (known && !HASH.test(known)) names.add(known.split("@")[0]);
    }
  }
  const failures = [];
  const metadata = await collect([...names].sort(), async (name) => {
    need(NAME.test(name), "Invalid published name");
    const result = json(await request(HUB + "/name/" + name), name);
    const latest = result?.latest;
    need(result?.name === name && latest && VERSION.test(latest.version) && HASH.test(latest.hash) && typeof latest.desc === "string" && typeof latest.entry === "string", "Invalid latest publication: " + name);
    need(latest.entry === "" || ENTRY.test(latest.entry), "Invalid published entry: " + name);
    return { name, ...latest, owner: result.owner_login ?? "" };
  }, failures);
  requireComplete(failures);
  const publications = await collect(curated.references, (ref) => verifyPublication(ref, request), failures);
  requireComplete(failures);
  const verified = new Map(curated.references.map((ref, index) => [target(ref), publications[index]]));
  const usedHashes = new Set(publications.map((publication) => publication.hash));
  const usedNames = new Set(curated.references.filter((ref) => !HASH.test(ref.package)).map((ref) => ref.package.split("@")[0]));
  const byName = new Map(metadata.map((item) => [item.name, item]));
  const attachReviewedPublication = (item) => {
    const ref = parseImport(item.import);
    return { ...item, publication: { ...verified.get(target(ref)), owner: byName.get(ref.package.split("@")[0])?.owner ?? "" } };
  };
  const rows = curated.packages.map((row) => !row.import ? row : {
    ...attachReviewedPublication(row),
    ...(row.additional_imports ? { additional_imports: row.additional_imports.map(attachReviewedPublication) } : {}),
  });
  const curatedUrls = new Set(rows.map(key));
  let kept = 0;
  const previousNamed = new Map();
  for (const row of catalog.packages) {
    if (curatedUrls.has(key(row))) continue;
    const pkg = row.publication?.package ?? (row.import ? parseImport(row.import).package : null);
    const name = pkg && (HASH.test(pkg) ? byHash.get(pkg)?.name : pkg.split("@")[0]);
    // Preserve reviewed repository associations; never invent one from a name or publisher login.
    if (name && row.repo) previousNamed.set(name, row);
    if (row.import) {
      const ref = parseImport(row.import);
      if (!HASH.test(ref.package) || byHash.get(ref.package)?.name || usedHashes.has(ref.package)) continue;
      const retained = await collect(allPublications(row), async (item) => {
        const ref = parseImport(item.import);
        const publication = await verifyPublication(ref, request);
        return { import: item.import, publication: { ...publication, owner: byName.get(ref.package.split("@")[0])?.owner ?? "" } };
      }, failures);
      if (retained.every(Boolean)) {
        rows.push({ ...row, ...retained[0], ...(retained.length > 1 ? { additional_imports: retained.slice(1) } : {}) });
        for (const item of retained) {
          usedHashes.add(item.publication.hash);
          if (!HASH.test(item.publication.package)) usedNames.add(item.publication.package.split("@")[0]);
        }
        kept++;
      }
    } else if (row.source === "git") { rows.push({ ...row }); kept++; }
  }
  const candidates = metadata.filter((item) => !usedNames.has(item.name) && !usedHashes.has(item.hash));
  const named = await collect(candidates, async (item) => {
    const publication = await verifyPublication({ package: item.name + "@" + item.version, entry: item.entry || null }, request, item.hash);
    const previous = previousNamed.get(item.name);
    return {
      id: previous?.id ?? "hub-" + item.name, name: item.name, repo: previous?.repo ?? "", url: previous?.url ?? HUB + "/n/" + item.name,
      description: item.desc.trim() || "Named package published on BendHub. Check its documentation and compiler requirements on the Hub.",
      category: previous?.category ?? "packages", source: "hub", stars: previous?.stars ?? null,
      import: item.entry ? "import " + publication.package + "/" + item.entry + " as " + alias(item.entry) : null,
      publication: { ...publication, owner: item.owner },
    };
  }, failures);
  requireComplete(failures);
  const uniqueNamed = new Map();
  for (const row of named) {
    const previous = uniqueNamed.get(row.publication.hash);
    const preferredName = byHash.get(row.publication.hash)?.name;
    if (!previous || row.repo && !previous.repo || Boolean(row.repo) === Boolean(previous.repo) && row.name === preferredName) {
      uniqueNamed.set(row.publication.hash, row);
    }
  }
  rows.push(...uniqueNamed.values());
  const aliasesByHash = new Map();
  for (const item of metadata) {
    const aliases = aliasesByHash.get(item.hash) ?? [];
    aliases.push(item.name + "@" + item.version);
    aliasesByHash.set(item.hash, aliases);
  }
  for (const row of rows) for (const item of allPublications(row)) if (item.publication) {
    const aliases = (aliasesByHash.get(item.publication.hash) ?? []).filter((pkg) => pkg !== item.publication.package).sort();
    if (aliases.length) item.publication.aliases = aliases;
    else delete item.publication.aliases;
  }
  const offered = new Set(rows.flatMap(allPublications).filter((item) => item.import).map((item) => target(parseImport(item.import))));
  need(curated.references.every((ref) => offered.has(target(ref))), "A reviewed import is missing from the copyable catalog");
  const result = {
    generated_at: now,
    disclaimer: "Community catalog. Not affiliated with bendlang. Publication and file integrity do not establish compiler compatibility.",
    packages: rows,
  };
  validateCatalog(result);
  return { catalog: result, summary: curated.packages.length + " Awesome entries with " + curated.references.length + " reviewed imports; " + uniqueNamed.size + " named Hub listings; " + kept + " other reviewed listings retained; " + inventory.length + " Hub publications inspected." };
}

export function writeCatalog(path, catalog) {
  const temporary = path + ".tmp-" + process.pid;
  try { writeFileSync(temporary, JSON.stringify(catalog, null, 2) + "\n"); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}

export async function refreshToFile(catalog, awesomeText, request, path) {
  const result = await refreshCatalog(catalog, awesomeText, request);
  writeCatalog(path, result.catalog);
  return result;
}

function output(message, error) {
  const details = error?.details ?? (error ? [error.message] : []);
  const safe = (text) => text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  if (error && process.env.GITHUB_ACTIONS === "true") console.log("::" + (error.temporary ? "warning" : "error") + "::" + safe(message));
  else console.log(message);
  for (const detail of details) console.log("  " + detail.replace(/[\r\n]/g, " "));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const escaped = details.join("\n").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, "# Catalog refresh\n\n" + message + "\n\n" + (details.length ? "<details><summary>Details</summary><pre>" + escaped + "</pre></details>\n" : "")); }
    catch (summaryError) { console.error("Cannot write job summary: " + summaryError.message); return false; }
  }
  return true;
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs({ args: argv, options: { check: { type: "boolean" }, help: { type: "boolean" }, "awesome-readme": { type: "string" }, output: { type: "string" } } }).values;
  } catch (error) { console.error(error.message + "\nUse --help for usage."); return 2; }
  if (options.help) {
    console.log("Usage: node scripts/scan.mjs [--check] [--awesome-readme PATH] [--output PATH]\n\n--check validates the saved catalog offline.\nRefresh synchronizes Awesome Bend, reads official Hub metadata, and verifies publication manifests and any offered import files. It never installs or executes packages.\n--awesome-readme uses a reviewed local README. --output writes a preview elsewhere.\nExit codes: 0 complete, 1 invalid input/publication/integrity, 2 arguments, 3 temporary source failure. A failed refresh leaves the previous catalog unchanged.");
    return 0;
  }
  try {
    const catalog = JSON.parse(readFileSync(CATALOG, "utf8"));
    if (options.check) { validateCatalog(catalog); console.log("Catalog valid: " + catalog.packages.length + " listings; no network requests."); return 0; }
    const request = makeClient();
    const awesome = options["awesome-readme"] ? readFileSync(options["awesome-readme"], "utf8") : (await request(AWESOME)).toString("utf8");
    const result = await refreshToFile(catalog, awesome, request, options.output ?? CATALOG);
    return output("**Refresh complete.** " + result.summary) ? 0 : 1;
  } catch (error) {
    const reported = output("**Refresh incomplete.** Previous catalog and its update date are unchanged. " + (error.temporary ? "A source is temporarily unavailable; retry later." : "Inspect the input or publication error."), error);
    return reported && error.temporary ? 3 : 1;
  }
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) process.exitCode = await main();
