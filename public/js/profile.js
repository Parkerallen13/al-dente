// First-run setup (no accounts: everything stays on this computer), the Profile tab,
// editing your profile, and Settings.
import {
  app, state, api, refreshLibrary, loadCommunities, saveProfile, navigate, esc, toast, plural, shortDate,
  thumbHtml, avatar, stars, downscaleImage, DIETS, confirmDialog,
} from "./core.js";
import { deviceHtml } from "./cookbook.js";

const progress = (step, back) => `<header class="topbar">
  <a class="link" href="${back}" data-link>‹ Back</a>
  <div class="progress" aria-hidden="true">${[1, 2, 3].map((n) => `<span class="${n <= step ? "on" : ""}"></span>`).join("")}</div>
  <span class="small muted">${step} of 3</span></header>`;

const photoHtml = (photo, size = "lg") =>
  `<span class="avatar avatar-${size} is-you" id="photo-preview" aria-hidden="true">${photo ? `<img src="${esc(photo)}" alt="">` : "📷"}</span>`;

// A photo picker that shows a preview and calls set(dataUrl or null).
function wirePhoto(set) {
  const input = document.getElementById("photo-file");
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const photo = await downscaleImage(file, 320);
      set(photo);
      document.getElementById("photo-preview").innerHTML = `<img src="${photo}" alt="">`;
      document.getElementById("photo-remove").hidden = false;
    } catch (err) {
      toast(err.message);
    }
  });
  document.getElementById("photo-remove").addEventListener("click", () => {
    set(null);
    document.getElementById("photo-preview").textContent = "📷";
    document.getElementById("photo-remove").hidden = true;
  });
}

const photoField = (photo) => `<div class="row">
  ${photoHtml(photo)}
  <div class="stack-sm">
    <label class="btn btn-sm">Add photo<input type="file" id="photo-file" accept="image/*" hidden></label>
    <button class="u small self-start" type="button" id="photo-remove" ${photo ? "" : "hidden"}>Remove photo</button>
    <span class="small muted">Optional</span>
  </div></div>`;

const dietFields = (profile) => `<div class="stack-sm">
  ${Object.entries(DIETS).map(([id, d]) => `<label class="check-row"><input type="checkbox" name="dietary" value="${id}" ${profile.dietary.includes(id) ? "checked" : ""}><span>${d.label}</span></label>`).join("")}
  <label class="field"><span class="label">Anything else to avoid?</span>
    <input class="input" name="dietaryOther" value="${esc(profile.dietaryOther)}" placeholder="e.g. shellfish, cilantro (separate with commas)"></label></div>`;

// ---------------------------------------------------------------------------
// First run

export function renderWelcome() {
  app.innerHTML = `
    <section class="screen">
      <div class="onb">
        <div class="hero-art" aria-hidden="true">🍝</div>
        <div class="stack-sm">
          <h1 class="display">Al Dente</h1>
          <p class="lead">Save recipes from anywhere. Cook them from one library.</p>
        </div>
        <div class="onb-foot">
          <a class="btn btn-primary" href="/setup/profile" data-link>Get started</a>
          <button class="btn btn-text" type="button" id="skip">Skip setup</button>
          <p class="small muted center">No account needed. Everything stays on this computer.</p>
        </div>
      </div>
    </section>`;
  document.getElementById("skip").addEventListener("click", async () => {
    await saveProfile({ onboarded: true });
    navigate("/", { replace: true });
  });
}

export function renderSetupProfile() {
  let photo = state.profile.photo;
  app.innerHTML = `
    <form class="screen" id="form">
      ${progress(1, "/welcome")}
      <div class="onb">
        <div class="stack-sm"><h1 class="h1">Create your profile</h1><p class="muted">This is how you show up in communities.</p></div>
        ${photoField(photo)}
        <label class="field"><span class="label">Name</span><input class="input" name="name" value="${esc(state.profile.name)}" placeholder="Your name" autocomplete="given-name"></label>
        <div class="onb-foot"><button class="btn btn-primary" type="submit">Continue</button></div>
      </div>
    </form>`;
  wirePhoto((value) => { photo = value; });
  document.getElementById("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveProfile({ name: e.target.elements.name.value, photo });
    navigate("/setup/dietary");
  });
}

export function renderSetupDietary() {
  app.innerHTML = `
    <form class="screen" id="form">
      ${progress(2, "/setup/profile")}
      <div class="onb">
        <div class="stack-sm"><h1 class="h1">Any dietary needs?</h1><p class="muted">We'll point out recipes that don't fit. You can change this later.</p></div>
        ${dietFields(state.profile)}
        <div class="onb-foot">
          <button class="btn btn-primary" type="submit">Continue</button>
          <a class="btn btn-text" href="/setup/cookbook" data-link>Skip</a>
        </div>
      </div>
    </form>`;
  document.getElementById("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await saveProfile({ dietary: f.getAll("dietary"), dietaryOther: f.get("dietaryOther") });
    navigate("/setup/cookbook");
  });
}

export function renderSetupCookbook() {
  app.innerHTML = `
    <section class="screen">
      ${progress(3, "/setup/dietary")}
      <div class="onb">
        <div class="row" style="justify-content: center">${deviceHtml(`<div class="eink-head"><span>AL DENTE</span><span>Ready</span></div><div class="eink-big">Hold Select to pair</div>`, "sm")}</div>
        <div class="stack-sm">
          <h1 class="h1">Do you have an Al Dente cookbook?</h1>
          <p class="muted">It's a small e-ink screen for your kitchen. Send a recipe from your phone, then cook without touching your phone. The device isn't out yet, so Al Dente includes a simulator you can try.</p>
        </div>
        <div class="onb-foot">
          <button class="btn btn-primary" type="button" data-finish="connect">Set up the simulator</button>
          <button class="btn" type="button" data-finish="skip">Not now</button>
        </div>
      </div>
    </section>`;
  app.querySelectorAll("[data-finish]").forEach((b) =>
    b.addEventListener("click", async () => {
      const connect = b.dataset.finish === "connect";
      await saveProfile({ onboarded: true, ...(connect ? { cookbook: { ...state.profile.cookbook, connected: true } } : {}) });
      if (connect) toast("Cookbook simulator paired");
      navigate("/", { replace: true });
    }),
  );
  // Pressing Select on the little device pairs it too.
  app.querySelector('.device [data-key="select"]').addEventListener("click", () => app.querySelector('[data-finish="connect"]').click());
}

// ---------------------------------------------------------------------------
// Profile tab

export async function renderProfile() {
  const [{ posts }] = await Promise.all([api("/api/community"), refreshLibrary(), loadCommunities()]);
  const p = state.profile;
  const myPosts = posts.filter((post) => post.author.you);
  const cooked = state.recipes.flatMap((r) => (r.cooked || []).map((at) => ({ r, at }))).sort((a, b) => b.at.localeCompare(a.at));
  const joined = state.communities.filter((c) => p.joined.includes(c.id));
  const dietLabels = [...p.dietary.map((id) => DIETS[id]?.label), ...p.dietaryOther.split(",").map((t) => t.trim()).filter(Boolean).map((t) => `No ${t}`)].filter(Boolean);
  const since = p.since ? new Date(p.since).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : null;

  app.innerHTML = `
    <section class="screen">
      <header class="topbar"><h1 class="page-title grow">Profile</h1><a class="link" href="/settings" data-link>Settings ›</a></header>
      <div class="pad narrow">
        <div class="row">
          ${avatar({ name: p.name || "You", you: true }, "lg")}
          <span class="row-text grow"><span class="h2">${esc(p.name || "Your profile")}</span><span class="small muted">${since ? `Cooking with Al Dente since ${since}` : "Add your name and photo"}</span></span>
          <a class="btn btn-sm" href="/profile/edit" data-link>Edit</a>
        </div>
        <section class="section">
          <h2 class="h3">Dietary needs</h2>
          <div class="row row-wrap">${dietLabels.map((l) => `<span class="pill">${esc(l)}</span>`).join("") || `<span class="small muted">None set.</span>`}<a class="u small" href="/profile/edit" data-link>Edit</a></div>
        </section>
        <div class="stats">
          <a class="stat" href="/" data-link><b>${state.recipes.length}</b><span class="small muted">Recipes</span></a>
          <div class="stat"><b>${cooked.length}</b><span class="small muted">Cooked</span></div>
          <a class="stat" href="/community/find" data-link><b>${joined.length}</b><span class="small muted">Communities</span></a>
        </div>
        <section class="section">
          <div class="row"><h2 class="h3 grow">Posts</h2><a class="u small" href="/community/new" data-link>New post</a></div>
          ${myPosts.length
            ? `<div class="thumbs">${myPosts.slice(0, 6).map((post) => `<a href="/community/post/${post.id}" data-link title="${esc(post.caption || post.recipe?.title || "Post")}">${post.recipe ? thumbHtml(post.recipe, "square") : `<span class="thumb thumb-square" aria-hidden="true">💬</span>`}</a>`).join("")}</div>`
            : `<p class="small muted">You haven't posted yet. Share a recipe from its page, or write a post.</p>`}
        </section>
        <section class="section">
          <h2 class="h3">Cooking history</h2>
          ${cooked.length
            ? `<div class="list">${cooked.slice(0, 8).map(({ r, at }) => `<a class="list-row" href="/recipe/${r.id}" data-link>${thumbHtml(r, "sm")}
                <span class="row-text grow"><span class="row-title">${esc(r.title)}</span><span class="row-sub">Made ${shortDate(at)} ${stars(r.rating)}</span></span></a>`).join("")}</div>`
            : `<p class="small muted">Tap <b>I made this</b> on a recipe, or finish cook mode, to log it here.</p>`}
        </section>
        <section class="section">
          <h2 class="h3">Communities</h2>
          <div class="list">
            ${joined.map((c) => `<a class="list-row" href="/community?c=${esc(c.id)}" data-link><span class="shape shape-circle" aria-hidden="true">${esc(c.name[0])}</span>
              <span class="row-text grow"><span class="row-title">${esc(c.name)}</span><span class="row-sub">${plural(posts.filter((post) => post.community === c.id).length, "post")}</span></span><span class="chev" aria-hidden="true">›</span></a>`).join("")}
            <a class="list-row" href="/community/find" data-link><span class="shape shape-circle shape-dashed" aria-hidden="true">+</span><span class="row-title grow">Find communities</span><span class="chev" aria-hidden="true">›</span></a>
          </div>
        </section>
        <a class="list-row" href="/settings" data-link><span class="shape shape-sm" aria-hidden="true">⚙️</span><span class="row-title grow">Settings</span><span class="chev" aria-hidden="true">›</span></a>
      </div>
    </section>`;
}

export function renderEditProfile() {
  let photo = state.profile.photo;
  app.innerHTML = `
    <form class="screen" id="form">
      <header class="topbar">
        <a class="link" href="/profile" data-link>Cancel</a>
        <div class="topbar-title center">Edit profile</div>
        <button class="link strong" type="submit">Save</button>
      </header>
      <div class="pad narrow">
        ${photoField(photo)}
        <label class="field"><span class="label">Name</span><input class="input" name="name" value="${esc(state.profile.name)}" placeholder="Your name"></label>
        <div class="field"><span class="label">Dietary needs</span>${dietFields(state.profile)}</div>
        <button class="btn btn-primary" type="submit">Save</button>
      </div>
    </form>`;
  wirePhoto((value) => { photo = value; });
  document.getElementById("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await saveProfile({ name: f.get("name"), photo, dietary: f.getAll("dietary"), dietaryOther: f.get("dietaryOther") });
    toast("Profile saved");
    navigate("/profile");
  });
}

export function renderSettings() {
  const p = state.profile;
  app.innerHTML = `
    <section class="screen">
      <header class="topbar"><a class="link" href="/profile" data-link>‹ Profile</a><div class="topbar-title">Settings</div></header>
      <div class="pad narrow">
        <section class="section">
          <h2 class="h3">Appearance</h2>
          <div class="seg" role="group" aria-label="Appearance">
            ${[["system", "Match device"], ["light", "Light"], ["dark", "Dark"]].map(([id, label]) => `<button type="button" data-theme-pick="${id}" class="${p.theme === id ? "is-active" : ""}" aria-pressed="${p.theme === id}">${label}</button>`).join("")}
          </div>
        </section>
        <section class="section">
          <h2 class="h3">Cookbook</h2>
          <a class="list-row" href="/cookbook" data-link><span class="device-thumb device-thumb-sm" aria-hidden="true"></span>
            <span class="row-text grow"><span class="row-title">Kitchen cookbook</span><span class="row-sub">${p.cookbook.connected ? "Simulator paired" : "Not paired"}</span></span><span class="chev" aria-hidden="true">›</span></a>
        </section>
        <section class="section">
          <h2 class="h3">Your data</h2>
          <p class="small muted">Recipes, posts, and this profile are saved in the <code>data</code> folder inside Al Dente on this computer. Nothing else leaves it, except the recipe links Al Dente fetches and what you send to the AI to read a recipe or answer a question.</p>
          <button class="btn self-start" type="button" id="setup">Run setup again</button>
        </section>
      </div>
    </section>`;
  app.querySelectorAll("[data-theme-pick]").forEach((b) =>
    b.addEventListener("click", async () => {
      await saveProfile({ theme: b.dataset.themePick });
      app.querySelectorAll("[data-theme-pick]").forEach((x) => {
        x.classList.toggle("is-active", x === b);
        x.setAttribute("aria-pressed", x === b);
      });
    }),
  );
  document.getElementById("setup").addEventListener("click", async () => {
    if (!(await confirmDialog("Run setup again?", "You'll go through the welcome screens again. Your recipes and posts stay.", "Start setup"))) return;
    await saveProfile({ onboarded: false });
    navigate("/welcome");
  });
}
