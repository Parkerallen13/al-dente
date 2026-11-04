// Cook mode: three steps a page with the amounts they need, timers found in the
// steps, the ingredient list one tap away, the assistant, and the screen kept awake.
import { app, state, api, navigate, onLeave, loadStatus, esc, toast, openSheet, SpeechRecognition } from "./core.js";
import { scaleIngredient, amountsFor, stepHtml } from "./recipe.js";

const STEPS_PER_PAGE = 3;
const DURATION_RE = /\b(\d+(?:\.\d+)?|an?|one)\s*(?:(?:-|–|to)\s*\d+(?:\.\d+)?\s*)?(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b(?:\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?)\b)?/i;

// Seconds for the first time mentioned in a step ("1 hour 15 minutes", "8–10 min"), or 0.
function findDuration(text) {
  const m = text.match(DURATION_RE);
  if (!m) return 0;
  const n = /\d/.test(m[1]) ? Number(m[1]) : 1;
  const unit = m[2][0].toLowerCase();
  return Math.round(unit === "h" ? n * 3600 + Number(m[3] || 0) * 60 : unit === "m" ? n * 60 : n);
}

function formatDuration(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return [h && `${h} hr`, m && `${m} min`, s && `${s} sec`].filter(Boolean).join(" ");
}

function clock(secs) {
  const h = Math.floor(secs / 3600);
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const s = String(secs % 60).padStart(2, "0");
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
}

// Bold times and temperatures so they're easy to spot from across the kitchen.
export function highlight(text) {
  return esc(text).replace(
    /\d+(?:\.\d+)?\s*°\s*[FC]?|\b\d+(?:\.\d+)?(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi,
    "<b>$&</b>",
  );
}

export async function renderCook(recipe) {
  await loadStatus();
  const steps = recipe.stepGroups.flatMap((g) => g.steps);
  const pages = Math.max(1, Math.ceil(steps.length / STEPS_PER_PAGE));
  const factor = state.factors[recipe.id] ?? 1;
  const items = amountsFor(recipe);
  const measured = new Set();
  const stepTexts = steps.map((text) => stepHtml(text, items, factor, highlight, measured));
  const gathered = new Set();
  const timers = [];
  let page = 0;
  let audio = null;
  let wakeLock = null;
  let open = true;

  app.innerHTML = `
    <section class="screen cook">
      <header class="topbar">
        <a class="link" href="/recipe/${recipe.id}" data-link>✕ Exit</a>
        <div class="topbar-title">${esc(recipe.title)}</div>
        <span class="small muted" id="page-label"></span>
      </header>
      <div class="timerbar" id="timerbar">
        ${recipe.ingredientGroups.length ? `<button class="chip chip-sm" type="button" id="show-ings">Ingredients</button>` : ""}
        <button class="chip chip-sm" type="button" id="add-timer">+ 5 min timer</button>
      </div>
      <div class="cook-steps" id="cook-steps"></div>
      <footer class="cook-foot">
        <div class="row">
          <button class="btn" type="button" id="prev">‹ Previous</button>
          <button class="btn btn-primary grow" type="button" id="next"></button>
        </div>
        ${assistantHtml()}
      </footer>
    </section>`;

  const drawPage = () => {
    const start = page * STEPS_PER_PAGE;
    const shown = steps.slice(start, start + STEPS_PER_PAGE);
    const last = start + shown.length;
    document.getElementById("page-label").textContent =
      !steps.length ? "" : shown.length === 1 ? `Step ${last} of ${steps.length}` : `Steps ${start + 1}–${last} of ${steps.length}`;
    document.getElementById("cook-steps").innerHTML =
      shown
        .map((text, i) => {
          const n = start + i + 1;
          const secs = findDuration(text);
          const running = timers.some((t) => t.step === n);
          return `<article class="cook-step">
            <div class="row"><span class="step-num">${n}</span><span class="small muted strong">Step ${n}</span></div>
            <p>${stepTexts[n - 1]}</p>
            ${secs ? `<button class="chip self-start" type="button" data-timer="${n}" data-secs="${secs}" ${running ? "disabled" : ""}>${running ? "Timer running" : `Start ${formatDuration(secs)} timer`}</button>` : ""}
          </article>`;
        })
        .join("") || `<p class="muted">This recipe has no steps yet.</p>`;
    document.getElementById("prev").disabled = page === 0;
    document.getElementById("next").textContent = page === pages - 1 ? "Finish" : "Next steps ›";
  };

  const turn = (dir) => {
    if (page + dir >= pages) return navigate(`/recipe/${recipe.id}/done`);
    if (page + dir < 0) return;
    page += dir;
    drawPage();
    window.scrollTo(0, 0);
  };

  // Timers count from an end time, so a throttled background tab still finishes on time.
  const tick = () => {
    for (const t of timers) {
      const left = Math.max(0, Math.round((t.end - Date.now()) / 1000));
      t.el.innerHTML = `${esc(t.label)} <b>${left ? clock(left) : "Done"}</b>`;
      if (!left && !t.done) {
        t.done = true;
        t.el.classList.add("is-done");
        t.el.setAttribute("aria-label", `${t.label} timer done. Tap to dismiss.`);
        toast(`${t.label} timer is done`, 6000);
        alarm(audio);
      }
    }
  };
  const addTimer = (label, secs, step = null) => {
    audio ??= new AudioContext();
    const el = document.createElement("button");
    el.type = "button";
    el.className = "timer";
    const timer = { label, step, el, end: Date.now() + secs * 1000, done: false };
    timers.push(timer);
    el.addEventListener("click", () => {
      if (!timer.done) return;
      timers.splice(timers.indexOf(timer), 1);
      el.remove();
      if (step) drawPage();
    });
    document.getElementById("timerbar").insertBefore(el, document.getElementById("add-timer"));
    tick();
  };
  const interval = setInterval(tick, 1000);

  document.getElementById("add-timer").addEventListener("click", () => addTimer("Timer", 300));
  // The full list, at the servings picked on the recipe page. Ticks last for this cook.
  document.getElementById("show-ings")?.addEventListener("click", () => {
    let i = 0;
    const sheet = openSheet("Ingredients", `
      ${factor === 1 ? "" : `<p class="small muted">Scaled to ${factor}× on the recipe page.</p>`}
      ${recipe.ingredientGroups.map((g) => `${g.name ? `<h3 class="group-name">${esc(g.name)}</h3>` : ""}<ul class="ingredients">
        ${g.items.map((item) => {
          const id = i++;
          return `<li><label><input type="checkbox" data-i="${id}" ${gathered.has(id) ? "checked" : ""}><span>${scaleIngredient(item, factor)}</span></label></li>`;
        }).join("")}</ul>`).join("")}
      <button class="btn btn-primary" type="button" data-close>Back to the steps</button>`);
    sheet.addEventListener("change", (e) => {
      const id = Number(e.target.dataset.i);
      e.target.checked ? gathered.add(id) : gathered.delete(id);
    });
    sheet.querySelector("[data-close]").addEventListener("click", () => sheet.remove());
  });
  document.getElementById("cook-steps").addEventListener("click", (e) => {
    const button = e.target.closest("[data-timer]");
    if (!button) return;
    addTimer(`Step ${button.dataset.timer}`, Number(button.dataset.secs), Number(button.dataset.timer));
    button.disabled = true;
    button.textContent = "Timer running";
  });
  document.getElementById("prev").addEventListener("click", () => turn(-1));
  document.getElementById("next").addEventListener("click", () => turn(1));
  const stopAssistant = wireAssistant(recipe);

  const onKey = (e) => {
    if (e.target.closest?.("input, textarea, select")) return;
    if (e.key === "ArrowRight") turn(1);
    if (e.key === "ArrowLeft") turn(-1);
  };
  const lock = async () => {
    try {
      wakeLock = await navigator.wakeLock?.request("screen");
      if (!open) wakeLock?.release();
    } catch {
      // Not supported or denied. Cook mode still works; the screen may just dim.
    }
  };
  // Browsers drop the wake lock when the tab is hidden, so take it again on return.
  const onVisible = () => {
    if (document.visibilityState === "visible") lock();
  };
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisible);
  lock();
  drawPage();

  onLeave(() => {
    open = false;
    clearInterval(interval);
    wakeLock?.release();
    audio?.close();
    stopAssistant();
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVisible);
  });
}

// Three short beeps, plus a buzz on phones. Uses the AudioContext created when the
// timer was started, since browsers only allow sound that a tap set up.
function alarm(audio) {
  navigator.vibrate?.([300, 150, 300]);
  if (!audio) return;
  for (const at of [0, 0.35, 0.7]) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audio.destination);
    osc.start(audio.currentTime + at);
    osc.stop(audio.currentTime + at + 0.2);
  }
}

// ---------------------------------------------------------------------------
// Assistant: questions about this recipe, typed or held-to-speak.

function assistantHtml() {
  const off = state.ai ? "" : "disabled";
  return `<details class="assistant">
    <summary class="btn">Ask the assistant <span class="small muted">Type or speak</span></summary>
    <div class="assistant-panel">
      <div class="bubbles" id="bubbles" aria-live="polite">
        ${state.ai
          ? `<div class="bubble">Ask anything about this recipe: a swap, a timing question, or what a step means.</div>`
          : `<div class="banner">The assistant needs AI. Add <code>ANTHROPIC_API_KEY</code> to the <code>.env</code> file and restart the server.</div>`}
      </div>
      <form class="row" id="ask-form">
        <input class="input grow" name="q" placeholder="Ask about this recipe" aria-label="Ask the assistant" autocomplete="off" ${off}>
        <button class="btn btn-sm" type="submit" ${off}>Send</button>
      </form>
      ${SpeechRecognition ? `<button class="btn" type="button" id="hold-to-speak" ${off}>Hold to speak</button>` : ""}
    </div>
  </details>`;
}

// Returns a function that stops any listening in progress.
function wireAssistant(recipe) {
  const form = document.getElementById("ask-form");
  const bubbles = document.getElementById("bubbles");
  const history = [];
  let recognition = null;

  const bubble = (text, mine = false) => {
    const el = document.createElement("div");
    el.className = `bubble${mine ? " bubble-me" : ""}`;
    el.textContent = text;
    bubbles.append(el);
    el.scrollIntoView({ block: "nearest" });
    return el;
  };
  const ask = async (question) => {
    question = question.trim();
    if (!question) return;
    form.elements.q.value = "";
    bubble(question, true);
    const reply = bubble("Thinking…");
    reply.classList.add("is-pending");
    try {
      const { answer } = await api("/api/assistant", { method: "POST", body: { recipeId: recipe.id, question, history } });
      reply.textContent = answer;
      history.push({ role: "user", text: question }, { role: "assistant", text: answer });
    } catch (err) {
      reply.textContent = err.message;
    }
    reply.classList.remove("is-pending");
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    ask(form.elements.q.value);
  });

  const talk = document.getElementById("hold-to-speak");
  if (talk) {
    const startTalking = (e) => {
      e.preventDefault();
      if (recognition) return;
      recognition = new SpeechRecognition();
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognition.onresult = (event) => {
        form.elements.q.value = [...event.results].map((r) => r[0].transcript).join(" ");
      };
      recognition.onerror = (event) => {
        if (event.error === "not-allowed") toast("Al Dente needs the microphone. Allow it in your browser's site settings.", 6000);
      };
      recognition.onend = () => {
        recognition = null;
        if (!talk.isConnected) return;
        talk.textContent = "Hold to speak";
        talk.classList.remove("is-on");
        ask(form.elements.q.value);
      };
      recognition.start();
      talk.textContent = "Listening… let go to send";
      talk.classList.add("is-on");
    };
    const stopTalking = () => recognition?.stop();
    talk.addEventListener("pointerdown", startTalking);
    talk.addEventListener("pointerup", stopTalking);
    talk.addEventListener("pointerleave", stopTalking);
    talk.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  return () => recognition?.abort();
}
