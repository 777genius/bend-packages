import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HUB, RefreshError, parseAwesome, parseImport, validateCatalog, makeClient, loadRegistry, verifyPublication, refreshCatalog, refreshToFile } from "../scripts/scan.mjs";
import { refreshStars } from "../scripts/refresh-stars.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const code = Buffer.from("def main = 42\n");
const manifest = Buffer.from(digest(code) + " main.bend\n" + digest(code) + " src/lib.bend\n");
const hash = "0x" + digest(manifest).slice(0, 32);
const otherManifest = Buffer.from(digest(code) + " other.bend\n");
const otherHash = "0x" + digest(otherManifest).slice(0, 32);
const entry = (id, url = "https://github.com/owner/" + id) => ({ id, name: id, repo: "owner/" + id, url, description: "Reviewed source.", category: "packages", source: "git", stars: 2, import: null });
const existing = { generated_at: "2026-01-01T00:00:00Z", packages: [entry("reviewed")] };
const tick = String.fromCharCode(96);
const awesome = (primary = "import reviewed@1.0.0.0/main.bend") => [
  "# Awesome Bend",
  "## Packages",
  "- [reviewed](https://github.com/owner/reviewed) - Current description. " + tick + primary + tick + "; requires compiler 2.0.36.",
  "## Tools",
  "- [tool](https://github.com/owner/reviewed/tree/main/tool) - Different resource in the same repo.",
  "## Packaging",
  "- [pack](https://github.com/owner/pack) - Packaging.",
  "## Learning",
  "- [guide](https://example.com/guide) - Learning.",
  "## Demos",
  "- [demo](https://github.com/owner/demo) - Demo.",
  "## Contributing",
].join("\n");
function fixture() {
  const data = new Map([
    [HUB + "/packages.json?sort=new&limit=100&after=0", Buffer.from(JSON.stringify({ total: 2, packages: [{ hash, name: "reviewed" }, { hash: otherHash, name: "discovered" }] }))],
    [HUB + "/name/reviewed", Buffer.from(JSON.stringify({ name: "reviewed", owner_login: "owner", latest: { version: "2.0.0.0", hash, desc: "Newer unreviewed version.", entry: "main.bend" } }))],
    [HUB + "/name/discovered", Buffer.from(JSON.stringify({ name: "discovered", owner_login: "owner", latest: { version: "1.0.0.0", hash: otherHash, desc: "Official description.", entry: "" } }))],
    [HUB + "/name/reviewed@1.0.0.0", Buffer.from(hash)],
    [HUB + "/name/reviewed@2.0.0.0", Buffer.from(hash)],
    [HUB + "/name/discovered@1.0.0.0", Buffer.from(otherHash)],
    [HUB + "/" + hash + "/manifest", manifest],
    [HUB + "/" + hash + "/main.bend", code],
    [HUB + "/" + hash + "/src/lib.bend", code],
    [HUB + "/" + otherHash + "/manifest", otherManifest],
    [HUB + "/" + otherHash + "/other.bend", code],
  ]);
  const seen = [];
  const request = async (url) => { seen.push(url); assert.ok(data.has(url), "Unexpected request: " + url); return data.get(url); };
  return { data, seen, request };
}

test("curated descriptions and exact pins update; same-repo subdirectories remain separate", () => {
  const parsed = parseAwesome(awesome("import reviewed@1.0.0.0/src/lib.bend"), existing.packages);
  assert.equal(parsed.packages.length, 5);
  assert.equal(parsed.packages[0].id, "reviewed");
  assert.match(parsed.packages[0].description, /compiler 2.0.36/);
  assert.equal(parsed.packages[0].import, "import reviewed@1.0.0.0/src/lib.bend as Lib");
  assert.notEqual(parsed.packages[0].id, parsed.packages[1].id);
  assert.equal(parsed.packages[1].repo, "owner/reviewed");
  const distinctPaths = [entry("lower", "https://github.com/owner/reviewed/tree/main/tool"), entry("upper", "https://github.com/owner/reviewed/tree/main/Tool")];
  assert.equal(parseAwesome(awesome(), distinctPaths).packages[1].id, "lower");
  assert.throws(() => parseAwesome(awesome().replace("## Contributing", "")), /beginning or end/);
  assert.throws(() => parseAwesome(awesome().replace("## Tools", "## Unknown")), /missing a catalog section/);
});

test("malformed imports are rejected rather than silently becoming source-only", () => {
  assert.equal(parseImport("import reviewed@1.0.0.0/src/lib.bend as Lib# comment").entry, "src/lib.bend");
  for (const value of ["import reviewed@latest/main.bend", "import reviewed@1.0/main.bend", "import 0xdead/main.bend", "import reviewed@1.0.0.0/../main.bend"]) {
    assert.throws(() => parseImport(value), /Invalid Hub import/);
  }
});

test("full refresh preserves a reviewed older pin and does not invent a missing entry", async () => {
  const { request, seen } = fixture();
  const snapshot = structuredClone(existing);
  const result = await refreshCatalog(existing, awesome(), request, "2026-10-30T00:00:00Z");
  assert.deepEqual(existing, snapshot);
  assert.equal(result.catalog.generated_at, "2026-10-30T00:00:00Z");
  const reviewed = result.catalog.packages.find((row) => row.name === "reviewed");
  assert.equal(reviewed.publication.package, "reviewed@1.0.0.0");
  assert.equal(reviewed.latest_import, "import reviewed@2.0.0.0/main.bend as Main");
  assert.equal(reviewed.hub.name, "reviewed");
  assert.equal(reviewed.hub.latest.version, "2.0.0.0");
  assert.equal(reviewed.hub.latest.hash, hash);
  assert.equal(result.catalog.packages.filter((row) => row.name === "reviewed").length, 1);
  const found = result.catalog.packages.find((row) => row.name === "discovered");
  assert.equal(found.import, null);
  assert.equal(found.publication.entry, null);
  assert.equal(found.publication.hash, otherHash);
  assert.ok(!seen.includes(HUB + "/" + otherHash + "/other.bend"));
  validateCatalog(result.catalog);
  const second = await refreshCatalog(result.catalog, awesome(), request, result.catalog.generated_at);
  assert.deepEqual(second.catalog, result.catalog, "A second refresh must preserve the same inventory");
  assert.throws(() => validateCatalog({ ...result.catalog, packages: [{ ...found, import: "import discovered@1.0.0.0/other.bend as Other" }] }), /without an entry/);
});

test("a newer official version is not copied when the reviewed module path disappeared", async () => {
  const { request, data } = fixture();
  const latest = JSON.parse(data.get(HUB + "/name/reviewed"));
  latest.latest = { version: "2.0.0.0", hash: otherHash, desc: "New layout.", entry: "other.bend" };
  data.set(HUB + "/name/reviewed", Buffer.from(JSON.stringify(latest)));
  data.set(HUB + "/name/reviewed@2.0.0.0", Buffer.from(otherHash));
  const result = await refreshCatalog(existing, awesome(), request);
  const reviewed = result.catalog.packages.find((row) => row.name === "reviewed");
  assert.equal(reviewed.latest_import, undefined);
  assert.equal(reviewed.hub.latest.version, "2.0.0.0");
  assert.equal(reviewed.hub.latest.entry, "other.bend");
  assert.equal(reviewed.import, "import reviewed@1.0.0.0/main.bend as Main");
  validateCatalog(result.catalog);
});

test("standalone reviewed hash packages survive without inferring identity from display names", async () => {
  const { request } = fixture();
  const row = { ...entry("standalone"), name: "reviewed", source: "hub", import: "import " + otherHash + "/other.bend as Other" };
  const calls = async (url) => url.includes("/packages.json?") ? Buffer.from(JSON.stringify({ total: 1, packages: [{ hash, name: "reviewed" }] })) : request(url);
  const result = await refreshCatalog({ ...existing, packages: [...existing.packages, row] }, awesome(), calls);
  assert.ok(result.catalog.packages.some((item) => item.id === "standalone" && item.publication.hash === otherHash));
});

test("complete manifest and referenced file hashes are required", async () => {
  const { request, data } = fixture();
  assert.equal((await verifyPublication({ package: "reviewed@1.0.0.0", entry: "src/lib.bend" }, request)).hash, hash);
  await assert.rejects(() => verifyPublication({ package: hash, entry: "missing.bend" }, request), /absent/);
  data.set(HUB + "/" + hash + "/main.bend", Buffer.from("corrupt"));
  await assert.rejects(() => verifyPublication({ package: hash, entry: "main.bend" }, request), /File checksum/);
  data.set(HUB + "/" + hash + "/manifest", Buffer.from("corrupt"));
  await assert.rejects(() => verifyPublication({ package: hash, entry: null }, request), /Manifest checksum/);
});

test("pagination never treats an incomplete or changing inventory as complete", async () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({ hash: "0x" + index.toString(16).padStart(32, "0") }));
  const good = async (url) => Buffer.from(JSON.stringify(url.endsWith("after=0") ? { total: 101, packages: rows } : { total: 101, packages: [{ hash }] }));
  assert.equal((await loadRegistry(good)).length, 101);
  for (const second of [{ total: 101, packages: [] }, { total: 101, packages: [rows[0]] }, { total: 102, packages: [{ hash }] }]) {
    await assert.rejects(() => loadRegistry(async (url) => url.endsWith("after=0") ? good(url) : Buffer.from(JSON.stringify(second))), RefreshError);
  }
});

test("temporary upstream and integrity failures preserve the exact previous file and date", async () => {
  const folder = mkdtempSync(join(tmpdir(), "bend-catalog-"));
  const path = join(folder, "packages.json");
  const original = JSON.stringify(existing) + "\n";
  try {
    writeFileSync(path, original);
    await assert.rejects(() => refreshToFile(existing, awesome(), async () => { throw new RefreshError("Hub unavailable", true); }, path), (error) => error.temporary);
    assert.equal(readFileSync(path, "utf8"), original);
    const { request, data } = fixture();
    data.set(HUB + "/" + hash + "/main.bend", Buffer.from("corrupt"));
    await assert.rejects(() => refreshToFile(existing, awesome(), request, path), (error) => !error.temporary);
    assert.equal(readFileSync(path, "utf8"), original);
    const success = fixture();
    await refreshToFile(existing, awesome(), success.request, path);
    validateCatalog(JSON.parse(readFileSync(path, "utf8")));
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("transport retries short failures, caches successes, and respects a requested later retry", async () => {
  let calls = 0;
  const delays = [];
  const client = makeClient({ fetchImpl: async () => ++calls === 1 ? new Response("", { status: 503 }) : new Response("ok"), sleep: async (ms) => delays.push(ms) });
  assert.equal((await client(HUB + "/sample")).toString(), "ok");
  await client(HUB + "/sample");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1000]);
  calls = 0;
  delays.length = 0;
  const shortWait = makeClient({ fetchImpl: async () => ++calls === 1 ? new Response("", { status: 503, headers: { "Retry-After": "5" } }) : new Response("ok"), sleep: async (ms) => delays.push(ms) });
  await shortWait(HUB + "/short");
  assert.deepEqual(delays, [5000]);
  calls = 0;
  const limited = makeClient({ fetchImpl: async () => { calls++; return new Response("", { status: 429, headers: { "Retry-After": "60" } }); }, sleep: async () => assert.fail("must defer") });
  await assert.rejects(() => limited(HUB + "/limited"), (error) => error.temporary);
  assert.equal(calls, 1);
  const absent = makeClient({ fetchImpl: async () => new Response("", { status: 404 }), sleep: async () => {} });
  await assert.rejects(() => absent(HUB + "/missing"), (error) => !error.temporary);
});

test("star updates deduplicate repositories, retain failures, and never change catalog freshness", async () => {
  const catalog = { ...existing, packages: [entry("one"), { ...entry("two"), repo: "owner/one" }, entry("three")] };
  const calls = [];
  const result = await refreshStars(catalog, async (url) => {
    calls.push(url);
    if (url.endsWith("/three")) throw new RefreshError("rate limited", true);
    return Buffer.from(JSON.stringify({ stargazers_count: 23 }));
  });
  assert.equal(calls.length, 2);
  assert.equal(result.catalog.generated_at, existing.generated_at);
  assert.deepEqual(result.catalog.packages.map((row) => row.stars), [23, 23, 2]);
  assert.equal(result.unavailable.length, 1);
});

test("an upstream outage stops queued lookups instead of retrying the entire catalog", async () => {
  const records = Array.from({ length: 100 }, (_, index) => ({ hash: "0x" + index.toString(16).padStart(32, "0"), name: "library-" + index }));
  let requests = 0;
  await assert.rejects(() => refreshCatalog(existing, awesome(), async (url) => {
    if (url.includes("/packages.json?")) return Buffer.from(JSON.stringify({ total: 100, packages: records }));
    requests++;
    throw new RefreshError("source unavailable", true);
  }), (error) => error.temporary);
  assert.ok(requests <= 4);
  requests = 0;
  const catalog = { ...existing, packages: Array.from({ length: 100 }, (_, index) => entry("repo-" + index)) };
  const stars = await refreshStars(catalog, async () => {
    requests++;
    throw new RefreshError("source unavailable", true);
  });
  assert.ok(requests <= 4);
  assert.deepEqual(stars.catalog, catalog);
});

test("reviewed named repository bindings survive even when publisher login differs from its organization", async () => {
  const { request } = fixture();
  const linked = { ...entry("old-display-name", "https://github.com/organization/library"), repo: "organization/library", stars: 7, source: "hub", import: "import " + otherHash + "/other.bend as Other" };
  const result = await refreshCatalog({ ...existing, packages: [...existing.packages, linked] }, awesome(), request);
  const row = result.catalog.packages.find((item) => item.name === "discovered");
  assert.equal(row.repo, "organization/library");
  assert.equal(row.url, "https://github.com/organization/library");
  assert.equal(row.stars, 7);
  assert.equal(row.publication.owner, "owner");
  assert.equal(row.publication.package, "discovered@1.0.0.0");
  assert.equal(row.import, null);
  const second = await refreshCatalog(result.catalog, awesome(), request, result.catalog.generated_at);
  assert.deepEqual(second.catalog, result.catalog);
});

test("a separate unnamed module is retained alongside a curated project in the same repository", async () => {
  const { request } = fixture();
  const row = { ...entry("second-module", "https://github.com/owner/reviewed/tree/main/second"), repo: "owner/reviewed", source: "hub", import: "import " + otherHash + "/other.bend as Other" };
  const calls = async (url) => url.includes("/packages.json?") ? Buffer.from(JSON.stringify({ total: 1, packages: [{ hash, name: "reviewed" }] })) : request(url);
  const result = await refreshCatalog({ ...existing, packages: [...existing.packages, row] }, awesome(), calls);
  assert.ok(result.catalog.packages.some((item) => item.id === "second-module" && item.publication.hash === otherHash));
});

test("aliases of the same latest publication share one card and remain discoverable", async () => {
  const { request, data } = fixture();
  data.set(HUB + "/packages.json?sort=new&limit=100&after=0", Buffer.from(JSON.stringify({ total: 3, packages: [{ hash, name: "reviewed" }, { hash: otherHash, name: "discovered" }, { hash: "0x" + "3".repeat(32), name: "also-discovered" }] })));
  data.set(HUB + "/name/also-discovered", Buffer.from(JSON.stringify({ name: "also-discovered", owner_login: "owner", latest: { version: "1.0.0.0", hash: otherHash, desc: "Another alias.", entry: "" } })));
  data.set(HUB + "/name/also-discovered@1.0.0.0", Buffer.from(otherHash));
  const result = await refreshCatalog(existing, awesome(), request);
  const same = result.catalog.packages.filter((row) => row.publication?.hash === otherHash);
  assert.equal(same.length, 1);
  assert.equal(same[0].name, "discovered");
  assert.deepEqual(same[0].publication.aliases, ["also-discovered@1.0.0.0"]);
  assert.deepEqual((await refreshCatalog(result.catalog, awesome(), request, result.catalog.generated_at)).catalog, result.catalog);
});

test("a non-ASCII alias response cannot be normalized into an otherwise valid hash", async () => {
  const { request, data } = fixture();
  const invalid = Buffer.from(hash);
  invalid[4] += 128;
  data.set(HUB + "/name/reviewed@1.0.0.0", invalid);
  await assert.rejects(() => verifyPublication({ package: "reviewed@1.0.0.0", entry: "main.bend" }, request), /Invalid or inconsistent published hash/);
});

test("every reviewed module remains copyable on one card, with exact secondary pins across refreshes", async () => {
  const { request, data, seen } = fixture();
  const imports = [
    "import reviewed@1.0.0.0/main.bend as Main",
    "import discovered@0.5.0.0/other.bend as Other",
    "import reviewed@1.0.0.0/src/lib.bend as Lib",
  ];
  const source = awesome(imports.join(tick + "; " + tick));
  const repeated = parseAwesome(awesome([...imports, "import reviewed@1.0.0.0/main.bend as Repeated"].join(tick + "; " + tick))).packages[0];
  assert.equal(repeated.import, imports[0], "Repeated mentions must preserve the first import alias");
  assert.equal(repeated.additional_imports.length, 2);
  data.set(HUB + "/name/discovered@0.5.0.0", Buffer.from(otherHash));
  const nextCode = Buffer.from("def main = 43\n");
  const nextManifest = Buffer.from(digest(nextCode) + " other.bend\n");
  const nextHash = "0x" + digest(nextManifest).slice(0, 32);
  const latest = JSON.parse(data.get(HUB + "/name/discovered"));
  latest.latest.hash = nextHash;
  latest.latest.entry = "other.bend";
  data.set(HUB + "/name/discovered", Buffer.from(JSON.stringify(latest)));
  data.set(HUB + "/name/discovered@1.0.0.0", Buffer.from(nextHash));
  data.set(HUB + "/" + nextHash + "/manifest", nextManifest);
  data.set(HUB + "/" + nextHash + "/other.bend", nextCode);
  const result = await refreshCatalog(existing, source, request, "2026-10-30T00:00:00Z");
  const row = result.catalog.packages.find((item) => item.id === "reviewed");
  const offered = [row, ...row.additional_imports];
  assert.equal(result.catalog.packages.length, 5, "Secondary modules must not create duplicate project cards");
  assert.deepEqual(offered.map((item) => item.import), imports);
  assert.deepEqual(offered.map((item) => [item.publication.package, item.publication.entry, item.publication.hash]), [
    ["reviewed@1.0.0.0", "main.bend", hash],
    ["discovered@0.5.0.0", "other.bend", otherHash],
    ["reviewed@1.0.0.0", "src/lib.bend", hash],
  ]);
  assert.equal(offered.length, parseAwesome(source).references.length, "Every source reference needs a copyable import");
  assert.deepEqual(row.additional_imports[1].publication.aliases, ["reviewed@2.0.0.0"]);
  assert.equal(row.additional_imports[0].latest_import, "import discovered@1.0.0.0/other.bend as Other");
  assert.ok(seen.includes(HUB + "/name/discovered@1.0.0.0"), "Latest secondary should be verified without replacing the reviewed pin");
  const baseline = structuredClone(result.catalog);
  const second = await refreshCatalog(result.catalog, source, request, result.catalog.generated_at);
  assert.deepEqual(result.catalog, baseline, "Refresh must not mutate its baseline");
  assert.deepEqual(second.catalog, result.catalog);
});

test("secondary imports require consistent publication metadata and unique copyable targets", async () => {
  const { request } = fixture();
  const source = awesome(["import reviewed@1.0.0.0/main.bend", "import reviewed@1.0.0.0/src/lib.bend"].join(tick + "; " + tick));
  const { catalog } = await refreshCatalog(existing, source, request);
  const row = catalog.packages.find((item) => item.id === "reviewed");
  const secondary = row.additional_imports[0];
  const check = (changed) => validateCatalog({ ...catalog, packages: [{ ...row, ...changed }] });
  assert.throws(() => check({ additional_imports: [] }), /nonempty list/);
  assert.throws(() => check({ additional_imports: [{ ...secondary, import: null }] }), /Invalid additional import/);
  assert.throws(() => check({ additional_imports: [{ import: secondary.import }] }), /invalid publication/);
  assert.throws(() => check({ additional_imports: [{ ...secondary, publication: { ...secondary.publication, entry: "main.bend" } }] }), /disagrees/);
  assert.throws(() => check({ additional_imports: [{ ...secondary, publication: { ...secondary.publication, entry: null } }] }), /without an entry/);
  assert.throws(() => check({ additional_imports: [{ import: row.import, publication: row.publication }] }), /Duplicate import/);
  assert.throws(() => check({ import: null, latest_import: undefined, publication: { ...row.publication, entry: null } }), /need a primary import/);
  assert.throws(() => check({ source: "git", import: null, publication: undefined }), /Source-only/);
});

test("aliases known only through a previous secondary remain discoverable after the source changes", async () => {
  const { request, data, seen } = fixture();
  const source = awesome(["import reviewed@1.0.0.0/main.bend", "import discovered@1.0.0.0/other.bend"].join(tick + "; " + tick));
  const first = await refreshCatalog(existing, source, request);
  const reviewed = first.catalog.packages.find((item) => item.id === "reviewed");
  reviewed.additional_imports[0].publication.aliases = ["also-discovered@1.0.0.0"];
  data.set(HUB + "/name/also-discovered", Buffer.from(JSON.stringify({ name: "also-discovered", owner_login: "owner", latest: { version: "1.0.0.0", hash: otherHash, desc: "Another alias.", entry: "" } })));
  data.set(HUB + "/name/also-discovered@1.0.0.0", Buffer.from(otherHash));
  const second = await refreshCatalog(first.catalog, awesome(), request);
  const standalone = second.catalog.packages.filter((item) => item.publication?.hash === otherHash);
  assert.equal(standalone.length, 1);
  assert.equal(standalone[0].name, "discovered");
  assert.deepEqual(standalone[0].publication.aliases, ["also-discovered@1.0.0.0"]);
  assert.ok(seen.includes(HUB + "/name/also-discovered"));
  assert.equal(second.catalog.packages.find((item) => item.id === "reviewed").additional_imports, undefined);
});
