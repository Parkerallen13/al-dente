import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import {
  ExtractError,
  aiAvailable,
  extractFromFiles,
  extractFromText,
  extractFromUrl,
  extractFromVoice,
  generateRecipe,
} from "./lib/extract.js";
import { askAssistant } from "./lib/assistant.js";
import * as store from "./lib/storage.js";
import * as feed from "./lib/community.js";
import * as profiles from "./lib/profile.js";

try {
  process.loadEnvFile();
} catch {
  // No .env file — fine, links to recipe sites still work without a key.
}

const PORT = Number(process.env.PORT) || 3000;
const app = express();

// With APP_PASSWORD set (production always sets it), every request needs the
// password. The browser shows its own sign-in box; the username can be anything.
const PASSWORD = process.env.APP_PASSWORD;
if (PASSWORD) {
  const digest = (s) => crypto.createHash("sha256").update(s).digest();
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization ?? "").split(" ");
    const given = scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString().split(":").slice(1).join(":") : "";
    if (crypto.timingSafeEqual(digest(given), digest(PASSWORD))) return next();
    res.set("WWW-Authenticate", 'Basic realm="Al Dente", charset="UTF-8"').status(401).send("Al Dente needs its password.");
  });
}

// Photos arrive base64-encoded inside JSON, so allow generous bodies.
app.use(express.json({ limit: "40mb" }));
app.use(express.static(path.resolve("public")));

app.get("/api/status", (_req, res) => {
  res.json({ ai: aiAvailable() });
});

app.post("/api/extract", async (req, res, next) => {
  try {
    const { url, text, voice, files, note, generate } = req.body ?? {};
    let recipe;
    if (generate) recipe = await generateRecipe(generate);
    else if (url) recipe = await extractFromUrl(url);
    else if (files?.length) recipe = await extractFromFiles(files, note);
    else if (voice) recipe = await extractFromVoice(voice);
    else if (text) recipe = await extractFromText(text);
    else throw new ExtractError("Provide a link, some text, a voice memo, or a photo.", 400);
    res.json(recipe);
  } catch (err) {
    next(err);
  }
});

app.post("/api/assistant", async (req, res, next) => {
  try {
    const recipe = await store.getRecipe(req.body?.recipeId);
    if (!recipe) return res.status(404).json({ error: "Recipe not found." });
    const question = String(req.body?.question ?? "").trim().slice(0, 1000);
    if (!question) return res.status(400).json({ error: "Ask a question first." });
    const history = (Array.isArray(req.body?.history) ? req.body.history : [])
      .slice(-12)
      .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.text === "string" && m.text.trim())
      .map((m) => ({ role: m.role, content: m.text.slice(0, 2000) }));
    while (history[0]?.role === "assistant") history.shift();
    res.json({ answer: await askAssistant(recipe, history, question) });
  } catch (err) {
    next(err);
  }
});

app.get("/api/profile", async (_req, res) => {
  res.json(await profiles.getProfile());
});

app.patch("/api/profile", async (req, res) => {
  res.json(await profiles.updateProfile(req.body ?? {}));
});

app.get("/api/recipes", async (_req, res) => {
  res.json(await store.listRecipes());
});

app.post("/api/recipes", async (req, res) => {
  if (!req.body?.title) return res.status(400).json({ error: "A recipe needs a title." });
  res.status(201).json(await store.saveRecipe(req.body));
});

app.get("/api/recipes/:id", async (req, res) => {
  const recipe = await store.getRecipe(req.params.id);
  if (!recipe) return res.status(404).json({ error: "Recipe not found." });
  res.json(recipe);
});

app.patch("/api/recipes/:id", async (req, res) => {
  const recipe = await store.updateRecipe(req.params.id, req.body ?? {});
  if (!recipe) return res.status(404).json({ error: "Recipe not found." });
  res.json(recipe);
});

app.delete("/api/recipes/:id", async (req, res) => {
  const ok = await store.deleteRecipe(req.params.id);
  if (!ok) return res.status(404).json({ error: "Recipe not found." });
  res.status(204).end();
});

app.get("/api/categories", async (_req, res) => {
  res.json(await store.listCategories());
});

app.post("/api/categories", async (req, res) => {
  const name = req.body?.name?.trim();
  if (!name) return res.status(400).json({ error: "Category name is required." });
  res.status(201).json(await store.addCategory(name));
});

app.patch("/api/categories/:name", async (req, res) => {
  const to = req.body?.name?.trim();
  if (!to) return res.status(400).json({ error: "New name is required." });
  const result = await store.renameCategory(req.params.name, to);
  if (!result) return res.status(404).json({ error: "Category not found." });
  res.json(result);
});

app.delete("/api/categories/:name", async (req, res) => {
  res.json(await store.deleteCategory(req.params.name));
});

app.get("/api/community", async (_req, res) => {
  res.json(await feed.getFeed());
});

app.get("/api/community/posts/:id", async (req, res) => {
  const post = await feed.getPost(req.params.id);
  if (!post) return res.status(404).json({ error: "Post not found." });
  res.json(post);
});

app.post("/api/community/posts", async (req, res) => {
  const { community, recipeId, made } = req.body ?? {};
  const caption = String(req.body?.caption ?? "").trim().slice(0, 2000);
  if (!feed.COMMUNITIES.some((c) => c.id === community)) return res.status(400).json({ error: "Pick a community to post to." });
  const recipe = recipeId ? await store.getRecipe(recipeId) : null;
  if (recipeId && !recipe) return res.status(404).json({ error: "That recipe isn't in your library anymore." });
  if (!caption && !recipe) return res.status(400).json({ error: "Add a caption or a recipe." });
  const author = (await profiles.getProfile()).name || "You";
  res.status(201).json(await feed.addPost({ community, caption, recipe, made: Boolean(made), author }));
});

app.post("/api/community/posts/:id/like", async (req, res) => {
  const post = await feed.setLiked(req.params.id, Boolean(req.body?.liked));
  if (!post) return res.status(404).json({ error: "Post not found." });
  res.json(post);
});

app.post("/api/community/posts/:id/comments", async (req, res) => {
  const text = String(req.body?.text ?? "").trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: "Write a comment first." });
  const post = await feed.addComment(req.params.id, text, (await profiles.getProfile()).name || "You");
  if (!post) return res.status(404).json({ error: "Post not found." });
  res.status(201).json(post);
});

app.delete("/api/community/posts/:id", async (req, res) => {
  const ok = await feed.deletePost(req.params.id);
  if (!ok) return res.status(404).json({ error: "You can only delete your own posts." });
  res.status(204).end();
});

// SPA fallback so deep links like /recipe/<id> load the app.
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.resolve("public/index.html"));
});

app.use((err, _req, res, _next) => {
  if (err instanceof ExtractError) return res.status(err.status).json({ error: err.message });
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Those files are too large. Try fewer or smaller photos." });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our end." });
});

app.listen(PORT, () => {
  console.log(`\n  🍝 Al Dente is running at http://localhost:${PORT}\n`);
  if (!aiAvailable()) {
    console.log("  Note: no ANTHROPIC_API_KEY set — recipe websites work, but photos,");
    console.log("  social posts, and pasted text need a key in .env.\n");
  }
});
