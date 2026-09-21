# Bend Packages

Community catalog for **current Bend** (`bendlang/bend`, 2.0.x).

Live site: https://777genius.github.io/bend-packages/

This is **not** the official hub. Official surfaces are [bend-lang.com](https://bend-lang.com), [hub.bend-lang.com](https://hub.bend-lang.com), and [bendlang/bend](https://github.com/bendlang/bend). Packages on the hub are content hashes (`import 0x…/file.bend`). This site indexes them so people can search and filter. The default view is packages that are live on the hub.

Colors follow [bend-lang.com](https://bend-lang.com). Catalog controls and cards follow the [Universal Agent Plugins](https://777genius.github.io/universal-agent-plugins/) directory.

## Local

Python is enough:

```sh
python3 -m http.server 4173
```

Open http://127.0.0.1:4173

## Data

Curated listings live in `data/packages.json`. A daily workflow refreshes star counts and runs discovery.

```sh
GITHUB_TOKEN=… node scripts/refresh-stars.mjs
GITHUB_TOKEN=… node scripts/scan.mjs
```

A repo is listed as **Hub** only if all of these hold:

1. README or `pack.json` contains `import 0xHASH/file.bend`
2. `file.bend` exists in *this* repository (so a README that imports another package does not count)
3. `https://hub.bend-lang.com/0xHASH/file.bend` returns 200

Curated Git rows can still live in the JSON; they are behind the source filter. The compiler (`bendlang/bend`) is not a package and is not listed.

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
