# Bend Packages

Community catalog for **current Bend** (`bendlang/bend`, 2.0.x).

Live: https://777genius.github.io/bend-packages/

Find libraries, tools, demos, and learning resources by project, Hub name, owner, or capability. The default view shows Hub publications; choose **Source only** for other projects and resources, or **All listings** to see both. The official [BendHub](https://hub.bend-lang.com/packages) also has names and search. This site is an independent community catalog.

Use **Copy import** to copy a complete, pinned import, including its module alias. For projects with several published modules, use **Choose import** and copy the specific module you need. A publication without a documented entrypoint has **View on Hub** so you can inspect its files before choosing an import. Other listings offer **View source** for repositories or **View resource** for websites. Follow each project's compiler requirements and setup instructions.

## Local

Run from the repository root:

```sh
python3 -m http.server 4173
```

Open http://127.0.0.1:4173. The site uses static HTML, CSS, JavaScript, and `data/packages.json`; no build or dependency installation is required.

## Where the listings come from

- **Awesome Bend:** relevant entries from the [reviewed list](https://github.com/777genius/awesome-bend) supply curated project names, descriptions, compiler requirements, and documented imports. These reviewed pins take precedence over a newer Hub version of the same package.
- **Official Hub:** named publications add the latest version and description from the Hub's own metadata. These entries link to the Hub; a GitHub repository is attached only when the curated source establishes that connection.
- **Existing hash-only publications:** useful catalog entries can remain after verification. A content hash is immutable and has no version ordering.

Curated review and automatic publication discovery are different kinds of evidence. Hub verification confirms publication and file integrity; check compiler compatibility in the project's documentation and with your own program. A published package is not automatically a recommendation to upgrade a working pin.

## Refresh and verification

The daily **Refresh catalog** workflow syncs the sources and verifies the catalog before publishing its data. The site's **Catalog updated** date records the last successful full refresh. A failed refresh preserves the previous catalog; updating GitHub stars alone does not advance that date.

For a Hub listing, the refresh resolves its exact named version or hash and verifies the package manifest. When an entrypoint is documented, it also checks that the file is present and that its SHA-256 matches the manifest. Only then does the card offer **Copy import**. If no entrypoint is documented, the card opens the publication on the Hub. Packages are not installed, compiled, or executed by this process.

Run a full refresh with Node.js:

```sh
node scripts/scan.mjs
```

For a review against a local Awesome Bend checkout, optionally write a preview without replacing the published data:

```sh
node scripts/scan.mjs --awesome-readme ../awesome-bend/README.md --output /tmp/bend-packages-preview.json
```

Check the stored catalog's structure and import consistency without network access:

```sh
node scripts/scan.mjs --check
node --test
```

GitHub stars are a separate optional refresh. A GitHub token helps avoid the unauthenticated API limit:

```sh
GITHUB_TOKEN=… node scripts/refresh-stars.mjs
```

## Suggest a package

Suggest a curated entry in [Awesome Bend](https://github.com/777genius/awesome-bend/blob/main/CONTRIBUTING.md), or [open an issue here](https://github.com/777genius/bend-packages/issues/new) with the project, a useful description, and its published import when available. Named Hub publications are discovered through the official metadata during a successful catalog refresh.

For publishing and names, follow the [official Hub guide](https://hub.bend-lang.com/guide).

## License

Apache-2.0. Bend logo © bendlang.
