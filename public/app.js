const app = document.getElementById("app");

const state = {
  ai: null,
  categories: [],
  recipes: [],
  filter: "all",
  search: "",
  addTab: "link",
  pendingFiles: [],
  preview: loadPreview(),
};

// ---------------------------------------------------------------------------
// API

async function api(path, options = {}) {
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

async function refreshLibrary() {
  [state.recipes, state.categories] = await Promise.all([api("/api/recipes"), api("/api/categories")]);
}

// ---------------------------------------------------------------------------
// Routing

function navigate(path) {
  history.pushState(null, "", path);
  render();
}

document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-link]");
  if (!link || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  navigate(link.getAttribute("href"));
});
window.addEventListener("popstate", render);

async function render() {
  exitCookMode();
  const path = location.pathname;
  document.querySelectorAll("[data-nav]").forEach((a) => {
    a.classList.toggle("active", (a.dataset.nav === "library" && path === "/") || (a.dataset.nav === "add" && path === "/add"));
  });
  window.scrollTo(0, 0);

  try {
    let m;
    if (path === "/") return await renderLibrary();
    if (path === "/add") return renderAdd();
    if (path === "/preview") return state.preview ? renderRecipe(state.preview, { preview: true }) : navigate("/add");
    if ((m = path.match(/^\/recipe\/([\w-]+)\/edit$/))) return renderEditor(await api(`/api/recipes/${m[1]}`));
    if ((m = path.match(/^\/recipe\/([\w-]+)$/))) return renderRecipe(await api(`/api/recipes/${m[1]}`));
    navigate("/");
  } catch (err) {
    app.innerHTML = `<div class="empty"><div class="big">🥲</div><h2>${esc(err.message)}</h2><a class="btn" href="/" data-link>Back to library</a></div>`;
  }
}

// ---------------------------------------------------------------------------
// Library

async function renderLibrary() {
  await refreshLibrary();
  const { recipes, categories, filter } = state;

  const filters = [
    { key: "all", label: "All recipes", count: recipes.length },
    { key: "fav", label: "★ Favorites", count: recipes.filter((r) => r.favorite).length },
    ...categories.map((c) => ({ key: `cat:${c.name}`, label: c.name, count: c.count })),
    { key: "none", label: "Uncategorized", count: recipes.filter((r) => !r.category).length },
  ];
  if (!filters.some((f) => f.key === filter)) state.filter = "all";
  const activeCat = state.filter.startsWith("cat:") ? state.filter.slice(4) : null;
  const heading = filters.find((f) => f.key === state.filter).label;

  app.innerHTML = `
    <div class="library">
      <aside class="sidebar">
        <h2>Collections</h2>
        <ul class="cat-list">
          ${filters
            .map(
              (f) => `<li><button data-filter="${esc(f.key)}" class="${f.key === state.filter ? "active" : ""}">
                <span>${esc(f.label)}</span><span class="cat-count">${f.count}</span></button></li>`,
            )
            .join("")}
        </ul>
        <div class="cat-actions">
          <button class="btn btn-sm" id="new-cat">+ New category</button>
          ${activeCat ? `<button class="btn btn-sm btn-ghost" id="rename-cat">Rename</button><button class="btn btn-sm btn-ghost btn-danger" id="delete-cat">Delete</button>` : ""}
        </div>
      </aside>
      <section>
        <div class="library-head">
          <h1>${esc(heading)}</h1>
          <input class="input" id="search" type="search" placeholder="Search recipes, ingredients, tags…" value="${esc(state.search)}" />
        </div>
        <div id="results"></div>
      </section>
    </div>`;

  const drawResults = () => {
    const q = state.search.trim().toLowerCase();
    const shown = recipes.filter((r) => {
      if (state.filter === "fav" && !r.favorite) return false;
      if (state.filter === "none" && r.category) return false;
      if (activeCat && r.category !== activeCat) return false;
      if (!q) return true;
      const haystack = [r.title, r.description, ...(r.tags || []), ...r.ingredientGroups.flatMap((g) => g.items)].join(" ").toLowerCase();
      return haystack.includes(q);
    });

    const results = document.getElementById("results");
    if (!recipes.length) {
      results.innerHTML = `<div class="empty"><div class="big">📖</div><h2>Your cookbook is empty</h2>
        <p>Paste a link, snap a photo, or drop in an email — Al Dente tidies it up.</p>
        <a class="btn btn-primary" href="/add" data-link>Add your first recipe</a></div>`;
    } else if (!shown.length) {
      results.innerHTML = `<div class="empty"><div class="big">🔍</div><h2>Nothing here yet</h2><p>No recipes match.</p></div>`;
    } else {
      results.innerHTML = `<div class="grid">${shown.map(cardHtml).join("")}</div>`;
    }
  };
  drawResults();

  app.querySelectorAll("[data-filter]").forEach((b) =>
    b.addEventListener("click", () => {
      state.filter = b.dataset.filter;
      renderLibrary();
    }),
  );
  document.getElementById("search").addEventListener("input", (e) => {
    state.search = e.target.value;
    drawResults();
  });
  document.getElementById("new-cat").addEventListener("click", async () => {
    const name = await promptDialog("New category", "e.g. Weeknight dinners");
    if (!name) return;
    await api("/api/categories", { method: "POST", body: { name } });
    state.filter = `cat:${name}`;
    renderLibrary();
  });
  document.getElementById("rename-cat")?.addEventListener("click", async () => {
    const name = await promptDialog("Rename category", "", activeCat);
    if (!name || name === activeCat) return;
    await api(`/api/categories/${encodeURIComponent(activeCat)}`, { method: "PATCH", body: { name } });
    state.filter = `cat:${name}`;
    renderLibrary();
  });
  document.getElementById("delete-cat")?.addEventListener("click", async () => {
    const ok = await confirmDialog(`Delete “${activeCat}”?`, "Recipes in it will be kept and moved to Uncategorized.");
    if (!ok) return;
    await api(`/api/categories/${encodeURIComponent(activeCat)}`, { method: "DELETE" });
    state.filter = "all";
    renderLibrary();
  });
}

function cardHtml(r) {
  const time = r.totalTime || r.cookTime || r.prepTime;
  return `<a class="card" href="/recipe/${r.id}" data-link>
    <div class="card-img" ${r.image ? `style="background-image:url('${esc(r.image)}')"` : ""}>${r.image ? "" : emojiFor(r)}</div>
    <div class="card-body">
      <div class="card-title">${r.favorite ? "★ " : ""}${esc(r.title)}</div>
      <div class="card-meta">${[r.category, time].filter(Boolean).map(esc).join(" · ")}</div>
    </div></a>`;
}

function emojiFor(r) {
  const text = `${r.title} ${(r.tags || []).join(" ")} ${r.category || ""}`.toLowerCase();
  const table = [
    [/pasta|spaghetti|noodle|lasagna|ramen/, "🍝"], [/cake|cupcake/, "🍰"], [/cookie/, "🍪"], [/bread|loaf|focaccia|sourdough/, "🍞"],
    [/pie|tart/, "🥧"], [/soup|stew|chili/, "🍲"], [/salad/, "🥗"], [/chicken/, "🍗"], [/beef|steak|burger/, "🥩"],
    [/fish|salmon|shrimp|seafood/, "🐟"], [/taco|burrito|mexican/, "🌮"], [/pizza/, "🍕"], [/curry|rice/, "🍛"],
    [/egg|breakfast|pancake|waffle/, "🍳"], [/drink|cocktail|smoothie/, "🍹"], [/dessert|chocolate|ice cream/, "🍫"],
  ];
  return table.find(([re]) => re.test(text))?.[1] ?? "🍽️";
}

// ---------------------------------------------------------------------------
// Add

async function renderAdd() {
  if (state.ai === null) state.ai = (await api("/api/status")).ai;
  const tab = state.addTab;

  app.innerHTML = `
    <div class="add">
      <h1>Add a recipe</h1>
      <p class="lede">From a website, Instagram or TikTok post, a photo of a cookbook page, a handwritten card, or an email — we'll turn it into a clean, step-by-step recipe.</p>
      <div class="tabs" role="tablist">
        ${[["link", "🔗 Link"], ["photo", "📷 Photo / PDF"], ["text", "📝 Paste text"]]
          .map(([k, label]) => `<button class="tab ${tab === k ? "active" : ""}" data-tab="${k}" role="tab">${label}</button>`)
          .join("")}
      </div>
      <div id="panel"></div>
    </div>`;

  app.querySelectorAll("[data-tab]").forEach((b) =>
    b.addEventListener("click", () => {
      state.addTab = b.dataset.tab;
      renderAdd();
    }),
  );

  const panel = document.getElementById("panel");
  const aiNote = state.ai
    ? ""
    : `<div class="notice warn">AI isn't set up yet, so ${tab === "link" ? "only links to recipe websites will work (social posts need AI)" : "this option won't work"}. Add <code>ANTHROPIC_API_KEY</code> to the <code>.env</code> file and restart.</div>`;

  if (tab === "link") {
    panel.innerHTML = `<form class="panel" id="form">
        <div class="row">
          <input class="input" name="url" type="url" required placeholder="https://…" autofocus />
          <button class="btn btn-primary" type="submit">Format recipe</button>
        </div>
        <p class="hint">Works with recipe sites, blogs, YouTube, Instagram, TikTok, Pinterest and more. If a social site blocks us, paste the caption or upload a screenshot instead.</p>
        ${aiNote}
      </form>`;
    panel.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      runExtract({ url: new FormData(e.target).get("url") });
    });
  }

  if (tab === "text") {
    panel.innerHTML = `<form class="panel" id="form">
        <textarea class="textarea" name="text" required placeholder="Paste a recipe from an email, a social media caption, notes, or type one out from a cookbook…"></textarea>
        <div><button class="btn btn-primary" type="submit">Format recipe</button></div>
        ${aiNote}
      </form>`;
    panel.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      runExtract({ text: new FormData(e.target).get("text") });
    });
  }

  if (tab === "photo") {
    panel.innerHTML = `<div class="panel">
        <label class="dropzone" id="drop">
          <div class="big">📷</div>
          <strong>Drop photos or PDFs here, or click to choose</strong>
          <p class="hint">Cookbook pages, recipe cards, screenshots. Add several for multi-page recipes.</p>
          <input type="file" id="file" accept="image/*,application/pdf" multiple hidden />
        </label>
        <div class="thumbs" id="thumbs"></div>
        <input class="input" id="note" placeholder="Optional note, e.g. “just the lemon bars on the right page”" />
        <div><button class="btn btn-primary" id="go" disabled>Format recipe</button></div>
        ${aiNote}
      </div>`;

    const drop = document.getElementById("drop");
    const fileInput = document.getElementById("file");
    const drawThumbs = () => {
      document.getElementById("thumbs").innerHTML = state.pendingFiles
        .map((f, i) => `<div class="thumb">${f.type === "application/pdf" ? "PDF" : `<img src="data:${f.type};base64,${f.data}" alt="">`}
          <button data-remove="${i}" aria-label="Remove">×</button></div>`)
        .join("");
      document.getElementById("go").disabled = !state.pendingFiles.length;
    };
    const addFiles = async (list) => {
      for (const file of list) {
        try {
          state.pendingFiles.push(await prepareFile(file));
        } catch (err) {
          toast(err.message);
        }
      }
      drawThumbs();
    };

    fileInput.addEventListener("change", () => addFiles(fileInput.files));
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("drag");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("drag");
      addFiles(e.dataTransfer.files);
    });
    document.getElementById("thumbs").addEventListener("click", (e) => {
      const i = e.target.dataset.remove;
      if (i === undefined) return;
      state.pendingFiles.splice(Number(i), 1);
      drawThumbs();
    });
    document.getElementById("go").addEventListener("click", () =>
      runExtract({ files: state.pendingFiles, note: document.getElementById("note").value }),
    );
    drawThumbs();
  }
}

// Downscale photos in the browser: keeps uploads small and converts formats
// (like iPhone HEIC in Safari) into a JPEG the AI can read.
async function prepareFile(file) {
  const toBase64 = (blob) =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.readAsDataURL(blob);
    });

  if (file.type === "application/pdf") return { type: file.type, data: await toBase64(file) };
  if (!file.type.startsWith("image/") && !/\.hei[cf]$/i.test(file.name)) {
    throw new Error(`${file.name} isn't a photo or PDF.`);
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Couldn't open ${file.name}. Try converting it to JPG first.`);
  }
  const MAX = 2000;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.88));
  return { type: "image/jpeg", data: await toBase64(blob) };
}

const LOADING_LINES = ["Reading the recipe…", "Skipping the life story…", "Measuring ingredients…", "Numbering the steps…", "Almost al dente…"];

async function runExtract(body) {
  let i = 0;
  app.innerHTML = `<div class="loading"><div class="spinner"></div><div id="loading-line">${LOADING_LINES[0]}</div></div>`;
  const timer = setInterval(() => {
    const el = document.getElementById("loading-line");
    if (el) el.textContent = LOADING_LINES[++i % LOADING_LINES.length];
  }, 2200);

  try {
    const recipe = await api("/api/extract", { method: "POST", body });
    state.pendingFiles = [];
    state.preview = recipe;
    savePreview(recipe);
    navigate("/preview");
  } catch (err) {
    await renderAdd();
    toast(err.message, 6000);
  } finally {
    clearInterval(timer);
  }
}

// ---------------------------------------------------------------------------
// Recipe view

async function renderRecipe(recipe, { preview = false } = {}) {
  if (!state.categories.length) state.categories = await api("/api/categories");
  let factor = 1;
  const stepState = { done: new Set(), current: 0 };

  const categoryOptions = (selected) =>
    `<option value="">No category</option>` +
    state.categories.map((c) => `<option ${c.name === selected ? "selected" : ""}>${esc(c.name)}</option>`).join("") +
    `<option value="__new">+ New category…</option>`;

  const suggested = guessCategory(recipe);
  const chips = [["Serves", recipe.yield], ["Prep", recipe.prepTime], ["Cook", recipe.cookTime], ["Total", recipe.totalTime]]
    .filter(([, v]) => v)
    .map(([k, v]) => `<div class="chip"><span>${k}</span><b>${esc(v)}</b></div>`)
    .join("");
  const sourceLine = recipe.source?.url
    ? `From <a href="${esc(recipe.source.url)}" target="_blank" rel="noopener">${esc(recipe.source.name || "original")}</a>`
    : recipe.source?.type === "photo" ? "From a photo" : recipe.source?.type === "text" ? "From pasted text" : "";

  app.innerHTML = `
    <article class="recipe">
      ${preview ? `<div class="save-bar">
          <strong>✨ Here's your formatted recipe. Save it to your library?</strong>
          <select class="select" id="save-cat">${categoryOptions(suggested)}</select>
          <button class="btn btn-primary" id="save">Save recipe</button>
          <button class="btn btn-ghost" id="discard">Discard</button>
        </div>` : ""}
      <header class="recipe-hero ${recipe.image ? "has-img" : ""}">
        <div>
          ${recipe.category ? `<div class="eyebrow">${esc(recipe.category)}</div>` : ""}
          <h1>${esc(recipe.title)}</h1>
          ${recipe.description ? `<p class="desc">${esc(recipe.description)}</p>` : ""}
          ${chips ? `<div class="chips">${chips}</div>` : ""}
          <div class="source">${[sourceLine, recipe.author && `by ${esc(recipe.author)}`].filter(Boolean).join(" · ")}</div>
          <div class="actions">
            ${preview ? "" : `
              <button class="btn btn-sm" id="fav">${recipe.favorite ? "★ Favorited" : "☆ Favorite"}</button>
              <select class="select btn-sm" id="move-cat" style="width:auto;padding:6px 12px;border-radius:999px">${categoryOptions(recipe.category)}</select>`}
            <button class="btn btn-sm" id="cook">👩‍🍳 Cook mode</button>
            ${preview ? "" : `<a class="btn btn-sm" href="/recipe/${recipe.id}/edit" data-link>Edit</a>`}
            <button class="btn btn-sm btn-ghost" onclick="print()">Print</button>
            ${preview ? "" : `<button class="btn btn-sm btn-ghost btn-danger" id="delete">Delete</button>`}
          </div>
        </div>
        ${recipe.image ? `<img src="${esc(recipe.image)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
      </header>

      <div class="recipe-body">
        <section class="ingredients">
          <div class="section-head">
            <h2>Ingredients</h2>
            <div class="scale" id="scale">${[0.5, 1, 2, 3].map((f) => `<button data-f="${f}" class="${f === 1 ? "active" : ""}">${f === 0.5 ? "½" : f}×</button>`).join("")}</div>
          </div>
          <div id="ing"></div>
        </section>
        <section class="steps">
          <h2>Method</h2>
          <p class="hint" style="margin:-4px 0 12px">Tap a step to mark it done.</p>
          ${recipe.stepGroups
            .map((g) => `${g.name ? `<h3 class="group-name">${esc(g.name)}</h3>` : ""}
              <ol class="step-list">${g.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`)
            .join("")}
          ${recipe.notes?.length ? `<div class="notes"><h2>Notes</h2><ul>${recipe.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : ""}
          ${recipe.tags?.length ? `<div class="tags">${recipe.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
        </section>
      </div>
    </article>`;

  const checked = new Set();
  const drawIngredients = () => {
    let n = 0;
    document.getElementById("ing").innerHTML = recipe.ingredientGroups
      .map((g) => `${g.name ? `<h3 class="group-name">${esc(g.name)}</h3>` : ""}<ul class="ing-list">
        ${g.items.map((item) => {
          const id = n++;
          return `<li><label><input type="checkbox" data-i="${id}" ${checked.has(id) ? "checked" : ""}><span>${scaleIngredient(item, factor)}</span></label></li>`;
        }).join("")}</ul>`)
      .join("");
  };
  drawIngredients();
  document.getElementById("ing").addEventListener("change", (e) => {
    const i = Number(e.target.dataset.i);
    e.target.checked ? checked.add(i) : checked.delete(i);
  });
  document.getElementById("scale").addEventListener("click", (e) => {
    const f = e.target.dataset.f;
    if (!f) return;
    factor = Number(f);
    document.querySelectorAll("#scale button").forEach((b) => b.classList.toggle("active", b === e.target));
    drawIngredients();
  });

  const stepEls = [...app.querySelectorAll(".step-list li")];
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

  document.getElementById("cook").addEventListener("click", toggleCookMode);
  app.querySelector(".desc")?.addEventListener("click", (e) => e.currentTarget.classList.toggle("open"));

  const pickCategory = async (select) => {
    if (select.value !== "__new") return select.value || null;
    const name = await promptDialog("New category", "e.g. Holiday baking");
    if (!name) {
      select.value = "";
      return null;
    }
    state.categories = await api("/api/categories", { method: "POST", body: { name } });
    select.innerHTML = categoryOptions(name);
    return name;
  };

  if (preview) {
    const select = document.getElementById("save-cat");
    select.addEventListener("change", () => pickCategory(select));
    document.getElementById("save").addEventListener("click", async () => {
      const { suggestedCategory, ...rest } = recipe;
      const saved = await api("/api/recipes", { method: "POST", body: { ...rest, category: select.value || null } });
      state.preview = null;
      savePreview(null);
      toast("Saved to your library");
      navigate(`/recipe/${saved.id}`);
    });
    document.getElementById("discard").addEventListener("click", () => {
      state.preview = null;
      savePreview(null);
      navigate("/add");
    });
    return;
  }

  document.getElementById("fav").addEventListener("click", async (e) => {
    recipe = await api(`/api/recipes/${recipe.id}`, { method: "PATCH", body: { favorite: !recipe.favorite } });
    e.target.textContent = recipe.favorite ? "★ Favorited" : "☆ Favorite";
  });
  const move = document.getElementById("move-cat");
  move.addEventListener("change", async () => {
    const category = await pickCategory(move);
    recipe = await api(`/api/recipes/${recipe.id}`, { method: "PATCH", body: { category } });
    toast(category ? `Moved to ${category}` : "Removed from category");
  });
  document.getElementById("delete").addEventListener("click", async () => {
    if (!(await confirmDialog("Delete this recipe?", "This can't be undone."))) return;
    await api(`/api/recipes/${recipe.id}`, { method: "DELETE" });
    toast("Recipe deleted");
    navigate("/");
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

// ---------------------------------------------------------------------------
// Editor

function renderEditor(recipe) {
  const groupsToText = (groups, key) =>
    groups.map((g) => (g.name ? `# ${g.name}\n` : "") + g[key].join("\n")).join("\n\n");
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

  app.innerHTML = `
    <form class="editor" id="editor">
      <h1>Edit recipe</h1>
      <label>Title<input class="input" name="title" value="${esc(recipe.title)}" required></label>
      <label>Description<textarea class="textarea" name="description" style="min-height:70px">${esc(recipe.description)}</textarea></label>
      <div class="grid-3">
        ${["yield", "prepTime", "cookTime", "totalTime"]
          .map((k) => `<label>${{ yield: "Serves", prepTime: "Prep", cookTime: "Cook", totalTime: "Total" }[k]}<input class="input" name="${k}" value="${esc(recipe[k])}"></label>`)
          .join("")}
      </div>
      <p class="hint">One item per line. Start a line with <b>#</b> to make a section header (e.g. “# For the sauce”).</p>
      <label>Ingredients<textarea class="textarea" name="ingredients">${esc(groupsToText(recipe.ingredientGroups, "items"))}</textarea></label>
      <label>Steps<textarea class="textarea" name="steps" style="min-height:300px">${esc(groupsToText(recipe.stepGroups, "steps"))}</textarea></label>
      <label>Notes<textarea class="textarea" name="notes" style="min-height:90px">${esc((recipe.notes || []).join("\n"))}</textarea></label>
      <label>Tags (comma separated)<input class="input" name="tags" value="${esc((recipe.tags || []).join(", "))}"></label>
      <label>Image URL<input class="input" name="image" value="${esc(recipe.image || "")}"></label>
      <div class="row" style="justify-content:flex-start">
        <button class="btn btn-primary" type="submit">Save changes</button>
        <a class="btn btn-ghost" href="/recipe/${recipe.id}" data-link>Cancel</a>
      </div>
    </form>`;

  document.getElementById("editor").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    await api(`/api/recipes/${recipe.id}`, {
      method: "PATCH",
      body: {
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
      },
    });
    toast("Changes saved");
    navigate(`/recipe/${recipe.id}`);
  });
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

function scaleIngredient(item, factor) {
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

// ---------------------------------------------------------------------------
// Cook mode keeps the screen awake and enlarges text.

let wakeLock = null;
async function toggleCookMode() {
  const on = document.body.classList.toggle("cook-mode");
  const btn = document.getElementById("cook");
  if (btn) btn.textContent = on ? "Exit cook mode" : "👩‍🍳 Cook mode";
  if (on) {
    try {
      wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
      // Not supported or denied — cook mode still works, the screen may just dim.
    }
    toast("Cook mode on — screen stays awake");
  } else {
    wakeLock?.release();
    wakeLock = null;
  }
}
function exitCookMode() {
  if (document.body.classList.contains("cook-mode")) toggleCookMode();
}

// ---------------------------------------------------------------------------
// Small UI helpers

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

let toastTimer;
function toast(message, ms = 2600) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

function promptDialog(title, placeholder = "", value = "") {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>
      <input class="input" name="v" placeholder="${esc(placeholder)}" value="${esc(value)}" required autofocus>
      <div class="row"><button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" value="ok">Save</button></div></form>`;
    document.body.append(dlg);
    dlg.addEventListener("close", () => {
      const v = dlg.querySelector("input").value.trim();
      resolve(dlg.returnValue === "ok" && v ? v : null);
      dlg.remove();
    });
    dlg.showModal();
  });
}

function confirmDialog(title, body) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><p>${esc(body)}</p>
      <div class="row"><button class="btn btn-ghost" value="cancel">Cancel</button><button class="btn btn-primary" value="ok">Delete</button></div></form>`;
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
function savePreview(recipe) {
  try {
    if (recipe) sessionStorage.setItem("al-dente-preview", JSON.stringify(recipe));
    else sessionStorage.removeItem("al-dente-preview");
  } catch {
    // Storage full or disabled; the preview just won't survive a refresh.
  }
}

render();
