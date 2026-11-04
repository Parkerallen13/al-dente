// Al Dente web app. Screens follow the wireframe in wireframe/ and render into #app;
// the tab bar in index.html stays put and hides on focused screens. Each tab's
// screens live in public/js/.
import { app, state, api, navigate, setRouter, leave, applyTheme, esc } from "./js/core.js";
import { renderLibrary, renderImport, renderShare } from "./js/library.js";
import { blankRecipe, renderForm, renderSaved, renderRecipe, renderDone } from "./js/recipe.js";
import { renderCook } from "./js/cook.js";
import { renderCookbook, renderDevice, renderSend, renderPreview, renderSent, renderBook } from "./js/cookbook.js";
import { renderFeed, renderPost, renderNewPost, renderFindCommunities, renderCommunityRecipe, renderPerson } from "./js/community.js";
import { wireLayoutMenu } from "./js/layout-menu.js";
import { renderWelcome, renderSetupProfile, renderSetupDietary, renderSetupCookbook, renderProfile, renderEditProfile, renderSettings } from "./js/profile.js";

const recipe = (id) => api(`/api/recipes/${id}`);

// [path pattern, render(match)]. The first match wins.
const ROUTES = [
  [/^\/welcome$/, renderWelcome],
  [/^\/setup\/profile$/, renderSetupProfile],
  [/^\/setup\/dietary$/, renderSetupDietary],
  [/^\/setup\/cookbook$/, renderSetupCookbook],
  [/^\/(add)?$/, (m) => renderLibrary({ sheet: Boolean(m[1]) })],
  [/^\/add\/(link|photo|text|voice|generate)$/, (m) => renderImport(m[1])],
  [/^\/add\/manual$/, () => renderForm(blankRecipe(), "new")],
  [/^\/share$/, renderShare],
  [/^\/preview$/, () => (state.preview ? renderForm(state.preview, "review") : navigate("/add", { replace: true }))],
  [/^\/saved\/([\w-]+)$/, async (m) => renderSaved(await recipe(m[1]))],
  [/^\/recipe\/([\w-]+)$/, async (m) => renderRecipe(await recipe(m[1]))],
  [/^\/recipe\/([\w-]+)\/edit$/, async (m) => renderForm(await recipe(m[1]), "edit")],
  [/^\/recipe\/([\w-]+)\/cook$/, async (m) => renderCook(await recipe(m[1]))],
  [/^\/recipe\/([\w-]+)\/done$/, async (m) => renderDone(await recipe(m[1]))],
  [/^\/cookbook$/, renderCookbook],
  [/^\/cookbook\/device$/, renderDevice],
  [/^\/cookbook\/send$/, renderSend],
  [/^\/cookbook\/preview$/, renderPreview],
  [/^\/cookbook\/sent$/, renderSent],
  [/^\/cookbook\/book$/, renderBook],
  [/^\/community$/, renderFeed],
  [/^\/community\/new$/, renderNewPost],
  [/^\/community\/find$/, renderFindCommunities],
  [/^\/community\/post\/([\w-]+)$/, (m) => renderPost(m[1])],
  [/^\/community\/post\/([\w-]+)\/recipe$/, (m) => renderCommunityRecipe(m[1])],
  [/^\/community\/person\/([^/]+)$/, (m) => renderPerson(decodeURIComponent(m[1]))],
  [/^\/profile$/, renderProfile],
  [/^\/profile\/edit$/, renderEditProfile],
  [/^\/settings$/, renderSettings],
];

// Screens without the tab bar: setup, adding, reviewing, editing, cooking, and posting.
const FOCUS_SCREENS = /^\/(welcome|setup\/|add\/|share|preview$|saved\/|recipe\/[\w-]+\/(edit|cook|done)$|community\/new$|profile\/edit$)/;
const TABS = [["cookbook", /^\/cookbook/], ["community", /^\/community/], ["profile", /^\/(profile|settings)/], ["recipes", /./]];

// Editorial and Bold animate between screens; Classic and reduced-motion don't.
const animates = () =>
  document.documentElement.dataset.layout !== "classic" && document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches;
let enteringTimer;

async function render() {
  leave();
  const path = location.pathname;
  if (!state.profile.onboarded && !/^\/(welcome|setup\/|share)/.test(path)) return navigate("/welcome", { replace: true });
  if (!animates()) return draw(path);
  // "entering" lets cards and posts animate in once per screen, not on every redraw.
  app.classList.add("entering");
  clearTimeout(enteringTimer);
  enteringTimer = setTimeout(() => app.classList.remove("entering"), 1000);
  document.startViewTransition(() => draw(path));
}

async function draw(path) {
  document.body.classList.toggle("is-focus", FOCUS_SCREENS.test(path));
  const tab = TABS.find(([, re]) => re.test(path))[0];
  document.querySelectorAll(".nav [data-tab]").forEach((a) => {
    a.classList.toggle("is-active", a.dataset.tab === tab);
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);

  try {
    for (const [pattern, screen] of ROUTES) {
      const m = path.match(pattern);
      if (m) return await screen(m);
    }
    navigate("/", { replace: true });
  } catch (err) {
    document.body.classList.remove("is-focus");
    app.innerHTML = `<section class="screen"><div class="center-stack">
      <div class="big-emoji" aria-hidden="true">🥲</div><h1 class="h2">${esc(err.message)}</h1>
      <a class="btn" href="/" data-link>Back to library</a></div></section>`;
  }
}

setRouter(render);

document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-link]");
  if (!link || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  navigate(link.getAttribute("href"));
});
window.addEventListener("popstate", render);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.querySelector("dialog[open]")) document.querySelector(".overlay .scrim")?.click();
});

try {
  state.profile = await api("/api/profile");
} catch {
  // The server is unreachable; show the app with defaults rather than a blank page.
  state.profile = { onboarded: true, name: "", photo: null, dietary: [], dietaryOther: "", theme: "system", layout: "classic", joined: [], cookbook: { connected: false, items: [] } };
}
applyTheme();
wireLayoutMenu();
render();
