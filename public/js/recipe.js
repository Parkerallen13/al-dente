// Recipe form (review, new, edit), the saved screen, recipe detail, and the
// "done cooking" screen. Also the ingredient scaling everything else uses.
import {
  app, state, api, navigate, esc, toast, plural, shortDate, openSheet, promptDialog, confirmDialog,
  thumbHtml, dietaryBanner, savePreview,
} from "./core.js";

export function blankRecipe() {
  return {
    title: "", description: "", author: "", source: { type: "manual", url: null, name: null }, image: null,
    yield: "", prepTime: "", cookTime: "", totalTime: "", ingredientGroups: [], stepGroups: [], notes: [], tags: [],
  };
}

const FORM_MODES = {
  review: { title: "Review recipe", cancel: "Discard", save: "Save to Library" },
  new: { title: "New recipe", cancel: "Cancel", save: "Save recipe" },
  edit: { title: "Edit recipe", cancel: "Cancel", save: "Save changes" },
};

export async function renderForm(recipe, mode) {
  state.categories = await api("/api/categories");
  const labels = FORM_MODES[mode];
  let category =
    mode === "edit" ? recipe.category
    : mode === "review" ? guessCategory(recipe)
    : state.filter.startsWith("cat:") ? state.filter.slice(4) : null;

  const groupsToText = (groups, key) => groups.map((g) => (g.name ? `# ${g.name}\n` : "") + g[key].join("\n")).join("\n\n");
  const textToGroups = (text, key) => {
    const groups = [{ name: "", [key]: [] }];
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith("#")) groups.push({ name: line.replace(/^#+\s*/, ""), [key]: [] });
      else groups.at(-1)[key].push(line);
    }
    return groups.filter((g) => g[key].length);
  };
  const input = (name, label, placeholder = "") =>
    `<label class="field grow"><span class="label">${label}</span><input class="input" name="${name}" value="${esc(recipe[name])}" placeholder="${placeholder}"></label>`;
  const unsure = mode === "review" ? recipe.uncertain ?? [] : [];

  app.innerHTML = `
    <form class="screen" id="recipe-form">
      <header class="topbar">
        <a class="link" href="${mode === "edit" ? `/recipe/${recipe.id}` : "/add"}" data-link id="cancel">${labels.cancel}</a>
        <div class="topbar-title center">${labels.title}</div>
        <button class="link strong" type="submit">Save</button>
      </header>
      <div class="pad narrow">
        ${mode === "review" ? `<div class="banner">${unsure.length ? `We weren't sure about ${plural(unsure.length, "thing")}. Please check them below, then save.` : "Here's what we found. Check it over, fix anything that looks off, then save it."}</div>` : ""}
        ${unsure.map((u) => `<div class="unsure"><span class="tag-check">Please check</span><b>${esc(u.field)}</b><span class="hint">${esc(u.note)}</span></div>`).join("")}
        ${dietaryBanner(recipe)}
        ${recipe.image ? thumbHtml(recipe, "banner") : ""}
        <label class="field"><span class="label">Title</span><input class="input" name="title" value="${esc(recipe.title)}" placeholder="Recipe name" required></label>
        ${sourceBox(recipe)}
        <label class="field"><span class="label">Description</span><textarea class="input" name="description" rows="3">${esc(recipe.description)}</textarea></label>
        <div class="row">${input("yield", "Servings", "4 servings")}${input("totalTime", "Total time", "30 min")}</div>
        <div class="row">${input("prepTime", "Prep")}${input("cookTime", "Cook")}</div>
        <label class="field"><span class="label">Ingredients</span>
          <textarea class="input" name="ingredients" rows="10" placeholder="1 cup basmati rice&#10;3 garlic cloves">${esc(groupsToText(recipe.ingredientGroups, "items"))}</textarea>
          <span class="hint">One per line. Start a line with # to make a section, like “# For the sauce”.</span></label>
        <label class="field"><span class="label">Steps</span>
          <textarea class="input" name="steps" rows="10" placeholder="Rinse the rice.&#10;Simmer it, covered, for 15 minutes.">${esc(groupsToText(recipe.stepGroups, "steps"))}</textarea>
          <span class="hint">One step per line. # makes a section here too.</span></label>
        <label class="field"><span class="label">Notes</span><textarea class="input" name="notes" rows="3">${esc((recipe.notes || []).join("\n"))}</textarea></label>
        <label class="field"><span class="label">Tags</span><input class="input" name="tags" value="${esc((recipe.tags || []).join(", "))}" placeholder="weeknight, vegetarian">
          <span class="hint">Separate with commas.</span></label>
        <label class="field"><span class="label">Photo link</span><input class="input" name="image" value="${esc(recipe.image || "")}" placeholder="https://"></label>
        <div class="field"><span class="label">Collection</span><div class="row row-wrap" id="collections"></div></div>
        <button class="btn btn-primary" type="submit">${labels.save}</button>
      </div>
    </form>`;

  const form = document.getElementById("recipe-form");
  const drawCollections = () => {
    document.getElementById("collections").innerHTML =
      [{ name: "" }, ...state.categories]
        .map((c) => `<label class="chip"><input type="radio" name="category" value="${esc(c.name)}" ${c.name === (category ?? "") ? "checked" : ""}>${c.name ? esc(c.name) : "None"}</label>`)
        .join("") + `<button class="chip chip-dashed" type="button" id="new-collection">+ New</button>`;
  };
  drawCollections();
  document.getElementById("collections").addEventListener("click", async (e) => {
    if (!e.target.closest("#new-collection")) return;
    const name = await promptDialog("New collection", "e.g. Holiday baking");
    if (!name) return;
    state.categories = await api("/api/categories", { method: "POST", body: { name } });
    category = name;
    drawCollections();
  });
  form.addEventListener("change", (e) => {
    if (e.target.name === "category") category = e.target.value || null;
  });
  if (mode === "review") document.getElementById("cancel").addEventListener("click", () => savePreview(null));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const fields = {
      title: f.title.trim(),
      description: f.description.trim(),
      yield: f.yield.trim(),
      prepTime: f.prepTime.trim(),
      cookTime: f.cookTime.trim(),
      totalTime: f.totalTime.trim(),
      ingredientGroups: textToGroups(f.ingredients, "items"),
      stepGroups: textToGroups(f.steps, "steps"),
      notes: f.notes.split("\n").map((s) => s.trim()).filter(Boolean),
      tags: f.tags.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
      image: f.image.trim() || null,
      category: category || null,
    };
    const buttons = form.querySelectorAll('[type="submit"]');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      if (mode === "edit") {
        await api(`/api/recipes/${recipe.id}`, { method: "PATCH", body: fields });
        toast("Changes saved");
        return navigate(`/recipe/${recipe.id}`);
      }
      const { suggestedCategory: _suggested, uncertain: _uncertain, ...rest } = recipe;
      const saved = await api("/api/recipes", { method: "POST", body: { ...rest, ...fields } });
      if (mode === "review") savePreview(null);
      navigate(`/saved/${saved.id}`);
    } catch (err) {
      toast(err.message);
      buttons.forEach((b) => { b.disabled = false; });
    }
  });
}

// Match the source's category/tags against the user's categories, ignoring
// plurals ("Dessert" → "Desserts") and "&"-joined names ("Soups & Salads").
function guessCategory(recipe) {
  const stem = (w) => w.toLowerCase().trim().replace(/e?s$/, "");
  const hints = [recipe.suggestedCategory, ...(recipe.tags || [])]
    .filter(Boolean)
    .flatMap((h) => h.split(/,|&|\band\b/))
    .map(stem)
    .filter(Boolean);
  for (const hint of hints) {
    const hit = state.categories.find((c) => c.name.split(/&|\band\b/).map(stem).includes(hint));
    if (hit) return hit.name;
  }
  return undefined;
}

export function renderSaved(recipe) {
  app.innerHTML = `
    <section class="screen">
      <header class="topbar"><span class="spacer"></span><a class="link strong" href="/" data-link>Done</a></header>
      <div class="center-stack">
        <div class="big-check" aria-hidden="true">✓</div>
        <h1 class="h1">Saved to Library</h1>
        <div class="mini-card">${thumbHtml(recipe, "md")}
          <span class="row-text grow"><span class="row-title">${esc(recipe.title)}</span><span class="row-sub" id="saved-where">${esc(recipe.category ? `In ${recipe.category}` : sourceName(recipe))}</span></span></div>
        <div class="stack w-full">
          <a class="btn btn-primary" href="/recipe/${recipe.id}" data-link>View recipe</a>
          <button class="btn" type="button" id="collection">${recipe.category ? "Change collection" : "Add to collection"}</button>
          <a class="btn btn-text" href="/recipe/${recipe.id}/edit" data-link>Edit</a>
        </div>
        <a class="u small" href="/add" data-link>Add another recipe</a>
      </div>
    </section>`;
  document.getElementById("collection").addEventListener("click", () =>
    collectionSheet(recipe, (updated) => {
      recipe = updated;
      document.getElementById("saved-where").textContent = recipe.category ? `In ${recipe.category}` : sourceName(recipe);
      document.getElementById("collection").textContent = recipe.category ? "Change collection" : "Add to collection";
    }),
  );
}

// Pick one collection (or none) for a recipe. Calls done with the updated recipe.
export async function collectionSheet(recipe, done) {
  state.categories = await api("/api/categories");
  const rows = [{ name: "", count: null }, ...state.categories]
    .map((c) => `<label class="list-row"><span class="shape shape-sm" aria-hidden="true">${c.name ? "📁" : "—"}</span>
      <span class="row-text grow"><span class="row-title">${c.name ? esc(c.name) : "No collection"}</span>${c.name ? `<span class="row-sub">${plural(c.count, "recipe")}</span>` : ""}</span>
      <input type="radio" name="pick-collection" value="${esc(c.name)}" ${c.name === (recipe.category ?? "") ? "checked" : ""}></label>`)
    .join("");
  const sheet = openSheet("Add to collection", `
    <p class="small muted">${esc(recipe.title)}</p>
    <div class="list">${rows}<button class="list-row" type="button" data-new><span class="shape shape-sm shape-dashed" aria-hidden="true">+</span><span class="row-title">New collection</span></button></div>
    <button class="btn btn-primary" type="button" data-done>Done</button>`);
  const save = async (category) => {
    recipe = await api(`/api/recipes/${recipe.id}`, { method: "PATCH", body: { category: category || null } });
    sheet.remove();
    toast(category ? `In ${category}` : "Removed from collection");
    done(recipe);
  };
  sheet.querySelector("[data-new]").addEventListener("click", async () => {
    const name = await promptDialog("New collection", "e.g. Holiday baking");
    if (name) save(name);
  });
  sheet.querySelector("[data-done]").addEventListener("click", () => save(sheet.querySelector("input:checked")?.value));
}

const SOURCE_TYPES = {
  website: ["🔗", "Website"],
  social: ["📱", "Social post"],
  photo: ["📷", "Photo"],
  text: ["📝", "Pasted text"],
  voice: ["🎙️", "Voice memo"],
  manual: ["✏️", "Typed in"],
  community: ["💬", "Community post"],
};

export function sourceName(recipe) {
  return recipe.source?.name || SOURCE_TYPES[recipe.source?.type]?.[1] || "";
}

function sourceBox(recipe) {
  const s = recipe.source;
  if (!s || s.type === "manual") return "";
  const [icon, kind] = SOURCE_TYPES[s.type] ?? ["🔗", "Source"];
  const sub = [recipe.author && `by ${recipe.author}`, s.name && kind, s.transcript && "Transcript saved"].filter(Boolean).join(" · ");
  const url = /^https?:\/\//i.test(s.url || "") ? s.url : null;
  return `<div class="source"><span class="label">Source</span><div class="row">
    <span class="shape" aria-hidden="true">${icon}</span>
    <span class="row-text grow"><span class="row-title">${esc(s.name || kind)}</span>${sub ? `<span class="row-sub">${esc(sub)}</span>` : ""}</span>
    ${url ? `<a class="u small" href="${esc(url)}" target="_blank" rel="noopener">View original</a>` : ""}
    ${s.postId ? `<a class="u small" href="/community/post/${esc(s.postId)}" data-link>View post</a>` : ""}
  </div>
  ${s.transcript ? `<details class="transcript"><summary class="u small">Read the transcript</summary><p class="quote">${esc(s.transcript)}</p></details>` : ""}</div>`;
}

// ---------------------------------------------------------------------------
// Recipe detail

const SERVING_FACTORS = [0.5, 1, 1.5, 2, 3, 4];
const localDay = (iso) => new Date(iso).toLocaleDateString("sv");
const madeToday = (recipe) => (recipe.cooked || []).some((iso) => localDay(iso) === localDay(new Date()));

// Five tappable stars. Tapping the current rating clears it.
export function starInput(rating, label = "Your rating") {
  return `<div class="star-input" role="radiogroup" aria-label="${label}">
    ${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${n === rating}" aria-label="${plural(n, "star")}" data-star="${n}" class="${n <= (rating || 0) ? "is-on" : ""}">★</button>`).join("")}
  </div>`;
}

export function wireStars(el, onChange) {
  el.addEventListener("click", (e) => {
    const n = Number(e.target.closest("[data-star]")?.dataset.star);
    if (!n) return;
    const current = el.querySelectorAll(".is-on").length;
    const rating = n === current ? 0 : n;
    el.querySelectorAll("[data-star]").forEach((b, i) => {
      b.classList.toggle("is-on", i < rating);
      b.setAttribute("aria-checked", i + 1 === rating);
    });
    onChange(rating || null);
  });
}

export async function renderRecipe(recipe) {
  let factorIndex = SERVING_FACTORS.indexOf(1);
  const stepState = { done: new Set(), current: 0 };
  const cookedCount = (recipe.cooked || []).length;

  const pills = [["Prep", recipe.prepTime], ["Cook", recipe.cookTime], ["Total", recipe.totalTime]]
    .filter(([, v]) => v)
    .map(([k, v]) => `<span class="pill"><span class="muted">${k}</span>${esc(v)}</span>`)
    .join("");
  let n = 0;
  const steps = recipe.stepGroups
    .map((g) => `${g.name ? `<h3 class="group-name">${esc(g.name)}</h3>` : ""}
      <ol class="steps">${g.steps.map((s) => `<li><span class="step-num">${++n}</span><p>${esc(s)}</p></li>`).join("")}</ol>`)
    .join("");

  app.innerHTML = `
    <article class="screen">
      <header class="topbar">
        <a class="link" href="/" data-link>‹ Library</a>
        <span class="topbar-title"></span>
        <a class="link" href="/community/new?recipe=${recipe.id}" data-link>Share</a>
        <a class="link" href="/recipe/${recipe.id}/edit" data-link>Edit</a>
      </header>
      <div class="pad detail">
        ${thumbHtml(recipe, "hero")}
        <div class="stack-sm">
          ${recipe.category ? `<span class="eyebrow">${esc(recipe.category)}</span>` : ""}
          <h1 class="h1">${esc(recipe.title)}</h1>
          <div class="row row-wrap">${pills}
            <span class="small muted" id="made-count">${cookedCount ? `Made ${plural(cookedCount, "time")}` : ""}</span>
            <button class="btn btn-sm ${recipe.favorite ? "is-on" : ""}" type="button" id="fav" aria-pressed="${Boolean(recipe.favorite)}">${recipe.favorite ? "★ Favorite" : "☆ Favorite"}</button></div>
          ${recipe.description ? `<p class="desc lead">${esc(recipe.description)}</p>` : ""}
        </div>
        ${dietaryBanner(recipe)}
        ${sourceBox(recipe)}
        <button class="list-row collection-row" type="button" id="collection"><span class="label grow">Collection</span><span class="strong" id="collection-name">${esc(recipe.category || "None")}</span><span class="chev" aria-hidden="true">›</span></button>
        <div class="detail-cols">
          <section class="section">
            <h2 class="h2">Ingredients</h2>
            <div class="row"><span class="label grow">Servings</span>
              <div class="stepper"><button type="button" data-step="-1" aria-label="Fewer servings">−</button><span id="servings" aria-live="polite"></span><button type="button" data-step="1" aria-label="More servings">+</button></div></div>
            <div id="ing"></div>
          </section>
          <section class="section">
            <h2 class="h2">Steps</h2>
            <p class="hint">Tap a step to mark it done.</p>
            ${steps || `<p class="muted">No steps yet. <a class="u" href="/recipe/${recipe.id}/edit" data-link>Add some</a>.</p>`}
            ${recipe.notes?.length ? `<div class="notes"><h3 class="h3">Notes from the recipe</h3><ul>${recipe.notes.map((note) => `<li>${esc(note)}</li>`).join("")}</ul></div>` : ""}
            ${recipe.tags?.length ? `<div class="tags">${recipe.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
          </section>
        </div>
        <section class="section">
          <h2 class="h3">Your rating</h2>
          <div class="row row-wrap">${starInput(recipe.rating)}<span class="spacer"></span>
            <button class="btn btn-sm ${madeToday(recipe) ? "is-on" : ""}" type="button" id="made" aria-pressed="${madeToday(recipe)}">${madeToday(recipe) ? "Made it today ✓" : "I made this"}</button></div>
        </section>
        <label class="section"><span class="h3">Your notes</span>
          <textarea class="input" id="my-notes" rows="3" placeholder="Swaps you made, what to try next time">${esc(recipe.myNotes)}</textarea>
          <span class="hint" id="notes-status" aria-live="polite">Saved as you type. Only you see these.</span></label>
        <section class="section detail-tools">
          <div class="row row-wrap">
            <a class="btn btn-sm" href="/cookbook/book?recipe=${recipe.id}" data-link>Read as a book</a>
            <button class="btn btn-sm" type="button" id="print">Print</button>
            <button class="btn btn-sm btn-text danger" type="button" id="delete">Delete recipe</button>
          </div>
        </section>
      </div>
      <div class="actionbar">
        <a class="btn" href="/cookbook/send?recipe=${recipe.id}" data-link>Send to cookbook</a>
        <a class="btn btn-primary" href="/recipe/${recipe.id}/cook" data-link>Start cooking</a>
      </div>
    </article>`;

  const checked = new Set();
  const drawIngredients = () => {
    const factor = SERVING_FACTORS[factorIndex];
    let i = 0;
    document.getElementById("servings").innerHTML = `<b>${esc(scaleYield(recipe.yield, factor))}</b>`;
    document.querySelector('[data-step="-1"]').disabled = factorIndex === 0;
    document.querySelector('[data-step="1"]').disabled = factorIndex === SERVING_FACTORS.length - 1;
    document.getElementById("ing").innerHTML =
      recipe.ingredientGroups
        .map((g) => `${g.name ? `<h3 class="group-name">${esc(g.name)}</h3>` : ""}<ul class="ingredients">
          ${g.items.map((item) => {
            const id = i++;
            return `<li><label><input type="checkbox" data-i="${id}" ${checked.has(id) ? "checked" : ""}><span>${scaleIngredient(item, factor)}</span></label></li>`;
          }).join("")}</ul>`)
        .join("") || `<p class="muted">No ingredients yet.</p>`;
  };
  drawIngredients();
  document.getElementById("ing").addEventListener("change", (e) => {
    const i = Number(e.target.dataset.i);
    e.target.checked ? checked.add(i) : checked.delete(i);
  });
  app.querySelector(".stepper").addEventListener("click", (e) => {
    const step = Number(e.target.closest("[data-step]")?.dataset.step);
    if (!step) return;
    factorIndex = Math.min(SERVING_FACTORS.length - 1, Math.max(0, factorIndex + step));
    drawIngredients();
  });

  const stepEls = [...app.querySelectorAll(".steps li")];
  const drawSteps = () =>
    stepEls.forEach((li, i) => {
      li.classList.toggle("done", stepState.done.has(i));
      li.classList.toggle("current", i === stepState.current);
    });
  stepEls.forEach((li, i) =>
    li.addEventListener("click", () => {
      if (stepState.done.has(i)) {
        stepState.done.delete(i);
        stepState.current = i;
      } else {
        stepState.done.add(i);
        const next = stepEls.findIndex((_, j) => j > i && !stepState.done.has(j));
        stepState.current = next;
        if (next >= 0) stepEls[next].scrollIntoView({ behavior: "smooth", block: "center" });
      }
      drawSteps();
    }),
  );
  drawSteps();

  const patch = async (changes) => {
    recipe = await api(`/api/recipes/${recipe.id}`, { method: "PATCH", body: changes });
    return recipe;
  };

  app.querySelector(".desc")?.addEventListener("click", (e) => e.currentTarget.classList.toggle("open"));
  document.getElementById("print").addEventListener("click", () => print());

  const fav = document.getElementById("fav");
  fav.addEventListener("click", async () => {
    await patch({ favorite: !recipe.favorite });
    fav.textContent = recipe.favorite ? "★ Favorite" : "☆ Favorite";
    fav.classList.toggle("is-on", recipe.favorite);
    fav.setAttribute("aria-pressed", recipe.favorite);
  });

  document.getElementById("collection").addEventListener("click", () =>
    collectionSheet(recipe, (updated) => {
      recipe = updated;
      document.getElementById("collection-name").textContent = recipe.category || "None";
    }),
  );

  wireStars(app.querySelector(".star-input"), async (rating) => {
    await patch({ rating });
    toast(rating ? `Rated ${plural(rating, "star")}` : "Rating cleared");
  });

  const made = document.getElementById("made");
  made.addEventListener("click", async () => {
    const today = localDay(new Date());
    const cooked = recipe.cooked || [];
    const lastToday = cooked.findLastIndex((iso) => localDay(iso) === today);
    await patch({ cooked: lastToday >= 0 ? cooked.filter((_, i) => i !== lastToday) : [...cooked, new Date().toISOString()] });
    const on = madeToday(recipe);
    made.textContent = on ? "Made it today ✓" : "I made this";
    made.classList.toggle("is-on", on);
    made.setAttribute("aria-pressed", on);
    const count = recipe.cooked.length;
    document.getElementById("made-count").textContent = count ? `Made ${plural(count, "time")}` : "";
  });

  const notes = document.getElementById("my-notes");
  const status = document.getElementById("notes-status");
  let notesTimer;
  notes.addEventListener("input", () => {
    status.textContent = "Saving…";
    clearTimeout(notesTimer);
    notesTimer = setTimeout(async () => {
      try {
        await patch({ myNotes: notes.value.trim() });
        status.textContent = "Saved. Only you see these.";
      } catch (err) {
        status.textContent = `Couldn't save: ${err.message}`;
      }
    }, 600);
  });

  document.getElementById("delete").addEventListener("click", async () => {
    if (!(await confirmDialog("Delete this recipe?", "This can't be undone."))) return;
    await api(`/api/recipes/${recipe.id}`, { method: "DELETE" });
    toast("Recipe deleted");
    navigate("/");
  });
}

// Shown after the last page of cook mode.
export function renderDone(recipe) {
  let rating = recipe.rating ?? null;
  app.innerHTML = `
    <section class="screen">
      <header class="topbar"><span class="spacer"></span><a class="link" href="/recipe/${recipe.id}" data-link>Skip</a></header>
      <div class="center-stack">
        <div class="big-check" aria-hidden="true">✓</div>
        <h1 class="h1">Nice work!</h1>
        <p class="muted">How did ${esc(recipe.title)} turn out?</p>
        ${starInput(rating, "How it turned out")}
        <div class="stack w-full">
          <button class="btn btn-primary" type="button" id="log">Log that I made it</button>
          <a class="btn" href="/community/new?recipe=${recipe.id}&made=1" data-link>Share it with a community</a>
        </div>
        <p class="small muted">${recipe.cooked?.length ? `You've made this ${plural(recipe.cooked.length, "time")}, last on ${shortDate(recipe.cooked.at(-1))}.` : "First time making this one."}</p>
      </div>
    </section>`;
  wireStars(app.querySelector(".star-input"), (value) => {
    rating = value;
  });
  document.getElementById("log").addEventListener("click", async (e) => {
    e.target.disabled = true;
    await api(`/api/recipes/${recipe.id}`, { method: "PATCH", body: { rating, cooked: [...(recipe.cooked || []), new Date().toISOString()] } });
    toast("Logged in your cooking history");
    navigate(`/recipe/${recipe.id}`);
  });
}

// "4 servings" → "8 servings", "6–8" → "12–16". Yields without a number show the multiplier.
function scaleYield(text, factor) {
  const m = text?.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?/);
  if (!m) return factor === 1 && text ? text : `${formatNumber(factor)}× ${text || "recipe"}`;
  const scaled = formatNumber(Number(m[1]) * factor) + (m[2] ? `–${formatNumber(Number(m[2]) * factor)}` : "");
  return text.replace(m[0], scaled);
}

// ---------------------------------------------------------------------------
// Ingredient scaling: finds the leading quantity ("1 1/2", "½", "2-3") and
// multiplies it, bolding the amount so it's easy to scan.

const FRACTIONS = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875 };
const NUM = String.raw`(?:\d+\s*[½⅓⅔¼¾⅛⅜⅝⅞]|\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[½⅓⅔¼¾⅛⅜⅝⅞])`;
const QTY_RE = new RegExp(`^(${NUM})(\\s*(?:-|–|to)\\s*(${NUM}))?`);

function toNumber(s) {
  return s
    .trim()
    .split(/\s+|(?=[½⅓⅔¼¾⅛⅜⅝⅞])/)
    .reduce((sum, part) => {
      if (FRACTIONS[part]) return sum + FRACTIONS[part];
      if (part.includes("/")) {
        const [a, b] = part.split("/").map(Number);
        return sum + a / b;
      }
      return sum + Number(part);
    }, 0);
}

function formatNumber(n) {
  const whole = Math.floor(n);
  const frac = n - whole;
  const nice = [[0, ""], [0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"], [1, ""]];
  const [value, glyph] = nice.reduce((best, cur) => (Math.abs(cur[0] - frac) < Math.abs(best[0] - frac) ? cur : best));
  if (Math.abs(value - frac) > 0.04) return String(Math.round(n * 10) / 10);
  const w = value === 1 ? whole + 1 : whole;
  return `${w || ""}${glyph}` || "0";
}

export function scaleIngredient(item, factor) {
  const m = item.match(QTY_RE);
  if (!m) return esc(item);
  const rest = item.slice(m[0].length);
  let qty = m[0];
  if (factor !== 1) {
    qty = formatNumber(toNumber(m[1]) * factor);
    if (m[3]) qty += `–${formatNumber(toNumber(m[3]) * factor)}`;
  }
  return `<span class="qty">${esc(qty)}</span>${esc(rest)}`;
}
