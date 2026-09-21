# Bend Packages

Community catalog for **current Bend** (`bendlang/bend`, 2.0.x).

Live: https://777genius.github.io/bend-packages/

This is **not** the official hub. Official surfaces are [bend-lang.com](https://bend-lang.com), [hub.bend-lang.com](https://hub.bend-lang.com), and [bendlang/bend](https://github.com/bendlang/bend). Hub packages are content hashes (`import 0x…/file.bend`). This site indexes them so people can search, filter, and copy the import. Also listed from [Awesome Bend](https://github.com/777genius/awesome-bend).

The default view is packages live on the hub. Git clones without a hash sit behind the source filter. The compiler (`bendlang/bend`) is not a package.

## Local

```sh
python3 -m http.server 4173
```

Open http://127.0.0.1:4173

## Data

Listings live in `data/packages.json`. A daily workflow refreshes GitHub stars and runs discovery.

```sh
GITHUB_TOKEN=… node scripts/refresh-stars.mjs
GITHUB_TOKEN=… node scripts/scan.mjs
```

A row is **Hub** when:

1. `hub.bend-lang.com/index.json` has the hash, or the repo README / `pack.json` contains `import 0xHASH/file.bend`
2. For GitHub-backed rows, `file.bend` exists in *that* repository (a README that imports someone else’s hash does not count)
3. `https://hub.bend-lang.com/0xHASH/file.bend` returns 200

GitHub is attached when the published file or README names the repo. Hub-only rows (no known repo) still list, with a link to the hub file.

### `pack.json`

Authors can opt in with a tiny manifest. The `import` still has to pass the file-in-repo and hub-live checks.

```json
{
  "name": "codec",
  "description": "RFC 4648 hex, Base64, and UTF-8.",
  "import": "import 0x888714bde93f46c139372bb9fdc57a19/hex.bend as Hex",
  "category": "packages"
}
```

## License

Apache-2.0. Bend logo © bendlang.
