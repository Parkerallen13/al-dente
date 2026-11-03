// Library, the Add sheet, and importing from a link, photo, pasted text, or voice memo.
import {
  app, state, api, refreshLibrary, loadStatus, navigate, onLeave, esc, toast, openSheet, promptDialog, confirmDialog,
  thumbHtml, dietaryFlags, downscaleImage, savePreview, SpeechRecognition,
} from "./core.js";

export async function renderLibrary({ sheet = false } = {}) {
  await refreshLibrary();
  const { recipes, categories } = state;

  const filters = [
    { key: "all", label: "All" },
    { key: "fav", label: "★ Favorites" },
    ...categories.map((c) => ({ key: `cat:${c.name}`, label: c.name })),
    { key: "none", label: "Uncategorized" },
  ];
  if (!filters.some((f) => f.key === state.filter)) state.filter = "all";
  const activeCat = state.filter.startsWith("cat:") ? state.filter.slice(4) : null;

  app.innerHTML = `
    <section class="screen">
      <header class="topbar">
        <h1 class="page-title grow">Library</h1>
        <a class="btn btn-sm btn-primary wide-only" href="/add" data-link>+ Add recipe</a>
      </header>
      ${recipes.length ? `
        <div class="search-wrap"><input class="input search" id="search" type="search" placeholder="Search recipes, ingredients, tags" aria-label="Search recipes" value="${esc(state.search)}"></div>
        <div class="chips" role="group" aria-label="Collections">
          ${filters.map((f) => `<button class="chip ${f.key === state.filter ? "is-active" : ""}" type="button" data-filter="${esc(f.key)}" aria-pressed="${f.key === state.filter}">${esc(f.label)}</button>`).join("")}
          <button class="chip chip-dashed" type="button" id="new-cat">+ New</button>
        </div>
        ${activeCat ? `<div class="row cat-tools"><button class="u small" type="button" id="rename-cat">Rename “${esc(activeCat)}”</button><button class="u small danger" type="button" id="delete-cat">Delete</button></div>` : ""}
        <div class="pad pad-fab" id="results"></div>
        <a class="fab narrow-only" href="/add" data-link aria-label="Add recipe">+</a>` : `
        <div class="center-stack">
          <div class="big-emoji" aria-hidden="true">📖</div>
          <h2 class="h2">Add your first recipe</h2>
          <p class="muted">Paste a link, snap a photo of a recipe card, record a voice memo, or type it in. Al Dente tidies it up.</p>
          <a class="btn btn-primary" href="/add" data-link>+ Add recipe</a>
          <p class="small muted">You can also share a post to Al Dente from Instagram or another app. <button class="u" type="button" data-share-help>See how</button></p>
        </div>`}
      ${sheet ? addSheet() : ""}
    </section>`;

  app.querySelector("[data-share-help]")?.addEventListener("click", shareHelp);
  if (!recipes.length) return;

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
    document.getElementById("results").innerHTML = shown.length
      ? `<div class="cards">${shown.map(cardHtml).join("")}</div>`
      : `<div class="center-stack"><div class="big-emoji" aria-hidden="true">🔍</div><p class="muted">No recipes match.</p></div>`;
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
    const name = await promptDialog("New collection", "e.g. Weeknight dinners");
    if (!name) return;
    await api("/api/categories", { method: "POST", body: { name } });
    state.filter = `cat:${name}`;
    renderLibrary();
  });
  document.getElementById("rename-cat")?.addEventListener("click", async () => {
    const name = await promptDialog("Rename collection", "", activeCat);
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
  const flags = dietaryFlags(r);
  return `<a class="card" href="/recipe/${r.id}" data-link>
    ${thumbHtml(r, "card")}
    <span class="card-title">${r.favorite ? "★ " : ""}${esc(r.title)}</span>
    <span class="card-meta">${[r.category, time].filter(Boolean).map(esc).join(" · ")}</span>
    ${flags.length ? `<span class="card-flag">${esc(flags.map((f) => f.flag).join(" · "))}</span>` : ""}</a>`;
}

function addSheet() {
  const rows = [
    ["/add/link", "🔗", "Paste a link", "Websites, Instagram, TikTok, YouTube"],
    ["/add/photo", "📷", "Take or upload a photo", "Cookbook pages, handwritten cards, screenshots, PDFs"],
    ["/add/voice", "🎙️", "Record a voice memo", "Talk through a recipe out loud"],
    ["/add/text", "📝", "Paste text", "Emails, notes, captions"],
    ["/add/manual", "✏️", "Type it manually", "Start from a blank recipe"],
  ];
  return `<div class="overlay">
    <a class="scrim" href="/" data-link aria-label="Close"></a>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-handle"></div>
      <h2 class="h2" id="sheet-title">Add a recipe</h2>
      <div class="list">
        ${rows.map(([href, icon, title, sub]) => `<a class="list-row" href="${href}" data-link><span class="shape" aria-hidden="true">${icon}</span>
          <span class="row-text grow"><span class="row-title">${title}</span><span class="row-sub">${sub}</span></span><span class="chev" aria-hidden="true">›</span></a>`).join("")}
      </div>
      <a class="btn btn-text" href="/" data-link>Cancel</a>
    </div></div>`;
}

export function shareHelp() {
  openSheet("Save from other apps", `
    <div class="stack">
      <div class="row"><span class="shape" aria-hidden="true">🤖</span><p class="grow"><b>Android:</b> install Al Dente from Chrome's menu (Install app). Then tap Share on any post or page and pick Al Dente. Installing needs the app on HTTPS or on this computer's own browser.</p></div>
      <div class="row"><span class="shape" aria-hidden="true">📋</span><p class="grow"><b>iPhone, iPad, or a computer:</b> copy the post's link, then choose <b>Paste a link</b> and tap <b>Paste from clipboard</b>.</p></div>
      <a class="btn btn-primary" href="/add/link" data-link>Paste a link</a>
    </div>`);
}

// The install manifest's share target lands here with whatever the other app sent.
export function renderShare() {
  const params = new URLSearchParams(location.search);
  const sent = [params.get("url"), params.get("text"), params.get("title")].filter(Boolean).join(" ");
  const url = sent.match(/https?:\/\/\S+/)?.[0];
  if (url) return navigate(`/add/link?url=${encodeURIComponent(url)}`, { replace: true });
  if (sent.trim()) return navigate(`/add/text?text=${encodeURIComponent(sent)}`, { replace: true });
  navigate("/add", { replace: true });
}

// ---------------------------------------------------------------------------
// Import screens, then the Saving screen

const IMPORT_TITLES = { link: "Paste a link", photo: "Photo or PDF", text: "Paste text", voice: "Record a voice memo" };

export async function renderImport(kind, values = Object.fromEntries(new URLSearchParams(location.search))) {
  await loadStatus();
  const fields = {
    link: `<label class="field"><span class="label">Recipe link</span>
        <input class="input" name="url" type="url" required placeholder="https://" value="${esc(values.url)}" autofocus></label>
      <button class="btn btn-sm self-start" type="button" id="paste">Paste from clipboard</button>
      <p class="hint">Works with recipe sites, blogs, YouTube, Instagram, TikTok, Pinterest and more. If a social site blocks us, paste the caption or upload a screenshot instead.</p>`,
    text: `<label class="field"><span class="label">Recipe text</span>
        <textarea class="input" name="text" rows="12" required placeholder="Paste a recipe from an email, a social media caption, or your notes">${esc(values.text)}</textarea></label>`,
    photo: `<label class="dropzone" id="drop">
        <span class="big-emoji" aria-hidden="true">📷</span>
        <strong>Drop photos or PDFs here, or choose files</strong>
        <span class="hint">Cookbook pages, recipe cards, screenshots. Add several for recipes that span pages.</span>
        <input type="file" id="file" accept="image/*,application/pdf" multiple hidden>
      </label>
      <div class="uploads" id="uploads"></div>
      <label class="field"><span class="label">Note (optional)</span>
        <input class="input" name="note" placeholder="e.g. just the lemon bars on the right page" value="${esc(values.note)}"></label>`,
    voice: `<div class="recorder">
        <button class="record" type="button" id="record" aria-pressed="false" aria-label="Start recording" ${SpeechRecognition ? "" : "disabled"}><span></span></button>
        <span class="h2" id="rec-clock">0:00</span>
        <span class="hint center" id="rec-hint">${SpeechRecognition ? "Tap to start, then talk through the recipe: what goes in, how much, and each step." : "This browser can't turn speech into text. Use Chrome, Edge or Safari, or type the recipe below."}</span>
      </div>
      <label class="field"><span class="label">Transcript</span>
        <textarea class="input" name="voice" rows="9" required placeholder="Your words show up here as you talk. Fix anything before formatting.">${esc(values.voice)}</textarea></label>`,
  };
  const needsAi = kind === "link" ? "only links to recipe websites will work. Social posts need AI." : "this option won't work.";

  app.innerHTML = `
    <section class="screen">
      <header class="topbar"><a class="link" href="/add" data-link>‹ Back</a><div class="topbar-title">${IMPORT_TITLES[kind]}</div></header>
      <form class="pad narrow grow" id="form">
        ${fields[kind]}
        ${state.ai ? "" : `<div class="banner">AI isn't set up yet, so ${needsAi} Add <code>ANTHROPIC_API_KEY</code> to the <code>.env</code> file and restart the server.</div>`}
        <span class="spacer"></span>
        <button class="btn btn-primary" type="submit" id="go">Format recipe</button>
      </form>
    </section>`;

  const form = document.getElementById("form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    if (kind === "link") runExtract(kind, { url: f.url });
    if (kind === "text") runExtract(kind, { text: f.text });
    if (kind === "voice") runExtract(kind, { voice: f.voice });
    if (kind === "photo") runExtract(kind, { files: state.pendingFiles, note: f.note });
  });

  document.getElementById("paste")?.addEventListener("click", async () => {
    try {
      form.elements.url.value = (await navigator.clipboard.readText()).trim();
    } catch {
      toast("Couldn't read the clipboard. Paste the link into the box instead.");
    }
  });

  if (kind === "photo") wirePhotos();
  if (kind === "voice" && SpeechRecognition) wireRecorder(form.elements.voice);
}

function wirePhotos() {
  const drop = document.getElementById("drop");
  const fileInput = document.getElementById("file");
  const drawUploads = () => {
    document.getElementById("uploads").innerHTML = state.pendingFiles
      .map((f, i) => `<div class="upload">${f.type === "application/pdf" ? "PDF" : `<img src="data:${f.type};base64,${f.data}" alt="">`}
        <button type="button" data-remove="${i}" aria-label="Remove">×</button></div>`)
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
    drawUploads();
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
  document.getElementById("uploads").addEventListener("click", (e) => {
    const i = e.target.dataset.remove;
    if (i === undefined) return;
    state.pendingFiles.splice(Number(i), 1);
    drawUploads();
  });
  drawUploads();
}

// Photos are downscaled in the browser so uploads stay small; PDFs go as they are.
async function prepareFile(file) {
  if (file.type === "application/pdf") {
    const data = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.readAsDataURL(file);
    });
    return { type: file.type, data };
  }
  if (!file.type.startsWith("image/") && !/\.hei[cf]$/i.test(file.name)) {
    throw new Error(`${file.name} isn't a photo or PDF.`);
  }
  return { type: "image/jpeg", data: (await downscaleImage(file, 2000)).split(",")[1] };
}

// Live speech-to-text in the browser. The transcript stays editable the whole time.
function wireRecorder(textarea) {
  const button = document.getElementById("record");
  const clock = document.getElementById("rec-clock");
  const hint = document.getElementById("rec-hint");
  let recognition = null;
  let recording = false;
  let finalText = textarea.value.trim();
  let startedAt = 0;
  let ticker;

  const setRecording = (on) => {
    recording = on;
    button.classList.toggle("is-recording", on);
    button.setAttribute("aria-pressed", on);
    button.setAttribute("aria-label", on ? "Stop recording" : "Start recording");
    hint.textContent = on ? "Listening… tap again to stop." : "Tap to record more. You can edit the transcript.";
    clearInterval(ticker);
    if (on) {
      startedAt = Date.now();
      ticker = setInterval(() => {
        const secs = Math.floor((Date.now() - startedAt) / 1000);
        clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      }, 500);
    }
  };
  const stop = () => {
    setRecording(false);
    recognition?.stop();
  };
  const start = () => {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const said = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) finalText = `${finalText} ${said}`.trim();
        else interim += ` ${said}`;
      }
      textarea.value = `${finalText}${interim}`.trim();
    };
    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Al Dente needs the microphone. Allow it in your browser's site settings.", 6000);
      else if (e.error !== "no-speech" && e.error !== "aborted") toast(`Recording stopped (${e.error}).`);
      if (e.error !== "no-speech") stop();
    };
    // Browsers end recognition after a pause; keep listening until you tap stop.
    recognition.onend = () => {
      if (recording) recognition.start();
    };
    recognition.start();
    setRecording(true);
  };

  button.addEventListener("click", () => (recording ? stop() : start()));
  textarea.addEventListener("input", () => {
    finalText = textarea.value.trim();
  });
  onLeave(() => {
    recording = false;
    clearInterval(ticker);
    recognition?.abort();
  });
}

const LOADING_LINES = ["Reading the recipe…", "Skipping the life story…", "Measuring ingredients…", "Numbering the steps…", "Almost al dente…"];

async function runExtract(kind, body) {
  const controller = new AbortController();
  const at = location.pathname;
  onLeave(() => controller.abort());
  let i = 0;
  app.innerHTML = `
    <section class="screen"><div class="center-stack">
      <div class="spinner" role="img" aria-label="Loading"></div>
      <div class="stack-sm"><h1 class="h2" id="loading-line">${LOADING_LINES[0]}</h1><p class="muted">Finding the ingredients and steps.</p></div>
      <div class="skel-card" aria-hidden="true"><div class="skel skel-img"></div><div class="skel w-80"></div><div class="skel w-60"></div><div class="skel"></div></div>
      <button class="btn btn-text" type="button" id="cancel">Cancel</button>
    </div></section>`;
  document.getElementById("cancel").addEventListener("click", () => controller.abort());
  const timer = setInterval(() => {
    const el = document.getElementById("loading-line");
    if (el) el.textContent = LOADING_LINES[++i % LOADING_LINES.length];
  }, 2200);

  try {
    const recipe = await api("/api/extract", { method: "POST", body, signal: controller.signal });
    state.pendingFiles = [];
    savePreview(recipe);
    onLeave(null);
    navigate("/preview");
  } catch (err) {
    // Leaving the screen cancels the import; nothing to show.
    if (location.pathname !== at) return;
    onLeave(null);
    await renderImport(kind, body);
    if (err.name !== "AbortError") toast(err.message, 6000);
  } finally {
    clearInterval(timer);
  }
}
