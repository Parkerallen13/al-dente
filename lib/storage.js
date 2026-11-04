// Recipes live in a single JSON file under data/. Writes go to a temp file and
// are renamed into place so a crash mid-write can't corrupt the library.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// DATA_DIR points at the mounted disk in production (see fly.toml).
const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
const DB_FILE = path.join(DATA_DIR, "recipes.json");

const DEFAULT_CATEGORIES = [
  "Breakfast",
  "Mains",
  "Sides",
  "Soups & Salads",
  "Baking",
  "Desserts",
  "Drinks",
];

let cache = null;
let writeQueue = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(DB_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    cache = { categories: [...DEFAULT_CATEGORIES], recipes: [] };
  }
  return cache;
}

function persist() {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${DB_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(cache, null, 2));
    await fs.rename(tmp, DB_FILE);
  });
  return writeQueue;
}

export async function listRecipes() {
  const db = await load();
  return [...db.recipes].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function getRecipe(id) {
  const db = await load();
  return db.recipes.find((r) => r.id === id) ?? null;
}

export async function saveRecipe(recipe) {
  const db = await load();
  const saved = {
    ...recipe,
    id: crypto.randomUUID(),
    category: recipe.category || null,
    favorite: Boolean(recipe.favorite),
    savedAt: new Date().toISOString(),
  };
  db.recipes.push(saved);
  if (saved.category) addCategoryInPlace(db, saved.category);
  await persist();
  return saved;
}

export async function updateRecipe(id, changes) {
  const db = await load();
  const recipe = db.recipes.find((r) => r.id === id);
  if (!recipe) return null;
  const { id: _id, savedAt: _savedAt, ...rest } = changes;
  Object.assign(recipe, rest, { updatedAt: new Date().toISOString() });
  if (recipe.category) addCategoryInPlace(db, recipe.category);
  await persist();
  return recipe;
}

export async function deleteRecipe(id) {
  const db = await load();
  const before = db.recipes.length;
  db.recipes = db.recipes.filter((r) => r.id !== id);
  if (db.recipes.length === before) return false;
  await persist();
  return true;
}

export async function listCategories() {
  const db = await load();
  return db.categories.map((name) => ({
    name,
    count: db.recipes.filter((r) => r.category === name).length,
  }));
}

export async function addCategory(name) {
  const db = await load();
  addCategoryInPlace(db, name);
  await persist();
  return listCategories();
}

export async function renameCategory(from, to) {
  const db = await load();
  if (!db.categories.includes(from)) return null;
  if (db.categories.includes(to)) {
    db.categories = db.categories.filter((c) => c !== from);
  } else {
    db.categories = db.categories.map((c) => (c === from ? to : c));
  }
  for (const r of db.recipes) if (r.category === from) r.category = to;
  await persist();
  return listCategories();
}

export async function deleteCategory(name) {
  const db = await load();
  db.categories = db.categories.filter((c) => c !== name);
  for (const r of db.recipes) if (r.category === name) r.category = null;
  await persist();
  return listCategories();
}

function addCategoryInPlace(db, name) {
  if (!db.categories.includes(name)) db.categories.push(name);
}
