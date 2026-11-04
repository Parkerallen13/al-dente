// Your profile lives in data/profile.json on this computer. There are no accounts:
// it holds your name, photo, dietary needs, theme and layout, the communities you've joined,
// and the state of the cookbook simulator. Writes use the same temp-file-and-rename
// approach as storage.js.
import fs from "node:fs/promises";
import path from "node:path";
import { COMMUNITIES } from "./community.js";

// DATA_DIR points at the mounted disk in production (see fly.toml).
const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
const DB_FILE = path.join(DATA_DIR, "profile.json");

export const DIETS = ["vegetarian", "vegan", "gluten-free", "dairy-free", "nut-free"];
const THEMES = ["system", "light", "dark"];
const LAYOUTS = ["classic", "editorial", "bold", "journal", "zine", "midcentury", "bistro"];
const MAX_PHOTO = 400_000;

const DEFAULTS = {
  onboarded: false,
  name: "",
  photo: null,
  dietary: [],
  dietaryOther: "",
  since: null,
  theme: "system",
  layout: "classic",
  joined: ["weeknight", "tamales"],
  cookbook: { connected: false, pairedAt: null, items: [] },
};

let cache = null;
let writeQueue = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(DB_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    cache = {};
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

export async function getProfile() {
  const db = await load();
  return { ...DEFAULTS, ...db, cookbook: { ...DEFAULTS.cookbook, ...db.cookbook } };
}

// Only known fields are kept, and each is checked, so the file can't fill with junk.
export async function updateProfile(changes) {
  const db = await load();
  const list = (v) => (Array.isArray(v) ? v : []);
  const clean = {};
  if ("name" in changes) clean.name = String(changes.name ?? "").trim().slice(0, 60);
  if ("photo" in changes) {
    const ok = typeof changes.photo === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(changes.photo) && changes.photo.length < MAX_PHOTO;
    clean.photo = ok ? changes.photo : null;
  }
  if ("dietary" in changes) clean.dietary = list(changes.dietary).filter((d) => DIETS.includes(d));
  if ("dietaryOther" in changes) clean.dietaryOther = String(changes.dietaryOther ?? "").trim().slice(0, 200);
  if ("theme" in changes) clean.theme = THEMES.includes(changes.theme) ? changes.theme : "system";
  if ("layout" in changes) clean.layout = LAYOUTS.includes(changes.layout) ? changes.layout : "classic";
  if ("joined" in changes) clean.joined = list(changes.joined).filter((id) => COMMUNITIES.some((c) => c.id === id));
  if ("onboarded" in changes) {
    clean.onboarded = Boolean(changes.onboarded);
    if (clean.onboarded && !db.since) clean.since = new Date().toISOString();
  }
  if ("cookbook" in changes) {
    const c = changes.cookbook ?? {};
    const connected = Boolean(c.connected);
    clean.cookbook = {
      connected,
      pairedAt: connected ? (db.cookbook?.pairedAt ?? new Date().toISOString()) : null,
      items: list(c.items)
        .filter((i) => typeof i?.recipeId === "string")
        .map((i) => ({ recipeId: i.recipeId, sentAt: typeof i.sentAt === "string" ? i.sentAt : new Date().toISOString() })),
    };
  }
  Object.assign(db, clean);
  await persist();
  return getProfile();
}
