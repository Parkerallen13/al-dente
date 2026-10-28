import express from "express";
import path from "node:path";
import {
  ExtractError,
  aiAvailable,
  extractFromFiles,
  extractFromText,
  extractFromUrl,
} from "./lib/extract.js";
import * as store from "./lib/storage.js";

try {
  process.loadEnvFile();
} catch {
  // No .env file — fine, links to recipe sites still work without a key.
}

const PORT = Number(process.env.PORT) || 3000;
const app = express();

// Photos arrive base64-encoded inside JSON, so allow generous bodies.
app.use(express.json({ limit: "40mb" }));
app.use(express.static(path.resolve("public")));

app.get("/api/status", (_req, res) => {
  res.json({ ai: aiAvailable() });
});

app.post("/api/extract", async (req, res, next) => {
  try {
    const { url, text, files, note } = req.body ?? {};
    let recipe;
    if (url) recipe = await extractFromUrl(url);
    else if (files?.length) recipe = await extractFromFiles(files, note);
    else if (text) recipe = await extractFromText(text);
    else throw new ExtractError("Provide a link, some text, or a photo.", 400);
    res.json(recipe);
  } catch (err) {
    next(err);
  }
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
