// Shared state, API access, routing helpers, and the small UI pieces every screen uses.
export const app = document.getElementById("app");

export const state = {
  ai: null,
  profile: null,
  categories: [],
  recipes: [],
  communities: [],
  filter: "all",
  search: "",
  community: "all",
  pendingFiles: [],
  sendSelection: [],
  preview: loadPreview(),
};

// ---------------------------------------------------------------------------
// API

export async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    body: options.body && JSON.stringify(options.body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export async function refreshLibrary() {
  [state.recipes, state.categories] = await Promise.all([api("/api/recipes"), api("/api/categories")]);
}

export async function loadStatus() {
  if (state.ai === null) state.ai = (await api("/api/status")).ai;
}

export async function loadCommunities() {
  if (!state.communities.length) state.communities = (await api("/api/community")).communities;
}

export const communityNames = () => Object.fromEntries(state.communities.map((c) => [c.id, c.name]));

export async function saveProfile(changes) {
  state.profile = await api("/api/profile", { method: "PATCH", body: changes });
  applyTheme();
  return state.profile;
}

export function applyTheme() {
  const theme = state.profile?.theme;
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

// ---------------------------------------------------------------------------
// Routing. app.js registers the router; screens call navigate().

let router = () => {};
let cleanup = null;

export function setRouter(fn) {
  router = fn;
}

export function navigate(path, { replace = false } = {}) {
  history[replace ? "replaceState" : "pushState"](null, "", path);
  router();
}

// Screens with timers, recordings, or requests in flight register their cleanup
// here, and it runs when you leave the screen.
export function onLeave(fn) {
  cleanup = fn;
}

export function leave() {
  const fn = cleanup;
  cleanup = null;
  fn?.();
}

// ---------------------------------------------------------------------------
// Dietary checks: a best-effort scan of ingredient names against your dietary needs.

const MEAT = String.raw`chicken|beef|pork|bacon|ham|sausages?|lamb|turkey|duck|veal|prosciutto|pancetta|chorizo|salami|pepperoni|steaks?|anchov(?:y|ies)|fish|salmon|tuna|shrimp|prawns?|crab|lobster|clams?|mussels?|oysters?|scallops?|cod|tilapia|halibut|sardines?|gelatin|lard|bone broth`;
const DAIRY = String.raw`milk|butter|buttermilk|cheese|cream|yogh?urt|ricotta|parmesan|mozzarella|cheddar|ghee|feta|mascarpone|brie|whey|half-and-half|crème fraîche|creme fraiche|paneer|queso|oaxaca|monterey jack|gruy[eè]re|pecorino`;
const EGGS = String.raw`eggs?|egg yolks?|egg whites?|mayonnaise|mayo`;
const GLUTEN = String.raw`flour|wheat|bread|breadcrumbs|panko|pasta|spaghetti|linguine|fettuccine|penne|rigatoni|macaroni|noodles|couscous|barley|rye|semolina|farro|bulgur|soy sauce|beer|tortillas?|crackers|gnocchi|seitan|orzo`;
const NUTS = String.raw`almonds?|walnuts?|pecans?|cashews?|pistachios?|hazelnuts?|peanuts?|macadamias?|pine nuts|nut butter|praline|marzipan|nutella`;
// Phrases that contain a flagged word but are fine for that diet.
const NOT_MEAT = String.raw`(?:vegetable|mushroom) (?:broth|stock)|(?:vegan|plant-based|meatless) \w+`;
const NOT_DAIRY = String.raw`(?:coconut|almond|oat|soy|rice|cashew) (?:milk|cream|yogh?urt|cheese)|(?:peanut|nut|almond|cocoa|apple|shea) butter|butternut|butter (?:beans?|lettuce)|cream of tartar|(?:vegan|dairy-free|plant-based) \w+`;
const NOT_EGGS = String.raw`eggplants?`;
const NOT_GLUTEN = String.raw`(?:rice|almond|coconut|corn|chickpea|oat|cassava|tapioca|buckwheat|potato) flour|cornflour|(?:rice|glass) noodles|(?:gluten-free|corn) \w+|tamari`;
const NOT_NUTS = String.raw`nutmeg|water chestnuts?|butternut|coconut|nut-free \w+`;

export const DIETS = {
  vegetarian: { label: "Vegetarian", flag: "Not vegetarian", avoid: MEAT, fine: NOT_MEAT },
  vegan: { label: "Vegan", flag: "Not vegan", avoid: `${MEAT}|${DAIRY}|${EGGS}|honey`, fine: `${NOT_MEAT}|${NOT_DAIRY}|${NOT_EGGS}` },
  "gluten-free": { label: "Gluten-free", flag: "Has gluten", avoid: GLUTEN, fine: NOT_GLUTEN },
  "dairy-free": { label: "Dairy-free", flag: "Has dairy", avoid: DAIRY, fine: NOT_DAIRY },
  "nut-free": { label: "Nut allergy", flag: "Has nuts", avoid: NUTS, fine: NOT_NUTS },
};

const findWords = (text, pattern) => [...new Set([...text.matchAll(new RegExp(String.raw`\b(?:${pattern})\b`, "gi"))].map((m) => m[0]))];

// [{ flag: "Has dairy", words: ["butter"] }] for each of your dietary needs this recipe may not fit.
export function dietaryFlags(recipe) {
  const profile = state.profile;
  if (!profile || !recipe?.ingredientGroups) return [];
  const text = recipe.ingredientGroups.flatMap((g) => g.items).join("\n").toLowerCase();
  const flags = [];
  for (const id of profile.dietary) {
    const diet = DIETS[id];
    const words = findWords(text.replace(new RegExp(diet.fine, "gi"), " "), diet.avoid);
    if (words.length) flags.push({ flag: diet.flag, words });
  }
  for (const term of (profile.dietaryOther || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean)) {
    if (findWords(text, term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).length) flags.push({ flag: `Has ${term}`, words: [] });
  }
  return flags;
}

export function dietaryBanner(recipe) {
  const flags = dietaryFlags(recipe);
  if (!flags.length) return "";
  const list = flags.map((f) => (f.words.length ? `${f.flag} (${f.words.slice(0, 3).join(", ")})` : f.flag)).join(" · ");
  return `<div class="banner"><b>Heads up:</b> ${esc(list)}. This is based on ingredient names, so check labels too.</div>`;
}

// ---------------------------------------------------------------------------
// Recipe pictures

export function emojiFor(r) {
  const text = `${r.title} ${(r.tags || []).join(" ")} ${r.category || ""}`.toLowerCase();
  const table = [
    [/pasta|spaghetti|noodle|lasagna|ramen|gnocchi/, "🍝"], [/cake|cupcake/, "🍰"], [/cookie/, "🍪"], [/bread|loaf|focaccia|sourdough/, "🍞"],
    [/pie|tart/, "🥧"], [/soup|stew|chili/, "🍲"], [/salad/, "🥗"], [/chicken/, "🍗"], [/beef|steak|burger|pork|roast/, "🥩"],
    [/fish|salmon|shrimp|seafood/, "🐟"], [/taco|burrito|tamale|mexican/, "🌮"], [/pizza/, "🍕"], [/curry|rice/, "🍛"],
    [/egg|breakfast|pancake|waffle/, "🍳"], [/drink|cocktail|smoothie/, "🍹"], [/dessert|chocolate|ice cream/, "🍫"],
  ];
  return table.find(([re]) => re.test(text))?.[1] ?? "🍽️";
}

// Emoji shows until the photo loads, and stays if the photo fails.
export function thumbHtml(r, size) {
  const img = r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
  return `<span class="thumb thumb-${size}" aria-hidden="true">${emojiFor(r)}${img}</span>`;
}

export function avatar(author, size = "") {
  const photo = author.you ? state.profile?.photo : null;
  const inner = photo ? `<img src="${esc(photo)}" alt="">` : esc(author.name?.[0] ?? "?");
  return `<span class="avatar ${size ? `avatar-${size}` : ""} ${author.you ? "is-you" : ""}" aria-hidden="true">${inner}</span>`;
}

// Downscale an image in the browser and re-encode it as JPEG. Keeps uploads small
// and converts formats (like iPhone HEIC in Safari) into something every browser reads.
export async function downscaleImage(file, max) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Couldn't open ${file.name}. Try converting it to JPG first.`);
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

// ---------------------------------------------------------------------------
// Small UI helpers

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

export function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d`;
  return shortDate(iso);
}

export const stars = (n) => (n ? `<span class="stars" aria-label="${n} out of 5">${"★".repeat(n)}${"☆".repeat(5 - n)}</span>` : "");

let toastTimer;
export function toast(message, ms = 2600) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

// A bottom sheet on phones, a centered panel on wide screens. Tapping the backdrop
// or pressing Escape closes it. Returns the overlay so the caller can wire it up.
export function openSheet(title, body) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `<button class="scrim" type="button" aria-label="Close"></button>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-handle"></div><h2 class="h2">${esc(title)}</h2>${body}</div>`;
  app.append(overlay);
  overlay.querySelector(".scrim").addEventListener("click", () => overlay.remove());
  return overlay;
}

export function promptDialog(title, placeholder = "", value = "") {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.innerHTML = `<form method="dialog"><h3 class="h2">${esc(title)}</h3>
      <input class="input" name="v" placeholder="${esc(placeholder)}" value="${esc(value)}" required autofocus>
      <div class="row"><button class="btn btn-text" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" value="ok">Save</button></div></form>`;
    document.body.append(dlg);
    dlg.addEventListener("close", () => {
      const v = dlg.querySelector("input").value.trim();
      resolve(dlg.returnValue === "ok" && v ? v : null);
      dlg.remove();
    });
    dlg.showModal();
  });
}

export function confirmDialog(title, body, action = "Delete") {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.innerHTML = `<form method="dialog"><h3 class="h2">${esc(title)}</h3><p>${esc(body)}</p>
      <div class="row"><button class="btn btn-text" value="cancel">Cancel</button><button class="btn btn-primary" value="ok">${esc(action)}</button></div></form>`;
    document.body.append(dlg);
    dlg.addEventListener("close", () => {
      resolve(dlg.returnValue === "ok");
      dlg.remove();
    });
    dlg.showModal();
  });
}

// The unsaved preview survives a page refresh within the same tab.
function loadPreview() {
  try {
    return JSON.parse(sessionStorage.getItem("al-dente-preview"));
  } catch {
    return null;
  }
}

export function savePreview(recipe) {
  state.preview = recipe;
  try {
    if (recipe) sessionStorage.setItem("al-dente-preview", JSON.stringify(recipe));
    else sessionStorage.removeItem("al-dente-preview");
  } catch {
    // Storage full or disabled; the preview just won't survive a refresh.
  }
}

// Browsers name this differently; it's missing entirely in Firefox.
export const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
