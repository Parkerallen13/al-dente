// Community: the feed, a post with comments, writing a post, and finding communities.
import {
  app, state, api, refreshLibrary, loadCommunities, communityNames, saveProfile, navigate, esc, toast, plural, ago,
  openSheet, confirmDialog, thumbHtml, avatar, stars, dietaryFlags,
} from "./core.js";

const joined = () => state.profile.joined;

export async function renderFeed() {
  const [{ communities, posts }] = await Promise.all([api("/api/community"), refreshLibrary()]);
  state.communities = communities;
  const names = communityNames();
  const chosen = new URLSearchParams(location.search).get("c");
  if (chosen) state.community = chosen;
  if (state.community !== "all" && !joined().includes(state.community)) state.community = "all";
  const mine = communities.filter((c) => joined().includes(c.id));

  app.innerHTML = `
    <section class="screen">
      <header class="topbar">
        <h1 class="page-title grow">Community</h1>
        <a class="btn btn-sm btn-primary wide-only" href="/community/new" data-link>+ New post</a>
      </header>
      <div class="chips chips-top narrow" role="group" aria-label="Communities">
        ${[{ id: "all", name: "All" }, ...mine].map((c) => `<button class="chip ${c.id === state.community ? "is-active" : ""}" type="button" data-community="${esc(c.id)}" aria-pressed="${c.id === state.community}">${esc(c.name)}</button>`).join("")}
        <a class="chip chip-dashed" href="/community/find" data-link>+ Find communities</a>
      </div>
      <div class="pad pad-fab narrow">
        <p class="small muted">Posts are kept on this computer for now. The ones marked Sample are examples.</p>
        <div class="posts" id="posts"></div>
      </div>
      <a class="fab narrow-only" href="/community/new" data-link aria-label="New post">+</a>
    </section>`;

  const draw = () => {
    const shown = posts.filter((p) => (state.community === "all" ? joined().includes(p.community) || p.author.you : p.community === state.community));
    document.getElementById("posts").innerHTML =
      shown.map((p) => postHtml(p, names)).join("") ||
      (mine.length
        ? `<div class="center-stack"><p class="muted">No posts here yet. Be the first.</p><a class="btn btn-primary" href="/community/new" data-link>+ New post</a></div>`
        : `<div class="center-stack"><p class="muted">Join a community to see what people are cooking.</p><a class="btn btn-primary" href="/community/find" data-link>Find communities</a></div>`);
  };
  draw();

  app.querySelectorAll("[data-community]").forEach((chip) =>
    chip.addEventListener("click", () => {
      state.community = chip.dataset.community;
      app.querySelectorAll("[data-community]").forEach((c) => {
        c.classList.toggle("is-active", c === chip);
        c.setAttribute("aria-pressed", c === chip);
      });
      draw();
    }),
  );
  document.getElementById("posts").addEventListener("click", (e) => postActions(e, posts, names));
}

function postHtml(post, names) {
  return `<article class="post">
    ${postHead(post, names)}
    ${post.recipe?.image ? `<a href="/community/post/${post.id}" data-link>${thumbHtml(post.recipe, "card")}</a>` : ""}
    ${postBody(post)}
    ${post.recipe ? recipeMini(post) : ""}
    <div class="row">
      ${likeButton(post)}
      <a class="btn btn-sm" href="/community/post/${post.id}" data-link>${post.kind === "question" ? "Answers" : "Comments"}${post.comments.length ? ` · ${post.comments.length}` : ""}</a>
    </div>
  </article>`;
}

function postHead(post, names, extra = "") {
  return `<div class="row">
    ${avatar(post.author)}
    <span class="row-text grow"><span class="row-title">${esc(post.author.name)}</span><span class="row-sub">${esc(names[post.community] ?? "")} · ${ago(post.createdAt)}</span></span>
    ${post.sample ? `<span class="pill">Sample</span>` : ""}${extra}
  </div>`;
}

function postBody(post) {
  const kind =
    post.kind === "question" ? `<span class="pill self-start">Question</span>`
    : post.kind === "made" ? `<div class="row"><span class="pill">Made it</span>${stars(post.rating)}</div>`
    : "";
  return `${kind}${post.caption ? `<p class="caption ${post.kind === "question" ? "h3" : ""}">${esc(post.caption)}</p>` : ""}`;
}

function likeButton(post) {
  return `<button class="btn btn-sm ${post.liked ? "is-on" : ""}" type="button" data-like="${post.id}" aria-pressed="${post.liked}" aria-label="${post.liked ? "Unlike" : "Like"}, ${post.likes} likes">${post.liked ? "♥" : "♡"} ${post.likes}</button>`;
}

function recipeMini(post) {
  const r = post.recipe;
  const meta = [r.totalTime, r.yield].filter(Boolean).map(esc).join(" · ");
  const flags = dietaryFlags(r);
  return `<div class="mini-card">${thumbHtml(r, "sm")}
    <span class="row-text grow"><span class="row-title">${esc(r.title)}</span>${meta ? `<span class="row-sub">${meta}</span>` : ""}
      ${flags.map((f) => `<span class="tag-check">${esc(f.flag)}</span>`).join("")}</span>
    ${saveButton(post)}</div>`;
}

// Your own recipe opens from your library. Anyone else's can be saved as a copy, once.
function saveButton(post, { big = false } = {}) {
  const own = post.author.you ? state.recipes.find((r) => r.id === post.recipeId) : null;
  const copy = state.recipes.find((r) => r.source?.postId === post.id);
  const size = big ? "" : "btn-sm";
  if (own || copy) return `<a class="btn ${size}" href="/recipe/${(own || copy).id}" data-link>${own ? "Open" : "Saved ✓"}</a>`;
  return `<button class="btn ${size} ${big ? "btn-primary" : ""}" type="button" data-save="${post.id}">${big ? "Save to Library" : "Save"}</button>`;
}

async function postActions(e, posts, names) {
  const button = e.target.closest("[data-like], [data-save]");
  if (!button) return;
  const post = posts.find((p) => p.id === (button.dataset.like ?? button.dataset.save));
  button.disabled = true;
  try {
    if (button.dataset.like) {
      Object.assign(post, await api(`/api/community/posts/${post.id}/like`, { method: "POST", body: { liked: !post.liked } }));
      button.outerHTML = likeButton(post);
    } else {
      const saved = await api("/api/recipes", {
        method: "POST",
        body: { ...post.recipe, source: { type: "community", url: null, name: `${post.author.name} in ${names[post.community]}`, postId: post.id } },
      });
      state.recipes.unshift(saved);
      button.outerHTML = saveButton(post, { big: button.classList.contains("btn-primary") });
      toast("Saved to your library");
    }
  } catch (err) {
    toast(err.message);
    button.disabled = false;
  }
}

export async function renderPost(id) {
  const [post] = await Promise.all([api(`/api/community/posts/${id}`), refreshLibrary(), loadCommunities()]);
  const names = communityNames();
  const r = post.recipe;
  const items = r ? r.ingredientGroups.flatMap((g) => g.items) : [];
  const stepCount = r ? r.stepGroups.reduce((sum, g) => sum + g.steps.length, 0) : 0;
  const more = [items.length > 5 && `+ ${items.length - 5} more ingredients`, stepCount && plural(stepCount, "step")].filter(Boolean).join(" · ");
  const flags = r ? dietaryFlags(r) : [];

  app.innerHTML = `
    <section class="screen">
      <header class="topbar"><a class="link" href="/community" data-link>‹ Community</a><div class="topbar-title">${esc(names[post.community] ?? "")}</div></header>
      <div class="pad narrow" id="post">
        ${postHead(post, names, post.author.you ? `<button class="u small danger" type="button" id="delete-post">Delete</button>` : "")}
        ${r?.image ? thumbHtml(r, "card") : ""}
        ${postBody(post)}
        ${r ? `<div class="box-card">
          <div class="row">${thumbHtml(r, "md")}<span class="row-text grow"><span class="row-title">${esc(r.title)}</span><span class="row-sub">${[r.yield, r.totalTime].filter(Boolean).map(esc).join(" · ")}</span></span></div>
          ${flags.length ? `<div class="banner"><b>Heads up:</b> ${esc(flags.map((f) => (f.words.length ? `${f.flag} (${f.words.slice(0, 3).join(", ")})` : f.flag)).join(" · "))}. Check the comments for swaps.</div>` : ""}
          <ul class="preview-list">${items.slice(0, 5).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
          ${more ? `<span class="small muted">${more}</span>` : ""}
          ${saveButton(post, { big: true })}
        </div>` : ""}
        <div class="row">${likeButton(post)}<span class="small muted">${plural(post.comments.length, post.kind === "question" ? "answer" : "comment")}</span></div>
        <section class="section">
          <h2 class="h3">${post.kind === "question" ? "Answers" : "Comments"}</h2>
          ${post.comments.length ? `<ul class="comments">${post.comments.map((c) => `<li>${avatar(c.author, "sm")}
            <span class="row-text grow"><span class="small"><b>${esc(c.author.name)}</b>${c.author.name === post.author.name ? " · Author" : ""} · ${ago(c.createdAt)}</span><p class="caption">${esc(c.text)}</p></span></li>`).join("")}</ul>`
          : `<p class="muted">Nothing yet. Start the conversation.</p>`}
        </section>
      </div>
      <form class="composer" id="comment-form">
        <input class="input grow" name="text" placeholder="${post.kind === "question" ? "Add an answer" : "Add a comment"}" aria-label="Add a comment" maxlength="1000" autocomplete="off" required>
        <button class="btn btn-primary" type="submit">Post</button>
      </form>
    </section>`;

  document.getElementById("post").addEventListener("click", (e) => postActions(e, [post], names));
  document.getElementById("delete-post")?.addEventListener("click", async () => {
    if (!(await confirmDialog("Delete this post?", "Its comments go with it. Recipes saved from it stay in your library."))) return;
    await api(`/api/community/posts/${post.id}`, { method: "DELETE" });
    toast("Post deleted");
    navigate("/community");
  });

  const form = document.getElementById("comment-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = form.elements.text.value.trim();
    if (!text) return;
    form.querySelector("button").disabled = true;
    try {
      await api(`/api/community/posts/${post.id}/comments`, { method: "POST", body: { text } });
      await renderPost(id);
      window.scrollTo(0, document.body.scrollHeight);
    } catch (err) {
      toast(err.message);
      form.querySelector("button").disabled = false;
    }
  });
}

export async function renderNewPost() {
  await Promise.all([refreshLibrary(), loadCommunities()]);
  const params = new URLSearchParams(location.search);
  let picked = state.recipes.find((r) => r.id === params.get("recipe")) ?? null;
  const mine = state.communities.filter((c) => joined().includes(c.id));
  if (!mine.length) {
    toast("Join a community first, then you can post to it.");
    return navigate("/community/find", { replace: true });
  }
  const preselected = joined().includes(state.community) ? state.community : mine[0].id;

  app.innerHTML = `
    <form class="screen" id="post-form">
      <header class="topbar">
        <a class="link" href="/community" data-link>Cancel</a>
        <div class="topbar-title center">New post</div>
        <button class="link strong" type="submit">Post</button>
      </header>
      <div class="pad narrow">
        <div class="field"><span class="label">Post to</span><div class="row row-wrap">
          ${mine.map((c) => `<label class="chip"><input type="radio" name="community" value="${esc(c.id)}" ${c.id === preselected ? "checked" : ""}>${esc(c.name)}</label>`).join("")}
        </div></div>
        <div class="field"><span class="label">Recipe</span><div id="picked"></div></div>
        <label class="check-row"><input type="checkbox" name="made" ${params.get("made") ? "checked" : ""}><span>I made this</span></label>
        <label class="field"><span class="label">Caption</span>
          <textarea class="input" name="caption" rows="4" maxlength="2000" placeholder="A tip, a swap, how it turned out, or a question"></textarea></label>
        <p class="hint">Posts are kept on this computer. Sharing with other people needs accounts, which Al Dente doesn't have yet. Your private notes on a recipe aren't shared.</p>
        <button class="btn btn-primary" type="submit">Post</button>
      </div>
    </form>`;

  const drawPicked = () => {
    document.getElementById("picked").innerHTML = picked
      ? `<div class="mini-card">${thumbHtml(picked, "sm")}<span class="row-text grow"><span class="row-title">${esc(picked.title)}</span><span class="row-sub">From your library</span></span>
          <button class="u small" type="button" data-change>Change</button></div>`
      : `<button class="btn self-start" type="button" data-change>+ Attach a recipe</button>`;
  };
  drawPicked();

  document.getElementById("picked").addEventListener("click", (e) => {
    if (!e.target.closest("[data-change]")) return;
    const sheet = openSheet("Choose a recipe", `<div class="list">
      ${state.recipes.map((r) => `<button class="list-row" type="button" data-pick="${r.id}">${thumbHtml(r, "sm")}
        <span class="row-text grow"><span class="row-title">${esc(r.title)}</span><span class="row-sub">${esc([r.category, r.totalTime].filter(Boolean).join(" · "))}</span></span></button>`).join("")
        || `<p class="muted">Your library is empty. <a class="u" href="/add" data-link>Add a recipe</a> first.</p>`}
      <button class="list-row" type="button" data-pick=""><span class="shape" aria-hidden="true">💬</span><span class="row-title grow">No recipe, just a post</span></button>
    </div>`);
    sheet.addEventListener("click", (event) => {
      const pick = event.target.closest("[data-pick]");
      if (!pick) return;
      picked = state.recipes.find((r) => r.id === pick.dataset.pick) ?? null;
      drawPicked();
      sheet.remove();
    });
  });

  const form = document.getElementById("post-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const caption = f.get("caption").trim();
    if (!caption && !picked) return toast("Add a caption or a recipe.");
    const buttons = form.querySelectorAll('[type="submit"]');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await api("/api/community/posts", {
        method: "POST",
        body: { community: f.get("community"), caption, recipeId: picked?.id ?? null, made: f.has("made") },
      });
      state.community = "all";
      toast("Posted");
      navigate("/community");
    } catch (err) {
      toast(err.message);
      buttons.forEach((b) => { b.disabled = false; });
    }
  });
}

export async function renderFindCommunities() {
  const { communities, posts } = await api("/api/community");
  state.communities = communities;
  const draw = () => {
    document.getElementById("communities").innerHTML = communities
      .map((c) => {
        const count = posts.filter((p) => p.community === c.id).length;
        const isIn = joined().includes(c.id);
        return `<div class="list-row"><span class="shape shape-circle" aria-hidden="true">${esc(c.name[0])}</span>
          <span class="row-text grow"><span class="row-title">${esc(c.name)}</span><span class="row-sub">${plural(count, "post")}</span></span>
          <button class="btn btn-sm ${isIn ? "is-on" : "btn-primary"}" type="button" data-join="${esc(c.id)}" aria-pressed="${isIn}">${isIn ? "Joined ✓" : "Join"}</button></div>`;
      })
      .join("");
  };
  app.innerHTML = `
    <section class="screen">
      <header class="topbar"><a class="link" href="/community" data-link>‹ Community</a><div class="topbar-title">Find communities</div></header>
      <div class="pad narrow">
        <p class="muted">Join a community to see its posts in your feed and to post there.</p>
        <div class="list" id="communities"></div>
      </div>
    </section>`;
  draw();
  document.getElementById("communities").addEventListener("click", async (e) => {
    const button = e.target.closest("[data-join]");
    if (!button) return;
    const id = button.dataset.join;
    const next = joined().includes(id) ? joined().filter((c) => c !== id) : [...joined(), id];
    await saveProfile({ joined: next });
    draw();
  });
}
