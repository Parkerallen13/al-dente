// Turns a link, photo, PDF, or pasted text into a normalized recipe.
//
// Recipe websites almost always embed schema.org/Recipe JSON-LD, so links are
// parsed directly first (fast, free, exact). Everything else — social posts,
// blogs without markup, photos of cookbooks, emails — goes to Claude.
import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";

const MODEL = "claude-opus-5-5";
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export class ExtractError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

// ---------------------------------------------------------------------------
// Entry points

export async function extractFromUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.trim());
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch {
    throw new ExtractError("That doesn't look like a valid web link.", 400);
  }

  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml,image/*,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ExtractError(
      "Couldn't reach that page. Check the link, or paste the recipe text / upload a screenshot instead.",
    );
  }
  if (!res.ok) {
    throw new ExtractError(
      `That site blocked us from reading the page (HTTP ${res.status}). Copy the recipe text into the “Paste text” tab, or upload a screenshot instead.`,
    );
  }

  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim();
  const source = { type: sourceTypeFor(url), url: res.url || url.href, name: siteName(url) };

  // A direct link to a photo or PDF of a recipe.
  if (IMAGE_TYPES.has(contentType) || contentType === "application/pdf") {
    const data = Buffer.from(await res.arrayBuffer()).toString("base64");
    return extractFromFiles([{ type: contentType, data }], "", source);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const structured = findJsonLdRecipe($);
  if (structured) {
    const recipe = normalizeJsonLd(structured, source);
    if (recipe.ingredientGroups.length && recipe.stepGroups.length) return recipe;
  }

  const meta = pageMeta($);
  const pageText = readableText($);
  const prompt = [
    `Source URL: ${source.url}`,
    meta.title && `Page title: ${meta.title}`,
    meta.description && `Page description / post caption:\n${meta.description}`,
    `Page text:\n${pageText || "(no readable text)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const recipe = await extractWithClaude([{ type: "text", text: prompt }], source);
  if (!recipe.image && meta.image) recipe.image = meta.image;
  return recipe;
}

export async function extractFromText(text) {
  if (!text?.trim()) throw new ExtractError("Paste some recipe text first.", 400);
  return extractWithClaude(
    [{ type: "text", text: `Recipe text (pasted by the user):\n\n${text}` }],
    { type: "text", url: null, name: null },
  );
}

// A voice memo arrives as a speech-to-text transcript made in the browser.
export async function extractFromVoice(transcript) {
  if (!transcript?.trim()) throw new ExtractError("Record or type the recipe first.", 400);
  return extractWithClaude(
    [{
      type: "text",
      text: `Transcript of a voice memo where someone talks through a recipe out loud. It comes from speech-to-text, so expect filler words, repeats, and misheard words.\n\n${transcript}`,
    }],
    { type: "voice", url: null, name: null, transcript: transcript.trim() },
  );
}

// ---------------------------------------------------------------------------
// Generating an original recipe from a cuisine, dietary needs, time, and ingredients.

const GENERATE_PROMPT = `You create original recipes for home cooks: specific, appealing dishes with clear steps, never generic ones.

Rules:
- Make one complete recipe that meets every requirement you're given. Dietary needs are strict: never include an ingredient that breaks one, including in sauces, stocks, and garnishes.
- Ingredients: one per line, quantity first ("2 cups flour, sifted"). Use a single group with an empty name unless the dish has distinct parts.
- Steps: one clear action per step, imperative voice, in order. In every step, include the amount of each ingredient it uses ("Whisk in 2 eggs and 1 tsp vanilla"). Keep temperatures, times, and doneness cues.
- Times as short human strings like "15 min" or "1 hr 20 min". Keep totalTime honest.
- description: one or two sentences that make someone want to cook it.
- notes: a tip or two, such as a swap or how to store it. Keep them short.
- Suggest 1–5 short lowercase tags. suggestedCategory: pick from Breakfast, Mains, Sides, Soups & Salads, Baking, Desserts, Drinks, Snacks, Sauces.
- Set found to true, reason and author to empty strings, and uncertain to an empty array.`;

const DIETS = {
  vegetarian: "vegetarian",
  vegan: "vegan",
  "gluten-free": "gluten-free",
  "dairy-free": "dairy-free",
  "nut-free": "free of all tree nuts and peanuts",
};
// When the cook doesn't narrow it down, one of these keeps "surprise me" from repeating itself.
const IDEAS = [
  "a one-pan dinner", "a noodle dish", "a hearty soup", "a crunchy salad", "something built around eggs",
  "a sheet-pan bake", "a stir-fry", "a slow braise", "tacos or wraps", "a rice bowl", "a savory pie or tart",
  "a curry", "a pasta", "a grain salad", "dumplings", "skewers", "breakfast for dinner", "a seafood dish",
  "a vegetable-forward main", "a cozy casserole",
];

export async function generateRecipe(options = {}) {
  if (!aiAvailable()) {
    throw new ExtractError("Generating a recipe needs AI. Add your ANTHROPIC_API_KEY to the .env file and restart Al Dente.", 503);
  }
  const text = (v, max) => String(v ?? "").trim().slice(0, max);
  const cuisine = text(options.cuisine, 40);
  const diets = (Array.isArray(options.diets) ? options.diets : []).filter((d) => DIETS[d]).map((d) => DIETS[d]);
  const avoid = text(options.avoid, 200);
  const time = text(options.time, 40);
  const ingredients = text(options.ingredients, 200);
  const exclude = (Array.isArray(options.exclude) ? options.exclude : []).slice(-5).map((t) => text(t, 80)).filter(Boolean);
  const idea = IDEAS[Math.floor(Math.random() * IDEAS.length)];
  const asks = [
    cuisine ? `Cuisine: ${cuisine}.` : `Cuisine: your choice. Surprise the cook with ${idea}.`,
    diets.length && `It must be ${diets.join(", ")}.`,
    avoid && `Leave out: ${avoid}.`,
    time && `Total time: ${time}.`,
    ingredients && `Build it around these if you can: ${ingredients}.`,
    exclude.length && `Make something different from these recent ideas: ${exclude.join("; ")}.`,
  ].filter(Boolean);
  return extractWithClaude(
    [{ type: "text", text: `Create a recipe.\n\n${asks.join("\n")}` }],
    { type: "generated", url: null, name: null },
    GENERATE_PROMPT,
  );
}

export async function extractFromFiles(files, note = "", source = null) {
  if (!files?.length) throw new ExtractError("Add at least one photo or PDF.", 400);
  const content = files.map((f) => {
    if (f.type === "application/pdf") {
      return { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } };
    }
    if (!IMAGE_TYPES.has(f.type)) {
      throw new ExtractError(`Unsupported file type: ${f.type || "unknown"}. Use JPG, PNG, WebP, GIF, or PDF.`, 400);
    }
    return { type: "image", source: { type: "base64", media_type: f.type, data: f.data } };
  });
  content.push({
    type: "text",
    text:
      `These ${files.length > 1 ? "files are pages/photos of one recipe, in order" : "file contains a recipe"}.` +
      (note?.trim() ? `\n\nNote from the user: ${note.trim()}` : ""),
  });
  return extractWithClaude(content, source ?? { type: "photo", url: null, name: null });
}

// ---------------------------------------------------------------------------
// Claude extraction

const SYSTEM_PROMPT = `You turn recipes from messy sources into clean, easy-to-follow recipe cards.

Sources include recipe blogs, social media captions, video descriptions, emails, screenshots, handwritten cards, and cookbook photos.

Rules:
- Preserve the author's quantities, ingredients, and method faithfully. Never invent ingredients or amounts. If an amount is missing, leave it out rather than guessing.
- Drop everything that isn't the recipe: life stories, ads, hashtags, "link in bio", sponsor plugs, comment sections.
- Ingredients: one per line, quantity first ("2 cups flour, sifted"). Keep the author's sub-groups (e.g. "Dough", "Filling") as separate groups; otherwise use a single group with an empty name.
- Steps: one clear action per step, imperative voice, in order. Split long run-on paragraphs into separate steps. Keep temperatures, times, and doneness cues ("until golden, 8–10 min"). Use groups only if the source has distinct stages.
- In every step, include the amount of each ingredient it uses ("Whisk in 2 eggs and 1 tsp vanilla", "Add the remaining ½ cup sugar"), so the cook never has to look back at the ingredient list. Use the amounts from the ingredient list; don't invent new ones.
- Notes: keep genuinely useful tips, substitutions, make-ahead and storage info. Keep them short.
- Times as short human strings like "15 min" or "1 hr 20 min"; empty string if unknown.
- Suggest 1–5 short lowercase tags (cuisine, main ingredient, diet, method).
- suggestedCategory: pick the best fit from Breakfast, Mains, Sides, Soups & Salads, Baking, Desserts, Drinks, Snacks, Sauces.
- uncertain: list anything you couldn't read or hear clearly, or that the source leaves vague (a smudged amount, "a couple pounds", a serving size you had to infer). field names it in a few words, like "Servings" or "Ingredient: masa harina"; note says what you found and what you used, like "Hard to read: 4 or 6 cups? Used 4." Use an empty array when nothing is uncertain.
- If the input contains no recipe at all, set found to false and explain briefly in reason.`;

const str = { type: "string" };
const RECIPE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "found", "reason", "title", "description", "author", "yield", "prepTime", "cookTime",
    "totalTime", "ingredientGroups", "stepGroups", "notes", "tags", "suggestedCategory", "uncertain",
  ],
  properties: {
    found: { type: "boolean" },
    reason: str,
    title: str,
    description: { type: "string", description: "One or two sentence summary of the dish." },
    author: str,
    yield: { type: "string", description: 'e.g. "4 servings" or "24 cookies"' },
    prepTime: str,
    cookTime: str,
    totalTime: str,
    ingredientGroups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "items"],
        properties: { name: str, items: { type: "array", items: str } },
      },
    },
    stepGroups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "steps"],
        properties: { name: str, steps: { type: "array", items: str } },
      },
    },
    notes: { type: "array", items: str },
    tags: { type: "array", items: str },
    suggestedCategory: str,
    uncertain: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "note"],
        properties: { field: str, note: str },
      },
    },
  },
};

let client;
function getClient() {
  if (!aiAvailable()) {
    throw new ExtractError(
      "This source needs AI to read it. Add your ANTHROPIC_API_KEY to the .env file and restart Al Dente. (Links to most recipe websites work without it.)",
      503,
    );
  }
  client ??= new Anthropic();
  return client;
}

// One Messages API call with the app's shared settings and error handling. Errors
// come back as ExtractError with a message that's safe to show in the app.
export async function askClaude(params) {
  let response;
  try {
    response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      ...params,
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new ExtractError("Your Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.", 503);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new ExtractError("Too many requests to the AI right now — wait a moment and try again.", 429);
    }
    if (err instanceof Anthropic.BadRequestError) {
      throw new ExtractError(`The AI couldn't process that input: ${err.message}`, 400);
    }
    if (err instanceof Anthropic.APIError) {
      throw new ExtractError(`AI service error (${err.status ?? "network"}). Try again in a moment.`, 502);
    }
    throw err;
  }
  if (response.stop_reason === "refusal") {
    throw new ExtractError("The AI declined to process this input.", 422);
  }
  return response;
}

export function responseText(response) {
  return response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

// Asks Claude for a recipe in RECIPE_SCHEMA's shape: read from a source by default,
// or written from scratch with the generator's prompt.
async function extractWithClaude(content, source, system = SYSTEM_PROMPT) {
  const response = await askClaude({
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: RECIPE_SCHEMA },
    },
    system,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "max_tokens") {
    throw new ExtractError("That recipe was too long to finish formatting. Try splitting it up.", 422);
  }

  const text = responseText(response);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ExtractError("The AI returned something unreadable. Try again.", 502);
  }
  if (!parsed.found) {
    throw new ExtractError(`No recipe found${parsed.reason ? `: ${parsed.reason}` : "."}`);
  }

  return cleanRecipe({
    title: parsed.title,
    description: parsed.description,
    author: parsed.author,
    source,
    image: null,
    yield: parsed.yield,
    prepTime: parsed.prepTime,
    cookTime: parsed.cookTime,
    totalTime: parsed.totalTime,
    ingredientGroups: parsed.ingredientGroups,
    stepGroups: parsed.stepGroups,
    notes: parsed.notes,
    tags: parsed.tags,
    suggestedCategory: parsed.suggestedCategory,
    uncertain: parsed.uncertain,
  });
}

// ---------------------------------------------------------------------------
// schema.org JSON-LD

function findJsonLdRecipe($) {
  const isRecipe = (node) => {
    const t = node?.["@type"];
    return t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"));
  };
  const walk = (node) => {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const hit = walk(n);
        if (hit) return hit;
      }
      return null;
    }
    if (isRecipe(node)) return node;
    return walk(node["@graph"]) || walk(node.mainEntity) || walk(node.mainEntityOfPage);
  };

  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const hit = walk(JSON.parse($(el).text()));
      if (hit) return hit;
    } catch {
      // Malformed JSON-LD is common; skip it.
    }
  }
  return null;
}

function normalizeJsonLd(r, source) {
  const ingredients = toArray(r.recipeIngredient ?? r.ingredients).map(decode).filter(Boolean);

  const stepGroups = [];
  const loose = [];
  const collect = (node, into) => {
    if (!node) return;
    if (typeof node === "string") {
      // Some sites stuff every step into one string separated by newlines.
      into.push(...node.split(/\n+/).map(decode).filter(Boolean));
    } else if (Array.isArray(node)) {
      node.forEach((n) => collect(n, into));
    } else if (node["@type"] === "HowToSection" || node.itemListElement) {
      const steps = [];
      collect(node.itemListElement, steps);
      if (steps.length) stepGroups.push({ name: decode(node.name) || "", steps });
    } else {
      const text = decode(node.text || node.name || "");
      if (text) into.push(text);
    }
  };
  collect(r.recipeInstructions, loose);
  if (loose.length) stepGroups.unshift({ name: "", steps: loose });

  const author = toArray(r.author).map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean)[0];

  return cleanRecipe({
    title: decode(r.name),
    description: decode(r.description),
    author: decode(author),
    source: { ...source, name: source.name },
    image: pickImage(r.image),
    yield: formatYield(r.recipeYield),
    prepTime: formatDuration(r.prepTime),
    cookTime: formatDuration(r.cookTime),
    totalTime: formatDuration(r.totalTime),
    ingredientGroups: ingredients.length ? [{ name: "", items: ingredients }] : [],
    stepGroups,
    notes: [],
    tags: [
      ...toArray(r.recipeCuisine),
      ...toArray(r.recipeCategory),
      ...(typeof r.keywords === "string" ? r.keywords.split(",") : toArray(r.keywords)),
    ]
      .map((t) => decode(String(t)).toLowerCase())
      .filter(Boolean)
      .slice(0, 6),
    suggestedCategory: decode(toArray(r.recipeCategory)[0]),
  });
}

function pickImage(img) {
  const first = toArray(img)[0];
  if (!first) return null;
  return typeof first === "string" ? first : first.url || first.contentUrl || null;
}

function formatYield(y) {
  const values = toArray(y).map(String);
  // Sites often give ["4", "4 servings"]; prefer the descriptive one.
  const best = values.find((v) => /[a-z]/i.test(v)) ?? values[0];
  if (!best) return "";
  return /^\d+$/.test(best.trim()) ? `${best.trim()} servings` : decode(best);
}

function formatDuration(iso) {
  if (!iso || typeof iso !== "string") return "";
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return iso;
  let [, d = 0, h = 0, min = 0] = m.map((v) => Number(v) || 0);
  h += d * 24;
  h += Math.floor(min / 60);
  min %= 60;
  if (!h && !min) return "";
  return [h && `${h} hr`, min && `${min} min`].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Helpers

function pageMeta($) {
  const meta = (sel) => $(sel).attr("content")?.trim() || "";
  return {
    title: meta('meta[property="og:title"]') || $("title").first().text().trim(),
    description: meta('meta[property="og:description"]') || meta('meta[name="description"]'),
    image: meta('meta[property="og:image"]') || null,
  };
}

function readableText($) {
  $("script, style, noscript, svg, iframe, nav, footer, header, aside, form, [aria-hidden=true]").remove();
  const root = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body");
  root.find("br").replaceWith("\n");
  root.find("p, li, h1, h2, h3, h4, h5, h6, div, tr, section").each((_, el) => {
    $(el).append("\n");
  });
  return root
    .text()
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function cleanRecipe(r) {
  const s = (v) => (typeof v === "string" ? v.trim() : "");
  return {
    title: s(r.title) || "Untitled recipe",
    description: s(r.description),
    author: s(r.author),
    source: r.source,
    image: r.image || null,
    yield: s(r.yield),
    prepTime: s(r.prepTime),
    cookTime: s(r.cookTime),
    totalTime: s(r.totalTime),
    ingredientGroups: (r.ingredientGroups || [])
      .map((g) => ({ name: s(g.name), items: (g.items || []).map(s).filter(Boolean) }))
      .filter((g) => g.items.length),
    stepGroups: (r.stepGroups || [])
      .map((g) => ({ name: s(g.name), steps: (g.steps || []).map(s).filter(Boolean) }))
      .filter((g) => g.steps.length),
    notes: (r.notes || []).map(s).filter(Boolean),
    tags: [...new Set((r.tags || []).map((t) => s(t).toLowerCase()).filter(Boolean))],
    suggestedCategory: s(r.suggestedCategory),
    uncertain: (r.uncertain || [])
      .map((u) => ({ field: s(u?.field), note: s(u?.note) }))
      .filter((u) => u.field && u.note),
  };
}

function decode(v) {
  if (!v || typeof v !== "string") return "";
  // Strip tags and decode entities the way a browser would.
  return cheerio.load(`<div>${v}</div>`)("div").text().replace(/\s+/g, " ").trim();
}

function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function siteName(url) {
  return url.hostname.replace(/^www\./, "");
}

function sourceTypeFor(url) {
  const host = url.hostname.replace(/^www\./, "");
  const social = ["instagram.com", "tiktok.com", "facebook.com", "pinterest.com", "youtube.com", "youtu.be", "x.com", "twitter.com", "threads.net", "reddit.com"];
  return social.some((d) => host === d || host.endsWith(`.${d}`)) ? "social" : "website";
}
