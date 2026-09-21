# Bend Packages

Community catalog for **current Bend** (`bendlang/bend`, 2.0.x).

Live site: https://777genius.github.io/bend-packages/

This is **not** the official hub. Official surfaces are [bend-lang.com](https://bend-lang.com), [hub.bend-lang.com](https://hub.bend-lang.com), and [bendlang/bend](https://github.com/bendlang/bend). Packages on the hub are content hashes (`import 0x…/file.bend`). This site indexes them so people can search and filter.

Visual language follows the [Universal Agent Plugins](https://777genius.github.io/universal-agent-plugins/) landing.

## Local

Python is enough:

```sh
python3 -m http.server 4173
```

Open http://127.0.0.1:4173

## Data

Curated listings live in `data/packages.json`. A daily workflow refreshes star counts.

```sh
GITHUB_TOKEN=… node scripts/refresh-stars.mjs
GITHUB_TOKEN=… node scripts/scan.mjs   # optional, conservative GitHub discovery
```

`scan.mjs` only adds repos tagged `bend` / `bend2` or described as Bend 2. It cannot prove a dump is a real library; curated rows always win.

## License

Apache-2.0. Bend logo © bendlang.
