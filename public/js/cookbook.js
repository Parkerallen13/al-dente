// Cookbook tab. The Al Dente cookbook is an e-ink kitchen device that doesn't exist
// yet, so this is a simulator: pair it, send recipes to it, and use its own screens
// with its four buttons. Book view reads any recipe as pages, no device needed.
import { app, state, refreshLibrary, saveProfile, navigate, onLeave, esc, toast, plural, shortDate, openSheet, confirmDialog, thumbHtml } from "./core.js";
import { scaleIngredient, sourceName } from "./recipe.js";
import { highlight } from "./cook.js";

const cookbook = () => state.profile.cookbook;

// Recipes on the device, newest first, skipping any deleted from the library since.
const onDevice = () =>
  cookbook().items
    .map((item) => ({ ...item, recipe: state.recipes.find((r) => r.id === item.recipeId) }))
    .filter((item) => item.recipe)
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));

const bookCallout = () => `<div class="callout">
  <span class="row-title">No cookbook device?</span>
  <span class="row-sub">Read any recipe as a book page right in the app.</span>
  <a class="btn btn-sm self-start" href="/cookbook/book" data-link>Open book view</a></div>`;

// ---------------------------------------------------------------------------
// The device

const KEYS = [["prev", "Previous"], ["next", "Next"], ["select", "Select"], ["back", "Back/Menu"]];
const KEYBOARD = { ArrowDown: "next", ArrowRight: "next", ArrowUp: "prev", ArrowLeft: "prev", Enter: "select", Escape: "back", Backspace: "back" };

export function deviceHtml(screen = "", size = "") {
  return `<div class="device ${size ? `device-${size}` : ""}">
    <div class="device-screen eink" id="eink" aria-live="polite">${screen}</div>
    <div class="device-buttons">${KEYS.map(([key, label]) => `<button class="dbtn" type="button" data-key="${key}"><span class="dbtn-key"></span><span>${label}</span></button>`).join("")}</div>
  </div>`;
}

// Wires the device's buttons and the keyboard to press(key). Returns a cleanup function.
function wireDevice(press) {
  const screen = document.getElementById("eink");
  const run = (key) => {
    press(key);
    // A quick flash, like an e-ink panel redrawing.
    screen.classList.remove("refresh");
    void screen.offsetWidth;
    screen.classList.add("refresh");
  };
  app.querySelector(".device-buttons").addEventListener("click", (e) => {
    const key = e.target.closest("[data-key]")?.dataset.key;
    if (key) run(key);
  });
  const onKey = (e) => {
    if (!KEYBOARD[e.key] || e.target.closest?.("input, textarea, select") || document.querySelector(".overlay, dialog[open]")) return;
    e.preventDefault();
    run(KEYBOARD[e.key]);
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}

function einkList(head, right, title, rows, index, foot) {
  const start = Math.max(0, Math.min(index - 3, rows.length - 7));
  return `<div class="eink-head"><span>${esc(head)}</span><span>${esc(right)}</span></div>
    ${title ? `<div class="eink-title">${esc(title)}</div>` : ""}
    <div class="eink-list">${rows.slice(start, start + 7).map(([left, side], i) => `<div class="eink-row ${start + i === index ? "is-selected" : ""}"><span>${esc(left)}</span><span>${esc(side)}</span></div>`).join("")}</div>
    <div class="eink-foot"><span>${foot[0]}</span><span>${foot[1]}</span></div>`;
}

// A recipe split into device pages: ingredients first, then three steps a page.
function einkPages(recipe) {
  const items = recipe.ingredientGroups.flatMap((g) => [...(g.name ? [{ head: g.name }] : []), ...g.items.map((text) => ({ text }))]);
  const steps = recipe.stepGroups.flatMap((g) => g.steps);
  const pages = [{ kind: "ingredients", items: items.slice(0, 8), first: true }];
  for (let i = 8; i < items.length; i += 12) pages.push({ kind: "ingredients", items: items.slice(i, i + 12) });
  for (let i = 0; i < steps.length; i += 3) pages.push({ kind: "steps", start: i, steps: steps.slice(i, i + 3) });
  return pages;
}

function einkPage(recipe, pages, p) {
  const page = pages[p];
  const name = recipe.title.length > 24 ? `${recipe.title.slice(0, 23)}…` : recipe.title;
  const items = (list) => `<ul class="eink-ing">${list.map((i) => (i.head ? `<li class="eink-section">${esc(i.head.toUpperCase())}</li>` : `<li>${scaleIngredient(i.text, 1)}</li>`)).join("")}</ul>`;
  const body =
    page.kind === "steps"
      ? `<div class="eink-steps">${page.steps.map((s, i) => `<div class="eink-step"><span class="eink-num">${page.start + i + 1}</span><p>${highlight(s)}</p></div>`).join("")}</div>`
      : page.first
        ? `<div class="eink-title">${esc(recipe.title)}</div>
           <div>${esc([recipe.yield && `Serves ${recipe.yield.replace(/^serves\s*/i, "")}`, recipe.totalTime].filter(Boolean).join(" · "))}</div>
           <div class="eink-section">INGREDIENTS</div>${items(page.items)}`
        : `<div class="eink-section">INGREDIENTS, CONTINUED</div>${items(page.items)}`;
  return `<div class="eink-head"><span>${esc(name.toUpperCase())}</span><span>Page ${p + 1} of ${pages.length}</span></div>
    ${body}
    <div class="eink-foot"><span>${p === 0 ? "Back/Menu: list" : "‹ Previous"}</span><span>${p === pages.length - 1 ? "Last page" : pages[p + 1].kind === "steps" && page.kind !== "steps" ? "Next: steps ›" : "Next ›"}</span></div>`;
}

const dayLabel = (iso) => (new Date(iso).toDateString() === new Date().toDateString() ? "Today" : shortDate(iso));

// ---------------------------------------------------------------------------
// Screens

export async function renderCookbook() {
  await refreshLibrary();
  if (!cookbook().connected) return renderPair();
  const items = onDevice();

  app.innerHTML = `
    <section class="screen">
      <header class="topbar"><h1 class="page-title grow">Cookbook</h1></header>
      <div class="pad narrow">
        <div class="box-card"><div class="row">
          <span class="device-thumb" aria-hidden="true"></span>
          <span class="row-text grow"><span class="row-title">Kitchen cookbook</span><span class="row-sub"><span class="dot"></span>Simulator · paired ${shortDate(cookbook().pairedAt)}</span></span>
          <button class="u small" type="button" id="disconnect">Disconnect</button>
        </div></div>
        <div class="row"><h2 class="h3 grow">On your cookbook (${items.length})</h2><a class="u small" href="/cookbook/device" data-link>See it on the device</a></div>
        ${items.length
          ? `<div class="list">${items.map((i) => `<div class="list-row">${thumbHtml(i.recipe, "sm")}
              <a class="row-text grow" href="/recipe/${i.recipe.id}" data-link><span class="row-title">${esc(i.recipe.title)}</span><span class="row-sub">Sent ${dayLabel(i.sentAt)}</span></a>
              <button class="btn btn-sm" type="button" data-remove="${esc(i.recipeId)}">Remove</button></div>`).join("")}</div>`
          : `<p class="muted">Nothing on it yet. Send a few recipes, then cook from the device without touching your phone.</p>`}
        <a class="btn btn-primary" href="/cookbook/send" data-link>Send recipes</a>
        ${bookCallout()}
      </div>
    </section>`;

  app.querySelector(".list")?.addEventListener("click", async (e) => {
    const id = e.target.closest("[data-remove]")?.dataset.remove;
    if (!id) return;
    await saveProfile({ cookbook: { ...cookbook(), items: cookbook().items.filter((i) => i.recipeId !== id) } });
    toast("Removed from your cookbook");
    renderCookbook();
  });
  document.getElementById("disconnect").addEventListener("click", async () => {
    if (!(await confirmDialog("Disconnect the cookbook?", "Recipes on it are cleared. Your library isn't touched.", "Disconnect"))) return;
    await saveProfile({ cookbook: { connected: false, items: [] } });
    renderCookbook();
  });
}

function renderPair() {
  app.innerHTML = `
    <section class="screen">
      <header class="topbar"><h1 class="page-title grow">Cookbook</h1></header>
      <div class="pad narrow center-items">
        <p class="muted center">The Al Dente cookbook is a small e-ink screen for your kitchen. Send a recipe from your phone, then cook without touching your phone. This is a simulator, so you can try it now.</p>
        ${deviceHtml(`<div class="eink-head"><span>AL DENTE</span><span>Ready</span></div><div class="eink-big">Hold Select to pair</div>`)}
        <p class="small muted center" id="pair-hint">Press <b>Select</b> on the device to pair it.</p>
        ${bookCallout()}
      </div>
    </section>`;
  let paired = false;
  const stop = wireDevice(async (key) => {
    if (key !== "select" || paired) return;
    paired = true;
    document.getElementById("eink").innerHTML = `<div class="eink-head"><span>AL DENTE</span><span>Paired</span></div><div class="eink-big">Paired ✓<br>Send a recipe to begin</div>`;
    await saveProfile({ cookbook: { ...cookbook(), connected: true } });
    toast("Cookbook paired");
    setTimeout(() => location.pathname === "/cookbook" && renderCookbook(), 900);
  });
  onLeave(stop);
}

export async function renderDevice() {
  await refreshLibrary();
  if (!cookbook().connected) return navigate("/cookbook", { replace: true });
  const recent = onDevice();
  const all = [...recent].sort((a, b) => a.recipe.title.localeCompare(b.recipe.title));
  const view = { mode: "home", index: 0, recipe: null, pages: [], page: 0, from: "home" };
  const HINTS = {
    home: ["Device: Home", "Recipes you send show up here. Select opens one. Back/Menu opens the library."],
    library: ["Device: Library", "Every recipe on the cookbook. Previous and Next move the highlight."],
    recipe: ["Device: Cook view", "Three steps fit on each page. Next turns the page. Back/Menu returns to the list."],
  };

  app.innerHTML = `
    <section class="screen stage">
      <header class="topbar"><a class="link" href="/cookbook" data-link>‹ Cookbook</a><div class="topbar-title" id="device-title"></div></header>
      <div class="pad center-items">
        <p class="small muted center" id="device-hint"></p>
        ${deviceHtml()}
        <p class="small muted center wide-only">Keyboard works too: arrow keys, Enter, and Esc.</p>
      </div>
    </section>`;

  const screen = document.getElementById("eink");
  const draw = () => {
    const [title, hint] = HINTS[view.mode];
    document.getElementById("device-title").textContent = title;
    document.getElementById("device-hint").textContent = hint;
    const list = view.mode === "home" ? recent : all;
    if (view.mode === "recipe") screen.innerHTML = einkPage(view.recipe, view.pages, view.page);
    else if (!list.length) screen.innerHTML = `<div class="eink-head"><span>AL DENTE</span><span>Simulator</span></div><div class="eink-big">Nothing here yet.<br>Send recipes from the Cookbook tab.</div>`;
    else if (view.mode === "home") screen.innerHTML = einkList("AL DENTE", "Simulator", "Recently sent", recent.map((i) => [i.recipe.title, dayLabel(i.sentAt)]), view.index, ["Select: open", "Back/Menu: library"]);
    else screen.innerHTML = einkList("LIBRARY", `All · ${plural(all.length, "recipe")}`, "", all.map((i) => [i.recipe.title, i.recipe.totalTime || ""]), view.index, ["Select: open", "Back/Menu: home"]);
  };
  const press = (key) => {
    const list = view.mode === "home" ? recent : all;
    if (view.mode === "recipe") {
      if (key === "next") view.page = Math.min(view.pages.length - 1, view.page + 1);
      if (key === "prev") view.page = Math.max(0, view.page - 1);
      if (key === "back") view.mode = view.from;
    } else if (key === "back") {
      view.mode = view.mode === "home" ? "library" : "home";
      view.index = 0;
    } else if (list.length) {
      if (key === "next") view.index = (view.index + 1) % list.length;
      if (key === "prev") view.index = (view.index - 1 + list.length) % list.length;
      if (key === "select") Object.assign(view, { from: view.mode, mode: "recipe", recipe: list[view.index].recipe, pages: einkPages(list[view.index].recipe), page: 0 });
    }
    draw();
  };
  draw();
  onLeave(wireDevice(press));
}

export async function renderSend() {
  await refreshLibrary();
  if (!cookbook().connected) {
    toast("Pair the cookbook first.");
    return navigate("/cookbook", { replace: true });
  }
  const preselected = new URLSearchParams(location.search).get("recipe");
  const selected = new Set(preselected ? [preselected] : state.sendSelection);
  const onIt = new Set(cookbook().items.map((i) => i.recipeId));

  app.innerHTML = `
    <section class="screen">
      <header class="topbar"><a class="link" href="/cookbook" data-link>‹ Cookbook</a><div class="topbar-title">Send recipes</div></header>
      <div class="pad narrow">
        ${state.recipes.length ? `
          <input class="input search" type="search" id="send-search" placeholder="Search recipes" aria-label="Search recipes">
          <div class="row"><span class="small strong grow" id="count" aria-live="polite"></span><button class="u small" type="button" id="select-all">Select all</button></div>
          <div class="stack-sm" id="send-list">${state.recipes.map((r) => `<label class="check-row" data-title="${esc(r.title.toLowerCase())}">
            <input type="checkbox" name="send" value="${r.id}" ${selected.has(r.id) ? "checked" : ""}>${thumbHtml(r, "sm")}
            <span class="row-text grow"><span class="row-title">${esc(r.title)}</span><span class="row-sub">${onIt.has(r.id) ? "Already on your cookbook" : esc([r.category, r.totalTime].filter(Boolean).join(" · "))}</span></span></label>`).join("")}</div>`
        : `<p class="muted">Your library is empty. <a class="u" href="/add" data-link>Add a recipe</a> first.</p>`}
      </div>
      <div class="actionbar"><button class="btn btn-primary" type="button" id="preview">Preview on cookbook</button></div>
    </section>`;

  const boxes = () => [...app.querySelectorAll('input[name="send"]')];
  const count = () => {
    const n = boxes().filter((b) => b.checked).length;
    const label = document.getElementById("count");
    if (label) label.textContent = `${plural(n, "recipe")} selected`;
    document.getElementById("preview").disabled = !n;
  };
  count();
  app.addEventListener("change", count);
  document.getElementById("select-all")?.addEventListener("click", () => {
    boxes().forEach((b) => { b.checked = true; });
    count();
  });
  document.getElementById("send-search")?.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    app.querySelectorAll("#send-list .check-row").forEach((row) => { row.hidden = !row.dataset.title.includes(q); });
  });
  document.getElementById("preview").addEventListener("click", () => {
    state.sendSelection = boxes().filter((b) => b.checked).map((b) => b.value);
    navigate("/cookbook/preview");
  });
  onLeave(() => app.removeEventListener("change", count));
}

export async function renderPreview() {
  await refreshLibrary();
  const chosen = state.sendSelection.map((id) => state.recipes.find((r) => r.id === id)).filter(Boolean);
  if (!chosen.length) return navigate("/cookbook/send", { replace: true });
  let which = 0;
  let page = 0;
  let pages = einkPages(chosen[0]);

  app.innerHTML = `
    <section class="screen">
      <header class="topbar"><a class="link" href="/cookbook/send" data-link>‹ Back</a><div class="topbar-title">Preview on cookbook</div></header>
      <div class="pad center-items">
        <p class="small muted center" id="preview-note"></p>
        ${deviceHtml()}
        ${chosen.length > 1 ? `<div class="row"><button class="btn btn-sm" type="button" data-recipe="-1">‹ Previous recipe</button><span class="small muted" id="which"></span><button class="btn btn-sm" type="button" data-recipe="1">Next recipe ›</button></div>` : ""}
        <p class="small muted center">Previous and Next on the device turn its pages.</p>
      </div>
      <div class="actionbar">
        <a class="btn" href="/cookbook/send" data-link>Edit selection</a>
        <button class="btn btn-primary" type="button" id="send">Send ${plural(chosen.length, "recipe")}</button>
      </div>
    </section>`;

  const draw = () => {
    document.getElementById("preview-note").innerHTML = `This is how <b>${esc(chosen[which].title)}</b> will look on your cookbook's e-ink screen.`;
    document.getElementById("eink").innerHTML = einkPage(chosen[which], pages, page);
    const label = document.getElementById("which");
    if (label) label.textContent = `${which + 1} of ${chosen.length}`;
  };
  draw();
  const stop = wireDevice((key) => {
    if (key === "next") page = Math.min(pages.length - 1, page + 1);
    if (key === "prev") page = Math.max(0, page - 1);
    draw();
  });
  app.querySelectorAll("[data-recipe]").forEach((b) =>
    b.addEventListener("click", () => {
      which = (which + Number(b.dataset.recipe) + chosen.length) % chosen.length;
      pages = einkPages(chosen[which]);
      page = 0;
      draw();
    }),
  );
  document.getElementById("send").addEventListener("click", async (e) => {
    e.target.disabled = true;
    const ids = chosen.map((r) => r.id);
    const now = new Date().toISOString();
    const items = [...cookbook().items.filter((i) => !ids.includes(i.recipeId)), ...ids.map((recipeId) => ({ recipeId, sentAt: now }))];
    await saveProfile({ cookbook: { ...cookbook(), items } });
    state.sendSelection = [];
    navigate(`/cookbook/sent?n=${ids.length}`);
  });
  onLeave(stop);
}

export function renderSent() {
  const n = Number(new URLSearchParams(location.search).get("n")) || 1;
  app.innerHTML = `
    <section class="screen">
      <div class="center-stack">
        <div class="big-check" aria-hidden="true">✓</div>
        <h1 class="h1">Sent to your cookbook</h1>
        <p class="muted">${plural(n, "recipe")} ${n === 1 ? "is" : "are"} on the device's Home screen now.</p>
        <div class="stack w-full">
          <a class="btn btn-primary" href="/cookbook/device" data-link>See it on the device</a>
          <a class="btn" href="/cookbook" data-link>Back to Cookbook</a>
        </div>
      </div>
    </section>`;
}

// ---------------------------------------------------------------------------
// Book view: one page at a time on phones, a two-page spread on wider screens.

function bookPages(recipe) {
  const short = recipe.title.length > 28 ? `${recipe.title.slice(0, 27)}…` : recipe.title;
  const items = recipe.ingredientGroups.flatMap((g) => [...(g.name ? [`<li class="page-sub">${esc(g.name)}</li>`] : []), ...g.items.map((i) => `<li>${scaleIngredient(i, 1)}</li>`)]);
  const steps = recipe.stepGroups.flatMap((g) => g.steps);
  const meta = [recipe.yield, recipe.totalTime, sourceName(recipe) && `From ${sourceName(recipe)}`].filter(Boolean).join(" · ");
  const pages = [`<div class="page-head"><span>Al Dente cookbook</span><span>${esc(recipe.category || "")}</span></div>
    <h2 class="h1">${esc(recipe.title)}</h2>${meta ? `<p class="small muted">${esc(meta)}</p>` : ""}
    <h3 class="page-sub">Ingredients</h3><ul class="page-list">${items.slice(0, 14).join("")}</ul>`];
  for (let i = 14; i < items.length; i += 20) {
    pages.push(`<div class="page-head"><span>${esc(short)}</span><span>Ingredients</span></div><ul class="page-list">${items.slice(i, i + 20).join("")}</ul>`);
  }
  for (let i = 0; i < steps.length; i += 6) {
    pages.push(`<div class="page-head"><span>${esc(short)}</span><span>Steps</span></div>
      <ol class="page-steps">${steps.slice(i, i + 6).map((s, j) => `<li><b>${i + j + 1}.</b> ${esc(s)}</li>`).join("")}</ol>`);
  }
  if (recipe.notes?.length) {
    pages.push(`<div class="page-head"><span>${esc(short)}</span><span>Notes</span></div><ul class="page-list">${recipe.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`);
  }
  return pages;
}

export async function renderBook() {
  await refreshLibrary();
  const id = new URLSearchParams(location.search).get("recipe");
  let index = Math.max(0, state.recipes.findIndex((r) => r.id === id));
  if (!state.recipes.length) {
    app.innerHTML = `<section class="screen">
      <header class="topbar"><a class="link" href="/cookbook" data-link>‹ Cookbook</a><div class="topbar-title">Book view</div></header>
      <div class="center-stack"><div class="big-emoji" aria-hidden="true">📖</div><p class="muted">Add a recipe to read it here.</p><a class="btn btn-primary" href="/add" data-link>+ Add recipe</a></div></section>`;
    return;
  }
  const wide = matchMedia("(min-width: 768px)");
  let pages = bookPages(state.recipes[index]);
  let page = 0;

  app.innerHTML = `
    <section class="screen">
      <header class="topbar"><a class="link" href="/cookbook" data-link>‹ Cookbook</a><div class="topbar-title">Book view</div><button class="link" type="button" id="contents">Contents</button></header>
      <div class="pad detail">
        <p class="small muted">No device? Read your recipes here, one page at a time.</p>
        <div class="book" id="book"></div>
        <div class="row">
          <button class="btn grow" type="button" id="book-prev">‹ Previous page</button>
          <button class="btn btn-primary grow" type="button" id="book-next">Next page ›</button>
        </div>
      </div>
    </section>`;

  const perView = () => (wide.matches ? 2 : 1);
  const draw = () => {
    page -= page % perView();
    document.getElementById("book").innerHTML = pages
      .slice(page, page + perView())
      .map((html, i) => `<article class="page">${html}<div class="page-foot">${page + i + 1} of ${pages.length}</div></article>`)
      .join("");
    const last = page + perView() >= pages.length;
    document.getElementById("book-prev").disabled = page === 0 && index === 0;
    document.getElementById("book-next").textContent = last ? (index < state.recipes.length - 1 ? "Next recipe ›" : "The end") : "Next page ›";
    document.getElementById("book-next").disabled = last && index === state.recipes.length - 1;
    history.replaceState(null, "", `/cookbook/book?recipe=${state.recipes[index].id}`);
  };
  const open = (i, atEnd = false) => {
    index = i;
    pages = bookPages(state.recipes[index]);
    page = atEnd ? pages.length - 1 : 0;
    draw();
  };
  const turn = (dir) => {
    const next = page + dir * perView();
    if (next >= pages.length) {
      if (index < state.recipes.length - 1) open(index + 1);
    } else if (next < 0) {
      if (index > 0) open(index - 1, true);
    } else {
      page = next;
      draw();
    }
  };

  document.getElementById("book-prev").addEventListener("click", () => turn(-1));
  document.getElementById("book-next").addEventListener("click", () => turn(1));
  document.getElementById("contents").addEventListener("click", () => {
    const sheet = openSheet("Contents", `<div class="list">${state.recipes.map((r, i) => `<button class="list-row" type="button" data-open="${i}">${thumbHtml(r, "sm")}
      <span class="row-text grow"><span class="row-title">${esc(r.title)}</span><span class="row-sub">${esc(r.category || "")}</span></span>${i === index ? `<span class="small strong">Reading</span>` : ""}</button>`).join("")}</div>`);
    sheet.addEventListener("click", (e) => {
      const i = e.target.closest("[data-open]")?.dataset.open;
      if (i === undefined) return;
      sheet.remove();
      open(Number(i));
    });
  });
  const onKey = (e) => {
    if (document.querySelector(".overlay, dialog[open]") || e.target.closest?.("input, textarea")) return;
    if (e.key === "ArrowRight") turn(1);
    if (e.key === "ArrowLeft") turn(-1);
  };
  document.addEventListener("keydown", onKey);
  wide.addEventListener("change", draw);
  draw();
  onLeave(() => {
    document.removeEventListener("keydown", onKey);
    wide.removeEventListener("change", draw);
  });
}
