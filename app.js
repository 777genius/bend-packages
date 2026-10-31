const toast = document.getElementById("toast");
const grid = document.getElementById("grid");
const summary = document.getElementById("summary");
const q = document.getElementById("q");
const clearSearch = document.getElementById("clear-search");
const chips = document.getElementById("chips");
const filtersHost = document.getElementById("catalog-advanced-filters");
const filterToggle = document.getElementById("filter-toggle");
const catalogUpdated = document.getElementById("catalog-updated");

const CATEGORY_LABELS = {
  packages: "Libraries",
  tools: "Tools",
  editors: "Editors",
  packaging: "Packaging",
  learning: "Learning",
  demos: "Demos",
};

const FILTERS = {
  category: [
    { value: "all", label: "All categories", icon: "category" },
    ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({
      value,
      label,
      icon: "category",
    })),
  ],
  source: [
    { value: "hub", label: "Hub", icon: "source" },
    { value: "git", label: "Source only", icon: "source" },
    { value: "all", label: "All listings", icon: "source" },
  ],
  sort: [
    { value: "stars", label: "Most stars", icon: "trust" },
    { value: "name", label: "Name", icon: "owner" },
  ],
};

const state = { packages: [], query: "", category: "all", source: "hub", sort: "stars", status: "loading" };

const ICONS = {
  category:
    '<path d="M4 7.5V5a1 1 0 0 1 1-1h2.5l11.25 11.25a1.5 1.5 0 0 1 0 2.12l-1.38 1.38a1.5 1.5 0 0 1-2.12 0L4 7.5Z"/><circle cx="7.4" cy="7.4" r="1"/>',
  source:
    '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M8 9c2.5 0 3 4 6 4h2"/>',
  trust:
    '<path d="M12 3.5 19 6v5.5c0 4.5-2.75 7.25-7 9-4.25-1.75-7-4.5-7-9V6l7-2.5Z"/><path d="m9 12 2 2 4-4"/>',
  owner:
    '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.6-4 3-6 7-6s6.4 2 7 6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  github:
    '<path fill="currentColor" d="M12 2C6.48 2 2 6.58 2 12.26c0 4.52 2.87 8.36 6.84 9.72.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.86.09-.67.35-1.12.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05a9.2 9.2 0 0 1 5 0c1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.03 10.03 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z"/>',
};

function svg(name, className) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("fill", "none");
  node.setAttribute("aria-hidden", "true");
  if (className) node.setAttribute("class", className);
  node.innerHTML = ICONS[name];
  return node;
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1400);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied");
    return;
  } catch {
    const focused = document.activeElement;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.append(area);
    area.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      // The visible import remains available for manual selection.
    } finally {
      area.remove();
      focused?.focus?.();
    }
    showToast(copied ? "Copied" : "Could not copy. Select the text to copy it.");
  }
}

function formatStars(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function optionLabel(key, value) {
  return FILTERS[key].find((item) => item.value === value)?.label ?? value;
}

function mountSelect(key) {
  const wrap = el("div", "app-select");
  wrap.dataset.filter = key;
  const label = el("label", "sr-only", { category: "Category", source: "Source", sort: "Sort" }[key]);
  label.htmlFor = `filter-${key}`;
  const select = el("select", "app-select__native");
  select.id = label.htmlFor;
  select.name = key;
  for (const option of FILTERS[key]) {
    const item = el("option", "", option.label);
    item.value = option.value;
    select.append(item);
  }
  select.value = state[key];
  select.addEventListener("change", () => {
    state[key] = select.value;
    render();
  });
  wrap.append(label, svg(FILTERS[key][0].icon, "filter-icon"), select, svg("chevron", "app-select__chevron"));
  return wrap;
}

function syncFilters() {
  for (const key of Object.keys(FILTERS)) {
    document.getElementById(`filter-${key}`).value = state[key];
  }
}

function importsFor(pkg) {
  return [
    ...(pkg.import ? [{
      import: pkg.import,
      publication: pkg.publication,
      latest_import: pkg.latest_import,
      hub: pkg.hub,
    }] : []),
    ...(pkg.additional_imports ?? []),
  ];
}

function searchRecords(pkg) {
  return [
    {
      import: pkg.import ?? "",
      publication: pkg.publication,
      latest_import: pkg.latest_import,
      hub: pkg.hub,
    },
    ...(pkg.additional_imports ?? []),
  ];
}

function searchText(pkg) {
  const modules = searchRecords(pkg);
  const publications = modules.map((item) => item.publication);
  const hubs = modules.map((item) => item.hub).filter(Boolean);
  return [
    pkg.name,
    pkg.repo ?? "",
    pkg.description,
    ...modules.flatMap((item) => [item.import, item.latest_import ?? ""]),
    ...publications.flatMap((publication) => [
      publication?.package ?? "",
      publication?.owner ?? "",
      ...(publication?.aliases ?? []),
    ]),
    ...hubs.flatMap((hub) => [
      hub.name,
      hub.owner,
      hub.latest?.version ?? "",
      hub.latest?.description ?? "",
    ]),
  ].join(" ").toLowerCase();
}

function searchScore(pkg, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const tokens = needle.split(/\s+/).filter(Boolean);
  const haystack = searchText(pkg);
  if (!tokens.every((token) => haystack.includes(token))) return -1;

  const modules = searchRecords(pkg);
  const names = [...new Set([
    pkg.name,
    ...modules.flatMap((item) => [
      item.hub?.name ?? "",
      item.publication?.package?.split("@")[0] ?? "",
      ...(item.publication?.aliases ?? []).map((value) => value.split("@")[0]),
    ]),
  ].map((value) => value.toLowerCase()).filter(Boolean))];
  const owners = [...new Set([
    pkg.repo?.split("/")[0] ?? "",
    ...modules.map((item) => item.hub?.owner ?? item.publication?.owner ?? ""),
  ].map((value) => value.toLowerCase()).filter(Boolean))];

  let score = haystack.includes(needle) ? 120 : 0;
  for (const name of names) {
    if (name === needle) score += 1200;
    else if (name.startsWith(needle)) score += 650;
    else if (name.includes(needle)) score += 300;
    for (const token of tokens) {
      if (name === token) score += 220;
      else if (name.startsWith(token)) score += 110;
      else if (name.includes(token)) score += 55;
    }
  }
  for (const owner of owners) {
    if (owner === needle) score += 260;
    else if (owner.includes(needle)) score += 90;
  }
  return score;
}

function card(pkg) {
  const article = el("article", "plugin-card");
  const identity = el("div", "plugin-card__identity");
  const icon = el("span", "plugin-card__icon");
  const img = document.createElement("img");
  img.src = "./logo.png";
  img.alt = "";
  img.width = 32;
  img.height = 32;
  icon.append(img);
  const copy = el("div");
  const h3 = el("h3");
  const name = el("a", "plugin-card__title-link");
  name.href = pkg.url;
  name.textContent = pkg.name;
  h3.append(name);

  const githubUrl = pkg.repo ? (pkg.url.includes("github.com") ? pkg.url : `https://github.com/${pkg.repo}`) : "";
  const repoLink = el("a", "plugin-card__source-label");
  repoLink.href = githubUrl || pkg.url;
  repoLink.target = "_blank";
  repoLink.rel = "noopener noreferrer";
  if (githubUrl) {
    repoLink.append(svg("github", "plugin-card__github-icon"), document.createTextNode(pkg.repo));
  } else {
    repoLink.textContent = pkg.source === "hub" ? "Hub" : "Resource";
  }
  copy.append(h3, repoLink);
  identity.append(icon, copy);

  const stars = el("div", "plugin-card__popularity", `★ ${formatStars(pkg.stars ?? 0)}`);
  stars.title = "GitHub stars";
  stars.hidden = !pkg.repo || !Number.isFinite(pkg.stars);

  const tags = el("ul", "tag-list");
  tags.append(el("li", "", CATEGORY_LABELS[pkg.category] ?? pkg.category));
  const latestVersion = pkg.hub?.latest?.version;
  const sourceTag = el("li", pkg.source === "hub" ? "hub" : "",
    pkg.source === "hub" ? (latestVersion ? `Hub · latest ${latestVersion}` : "Hub") : "Source");
  tags.append(sourceTag);

  const bottom = el("div", "plugin-card__bottom");
  const imports = importsFor(pkg);
  const preferredImport = (item) => item.latest_import ?? item.import;
  const latestPackage = (item) => item.hub ? item.hub.name + "@" + item.hub.latest.version : "";
  const hasNewerHubVersion = (item) => Boolean(item.hub && item.publication && latestPackage(item) !== item.publication.package);
  if (imports.length) {
    const multiple = imports.length > 1;
    const first = imports[0];
    const firstHasLatest = Boolean(first.latest_import);
    const install = el("button", "plugin-card__install-toggle",
      multiple ? "Choose import" : firstHasLatest ? "Copy latest" : hasNewerHubVersion(first) ? "Copy reviewed" : "Copy import");
    install.type = "button";
    install.setAttribute("aria-expanded", "false");
    install.setAttribute("aria-label", multiple
      ? `Choose import for ${pkg.name}`
      : `Copy ${preferredImport(first)}`);
    const panel = el("div", "plugin-card__install-panel" + (multiple ? " plugin-card__install-panel--multiple" : ""));
    panel.id = `imports-${pkg.id}`;
    panel.hidden = true;
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", `Imports for ${pkg.name}`);
    install.setAttribute("aria-controls", panel.id);
    for (const item of imports) {
      const shown = preferredImport(item);
      const snippet = el("div", "command-snippet command-snippet--inline command-snippet--add");
      const pre = document.createElement("pre");
      pre.append(el("code", "", shown));
      pre.title = item.latest_import ? "Latest verified version from BendHub" : "Reviewed pinned import";
      const header = el("div", "command-snippet__header");
      const copyBtn = el("button", "", item.latest_import ? "Latest" : "Copy");
      copyBtn.type = "button";
      copyBtn.setAttribute("aria-label", `Copy ${shown}`);
      copyBtn.addEventListener("click", () => copyText(shown));
      header.append(copyBtn);
      if (item.latest_import) {
        const reviewedBtn = el("button", "", "Reviewed");
        reviewedBtn.type = "button";
        reviewedBtn.title = "Copy the reviewed compatibility pin";
        reviewedBtn.setAttribute("aria-label", `Copy reviewed pin ${item.import}`);
        reviewedBtn.addEventListener("click", () => copyText(item.import));
        header.append(reviewedBtn);
      }
      snippet.append(pre, header);
      panel.append(snippet);
      if (!item.latest_import && hasNewerHubVersion(item)) {
        const note = el("a", "plugin-card__source-label",
          `Latest ${item.hub.latest.version} changed this module path · inspect on Hub`);
        note.href = `https://hub.bend-lang.com/n/${item.hub.name}`;
        note.target = "_blank";
        note.rel = "noopener noreferrer";
        panel.append(note);
      }
    }
    install.addEventListener("click", () => {
      if (multiple) {
        panel.hidden = !panel.hidden;
        install.textContent = panel.hidden ? "Choose import" : "Hide imports";
        install.setAttribute("aria-label", `${panel.hidden ? "Choose import" : "Hide imports"} for ${pkg.name}`);
      } else {
        copyText(preferredImport(first));
        panel.hidden = false;
      }
      install.setAttribute("aria-expanded", String(!panel.hidden));
    });
    bottom.append(install, panel);
  } else {
    const clone = el("a", "plugin-card__install-toggle",
      pkg.source === "hub" ? "View on Hub" : pkg.repo ? "View source" : "View resource");
    clone.href = pkg.source === "hub" ? pkg.url : githubUrl || pkg.url;
    bottom.append(clone);
  }

  article.append(
    stars,
    identity,
    el("p", "plugin-card__description", pkg.description),
    tags,
    bottom,
  );
  return article;
}

function activeChips() {
  const items = [];
  if (state.query.trim()) items.push({ key: "query", label: `Search: ${state.query.trim()}` });
  if (state.category !== "all") items.push({ key: "category", label: `Category: ${optionLabel("category", state.category)}` });
  if (state.source !== "hub") items.push({ key: "source", label: `Source: ${optionLabel("source", state.source)}` });
  if (state.sort !== "stars") items.push({ key: "sort", label: `Sort: ${optionLabel("sort", state.sort)}` });
  return items;
}

function resetFilters() {
  state.query = "";
  state.category = "all";
  state.source = "hub";
  state.sort = "stars";
  q.value = "";
  syncFilters();
  render();
}

function render() {
  const query = state.query.trim().toLowerCase();
  clearSearch.hidden = !state.query;
  if (state.status !== "ready") return;
  let scored = state.packages.map((pkg) => ({ pkg, score: searchScore(pkg, query) })).filter(({ pkg, score }) => (
    (!query || score >= 0) &&
    (state.category === "all" || pkg.category === state.category) &&
    (state.source === "all" || pkg.source === state.source)
  ));
  scored.sort((a, b) => {
    if (query && b.score !== a.score) return b.score - a.score;
    return state.sort === "name"
      ? a.pkg.name.localeCompare(b.pkg.name)
      : (b.pkg.stars ?? 0) - (a.pkg.stars ?? 0);
  });
  const rows = scored.map(({ pkg }) => pkg);

  chips.replaceChildren();
  const active = activeChips();
  active.forEach((chip) => {
    const button = el("button", "catalog-filter-chip", `${chip.label} ×`);
    button.type = "button";
    button.addEventListener("click", () => {
      if (chip.key === "query") {
        state.query = "";
        q.value = "";
      } else {
        state[chip.key] = chip.key === "sort" ? "stars" : chip.key === "source" ? "hub" : "all";
        syncFilters();
      }
      render();
    });
    chips.append(button);
  });
  const reset = el("button", "catalog-filter-reset", "Reset filters");
  reset.type = "button";
  reset.disabled = !active.length;
  reset.addEventListener("click", resetFilters);
  chips.append(reset);

  grid.replaceChildren();
  if (!rows.length) {
    const empty = el("div", "empty-state");
    empty.append(
      el("h3", "", "No matching packages"),
      el("p", "", "Try a broader search or clear one of the filters."),
    );
    grid.append(empty);
  } else {
    rows.forEach((pkg) => grid.append(card(pkg)));
  }
  const hubTotal = state.packages.filter((pkg) => pkg.source === "hub").length;
  summary.textContent =
    state.source === "hub" && !query && state.category === "all"
      ? `${rows.length} published packages`
      : `${rows.length} of ${state.packages.length} listings · ${hubTotal} on the hub`;
}

document.body.addEventListener("click", (event) => {
  const button = event.target.closest("[data-copy]");
  if (button) copyText(button.getAttribute("data-copy") ?? "");
});


q.addEventListener("input", () => {
  state.query = q.value;
  render();
});
clearSearch.addEventListener("click", () => {
  state.query = "";
  q.value = "";
  render();
  q.focus();
});
filterToggle.addEventListener("click", () => {
  const open = filterToggle.getAttribute("aria-expanded") !== "true";
  filterToggle.setAttribute("aria-expanded", String(open));
  filtersHost.classList.toggle("catalog-advanced-filters--open", open);
});

filtersHost.replaceChildren(mountSelect("category"), mountSelect("source"), mountSelect("sort"));

async function loadCatalog() {
  state.status = "loading";
  summary.textContent = "Loading catalog…";
  catalogUpdated.hidden = true;
  grid.replaceChildren();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch("./data/packages.json", { cache: "no-cache", signal: controller.signal });
    if (!response.ok) throw new Error(`Catalog request returned HTTP ${response.status}`);
    const catalog = await response.json();
    if (!Array.isArray(catalog.packages) || !catalog.packages.every((pkg) =>
      pkg && typeof pkg.name === "string" && typeof pkg.description === "string" &&
      typeof pkg.url === "string" && typeof pkg.category === "string" &&
      ["hub", "git"].includes(pkg.source))) {
      throw new Error("Catalog listings are invalid");
    }
    state.packages = catalog.packages;
    state.status = "ready";
    const updated = new Date(typeof catalog.generated_at === "string" ? catalog.generated_at : "");
    if (Number.isFinite(updated.getTime())) {
      const time = el("time", "", updated.toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
      }));
      time.dateTime = updated.toISOString();
      time.title = updated.toUTCString();
      catalogUpdated.replaceChildren(document.createTextNode("Catalog updated "), time);
      catalogUpdated.hidden = false;
    }
    render();
  } catch (error) {
    state.status = "error";
    summary.textContent = "Catalog unavailable";
    const empty = el("div", "empty-state");
    const retry = el("button", "button button--secondary", "Try again");
    retry.type = "button";
    retry.addEventListener("click", loadCatalog);
    empty.append(el("h3", "", "Could not load the catalog"),
      el("p", "", "Please try again in a moment."), retry);
    grid.replaceChildren(empty);
    console.error("Could not load the catalog", error);
  } finally {
    window.clearTimeout(timeout);
  }
}

await loadCatalog();
