const toast = document.getElementById("toast");
const grid = document.getElementById("grid");
const summary = document.getElementById("summary");
const q = document.getElementById("q");
const clearSearch = document.getElementById("clear-search");
const chips = document.getElementById("chips");
const filtersHost = document.getElementById("catalog-advanced-filters");
const filterToggle = document.getElementById("filter-toggle");

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
    { value: "git", label: "Git", icon: "source" },
    { value: "all", label: "Hub + Git", icon: "source" },
  ],
  sort: [
    { value: "stars", label: "Most stars", icon: "trust" },
    { value: "name", label: "Name", icon: "owner" },
  ],
};

const state = { packages: [], query: "", category: "all", source: "hub", sort: "stars" };

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
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    showToast(ok ? "Copied" : "Copy failed");
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

function closeSelects(except) {
  document.querySelectorAll(".app-select").forEach((select) => {
    if (select === except) return;
    const trigger = select.querySelector(".app-select__trigger");
    const content = select.querySelector(".app-select__content");
    trigger.dataset.state = "closed";
    content.hidden = true;
  });
}

function mountSelect(key) {
  const wrap = el("div", "app-select");
  wrap.dataset.filter = key;
  const trigger = el("button", "app-select__trigger");
  trigger.type = "button";
  trigger.dataset.state = "closed";
  trigger.setAttribute("aria-haspopup", "listbox");
  const value = el("span", "app-select__value");
  value.append(svg(FILTERS[key][0].icon, "filter-icon"), el("span", "", optionLabel(key, state[key])));
  trigger.append(value, svg("chevron", "app-select__chevron"));
  const content = el("div", "app-select__content");
  content.hidden = true;
  content.setAttribute("role", "listbox");

  function paint() {
    value.lastChild.textContent = optionLabel(key, state[key]);
    content.replaceChildren(
      ...FILTERS[key].map((option) => {
        const item = el("button", "app-select__item", option.label);
        item.type = "button";
        item.dataset.state = option.value === state[key] ? "checked" : "";
        if (option.value === state[key]) item.append(el("span", "app-select__indicator", "✓"));
        item.addEventListener("click", () => {
          state[key] = option.value;
          closeSelects();
          paint();
          render();
        });
        return item;
      }),
    );
  }

  trigger.addEventListener("click", () => {
    const open = trigger.dataset.state !== "open";
    closeSelects(wrap);
    trigger.dataset.state = open ? "open" : "closed";
    content.hidden = !open;
  });

  wrap.append(trigger, content);
  paint();
  return wrap;
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
    repoLink.textContent = "hub";
  }
  copy.append(h3, repoLink);
  identity.append(icon, copy);

  const stars = el("div", "plugin-card__popularity", `★ ${formatStars(pkg.stars ?? 0)}`);
  stars.title = "GitHub stars";

  const tags = el("ul", "tag-list");
  tags.append(el("li", "", CATEGORY_LABELS[pkg.category] ?? pkg.category));
  const sourceTag = el("li", pkg.source === "hub" ? "hub" : "", pkg.source === "hub" ? "Hub" : "Git");
  tags.append(sourceTag);

  const bottom = el("div", "plugin-card__bottom");
  if (pkg.import) {
    const install = el("button", "plugin-card__install-toggle", "Copy import");
    install.type = "button";
    const panel = el("div", "plugin-card__install-panel");
    panel.hidden = true;
    const snippet = el("div", "command-snippet command-snippet--inline command-snippet--add");
    const pre = document.createElement("pre");
    pre.append(el("code", "", pkg.import));
    const header = el("div", "command-snippet__header");
    const copyBtn = el("button", "", "Copy");
    copyBtn.type = "button";
    copyBtn.addEventListener("click", () => copyText(pkg.import));
    header.append(copyBtn);
    snippet.append(pre, header);
    panel.append(snippet);
    install.addEventListener("click", () => {
      copyText(pkg.import);
      panel.hidden = !panel.hidden;
      install.setAttribute("aria-expanded", String(!panel.hidden));
    });
    bottom.append(install, panel);
  } else {
    const clone = el("a", "plugin-card__install-toggle", "Clone repo");
    clone.href = pkg.url;
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
  closeSelects();
  filtersHost.replaceChildren(mountSelect("category"), mountSelect("source"), mountSelect("sort"));
  render();
}

function render() {
  const query = state.query.trim().toLowerCase();
  clearSearch.hidden = !state.query;
  let rows = state.packages.filter((pkg) => {
    const hay = `${pkg.name} ${pkg.repo} ${pkg.description}`.toLowerCase();
    return (
      (!query || hay.includes(query)) &&
      (state.category === "all" || pkg.category === state.category) &&
      (state.source === "all" || pkg.source === state.source)
    );
  });
  rows = [...rows].sort((a, b) =>
    state.sort === "name" ? a.name.localeCompare(b.name) : (b.stars ?? 0) - (a.stars ?? 0),
  );

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
        filtersHost.replaceChildren(mountSelect("category"), mountSelect("source"), mountSelect("sort"));
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
  if (!event.target.closest(".app-select")) closeSelects();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSelects();
});

q.addEventListener("input", () => {
  state.query = q.value;
  render();
});
clearSearch.addEventListener("click", () => {
  state.query = "";
  q.value = "";
  render();
});
filterToggle.addEventListener("click", () => {
  const open = filterToggle.getAttribute("aria-expanded") !== "true";
  filterToggle.setAttribute("aria-expanded", String(open));
  filtersHost.classList.toggle("catalog-advanced-filters--open", open);
});

filtersHost.replaceChildren(mountSelect("category"), mountSelect("source"), mountSelect("sort"));

const catalog = await fetch("./data/packages.json?v=18").then((r) => r.json());
state.packages = catalog.packages;
render();
