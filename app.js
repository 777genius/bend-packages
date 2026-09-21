const toast = document.getElementById("toast");
const grid = document.getElementById("grid");
const summary = document.getElementById("summary");
const q = document.getElementById("q");
const category = document.getElementById("category");
const source = document.getElementById("source");
const sort = document.getElementById("sort");
const reset = document.getElementById("reset");

const state = { packages: [], query: "", category: "all", source: "all", sort: "stars" };

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
  } catch {
    showToast("Copy failed");
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

function card(pkg) {
  const article = el("article", "card");
  const top = el("div", "card-top");
  const titleWrap = el("div");
  const h3 = el("h3");
  const name = el("a");
  name.href = pkg.url;
  name.textContent = pkg.name;
  h3.append(name);
  titleWrap.append(h3, el("div", "meta", pkg.repo));
  top.append(titleWrap, el("div", "stars", `★ ${formatStars(pkg.stars ?? 0)}`));

  const tags = el("div", "tags");
  tags.append(el("span", "tag", pkg.category));
  const sourceTag = el("span", pkg.source === "hub" ? "tag hub" : "tag", pkg.source === "hub" ? "on the hub" : "git");
  tags.append(sourceTag);

  const actions = el("div", "card-actions");
  if (pkg.import) {
    const copy = el("button", "btn btn-primary", "Copy import");
    copy.type = "button";
    copy.addEventListener("click", () => copyText(pkg.import));
    actions.append(copy);
  } else {
    const clone = el("a", "btn btn-ghost", "Clone repo");
    clone.href = pkg.url;
    actions.append(clone);
  }
  const github = el("a", "btn btn-ghost", "GitHub");
  github.href = pkg.url;
  actions.append(github);

  article.append(top, el("p", "desc", pkg.description), tags, actions);
  return article;
}

function render() {
  const query = state.query.trim().toLowerCase();
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
  grid.replaceChildren();
  if (!rows.length) {
    grid.append(el("p", "empty", "No matching packages. Try a broader search or reset filters."));
  } else {
    rows.forEach((pkg) => grid.append(card(pkg)));
  }
  summary.textContent = `${rows.length} of ${state.packages.length} listings. Hub packages copy an import 0x… line; others are git clones.`;
}

document.body.addEventListener("click", (event) => {
  const button = event.target.closest("[data-copy]");
  if (!button) return;
  copyText(button.getAttribute("data-copy") ?? "");
});

q.addEventListener("input", () => {
  state.query = q.value;
  render();
});
category.addEventListener("change", () => {
  state.category = category.value;
  render();
});
source.addEventListener("change", () => {
  state.source = source.value;
  render();
});
sort.addEventListener("change", () => {
  state.sort = sort.value;
  render();
});
reset.addEventListener("click", () => {
  state.query = "";
  state.category = "all";
  state.source = "all";
  state.sort = "stars";
  q.value = "";
  category.value = "all";
  source.value = "all";
  sort.value = "stars";
  render();
});

const catalog = await fetch("./data/packages.json").then((r) => r.json());
state.packages = catalog.packages;
render();
