// Community posts live in data/community.json, on this computer only. There are no
// accounts yet, so you are the only real author; a new file starts with sample posts
// (marked sample: true) so the feed has something in it. Writes use the same
// temp-file-and-rename approach as storage.js.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DATA_DIR = path.resolve("data");
const DB_FILE = path.join(DATA_DIR, "community.json");

export const COMMUNITIES = [
  { id: "weeknight", name: "Weeknight Cooks" },
  { id: "tamales", name: "Tamale Season" },
  { id: "baking", name: "Bread & Baking" },
];

let cache = null;
let writeQueue = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(DB_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    cache = { posts: samplePosts() };
    await persist();
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

export async function getFeed() {
  const db = await load();
  const posts = [...db.posts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { communities: COMMUNITIES, posts };
}

export async function getPost(id) {
  const db = await load();
  return db.posts.find((p) => p.id === id) ?? null;
}

// The post keeps its own copy of the recipe, so later edits or deletes in your
// library don't change what people already saw.
// author is the poster's profile name; posts and comments you make are marked you: true.
export async function addPost({ community, caption, recipe, made, author }) {
  const db = await load();
  let snapshot = null;
  if (recipe) {
    const { id: _id, savedAt: _savedAt, updatedAt: _updatedAt, favorite: _favorite, category: _category, ...rest } = recipe;
    snapshot = rest;
  }
  const post = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    author: { name: author, you: true },
    community,
    kind: made ? "made" : snapshot ? "recipe" : "text",
    caption,
    recipeId: recipe?.id ?? null,
    recipe: snapshot,
    likes: 0,
    liked: false,
    comments: [],
  };
  db.posts.push(post);
  await persist();
  return post;
}

export async function setLiked(id, liked) {
  const post = await getPost(id);
  if (!post) return null;
  if (post.liked !== liked) {
    post.likes += liked ? 1 : -1;
    post.liked = liked;
    await persist();
  }
  return post;
}

export async function addComment(id, text, author) {
  const post = await getPost(id);
  if (!post) return null;
  post.comments.push({ id: crypto.randomUUID(), author: { name: author, you: true }, text, createdAt: new Date().toISOString() });
  await persist();
  return post;
}

// Only your own posts can be deleted. Returns false if the post isn't yours or doesn't exist.
export async function deletePost(id) {
  const db = await load();
  const post = db.posts.find((p) => p.id === id);
  if (!post?.author.you) return false;
  db.posts = db.posts.filter((p) => p !== post);
  await persist();
  return true;
}

// ---------------------------------------------------------------------------
// Sample posts, dated relative to when the file is first created.

function samplePosts() {
  const now = Date.now();
  const ago = (hours) => new Date(now - hours * 3600 * 1000).toISOString();
  const person = (name) => ({ name, you: false });
  const comment = (name, text, hours) => ({ id: crypto.randomUUID(), author: person(name), text, createdAt: ago(hours) });
  const recipe = (fields) => ({
    description: "",
    author: "",
    source: { type: "community", url: null, name: null },
    image: null,
    prepTime: "",
    cookTime: "",
    notes: [],
    tags: [],
    ...fields,
  });
  const post = (fields) => ({ id: crypto.randomUUID(), sample: true, recipeId: null, recipe: null, liked: false, comments: [], ...fields });

  return [
    post({
      createdAt: ago(2),
      author: person("Priya Shah"),
      community: "weeknight",
      kind: "recipe",
      caption: "Third time making this in a month. Broil it for the last 2 minutes so the glaze gets sticky. I serve it over rice with whatever greens are in the fridge.",
      likes: 24,
      recipe: recipe({
        title: "Miso Butter Salmon",
        author: "Priya Shah",
        yield: "4 servings",
        totalTime: "25 min",
        ingredientGroups: [{ name: "", items: [
          "4 salmon fillets (about 6 oz each)",
          "3 tbsp white miso",
          "2 tbsp butter, softened",
          "1 tbsp honey",
          "1 tbsp rice vinegar",
          "1 tsp grated fresh ginger",
          "2 scallions, thinly sliced",
        ] }],
        stepGroups: [{ name: "", steps: [
          "Heat the oven to 425°F and line a sheet pan with foil.",
          "Mash the miso, butter, honey, rice vinegar, and ginger into a smooth paste.",
          "Pat the salmon dry, set it skin side down on the pan, and spread the miso butter over the tops.",
          "Bake for 10 minutes, then switch to broil for 2 minutes, until the glaze is browned in spots.",
          "Top with the scallions and serve over rice.",
        ] }],
        tags: ["salmon", "weeknight"],
      }),
      comments: [
        comment("Marcus Bell", "White or red miso?", 1),
        comment("Priya Shah", "White. Red gets too salty under the broiler.", 0.8),
        comment("Ana Ruiz", "Made it last night with olive oil instead of butter. Still great.", 0.6),
        comment("Sam Okafor", "Saving this for Thursday.", 0.2),
      ],
    }),
    post({
      createdAt: ago(5),
      author: person("Marcus Bell"),
      community: "weeknight",
      kind: "question",
      caption: "What do you make when you have 20 minutes and no energy? I need new ideas for this week.",
      likes: 8,
      comments: [
        comment("Priya Shah", "Fried rice. Day-old rice, frozen peas, two eggs, soy sauce. Ten minutes.", 4),
        comment("Sam Okafor", "Quesadillas with whatever's in the fridge. No shame.", 3),
      ],
    }),
    post({
      createdAt: ago(26),
      author: person("Ana Ruiz"),
      community: "tamales",
      kind: "made",
      rating: 5,
      caption: "Made these with my mom for the first time. Shortening instead of lard keeps them vegetarian, and they were still fluffy.",
      likes: 18,
      recipe: recipe({
        title: "Rajas con Queso Tamales",
        author: "Ana Ruiz",
        yield: "24 tamales",
        totalTime: "3 hr",
        ingredientGroups: [{ name: "", items: [
          "30 dried corn husks",
          "1 cup vegetable shortening",
          "4 cups masa harina",
          "2 tsp baking powder",
          "1½ tsp salt",
          "3 cups warm vegetable broth",
          "4 poblano peppers, roasted, peeled, and cut into strips",
          "8 oz Oaxaca or Monterey Jack cheese, cut into sticks",
        ] }],
        stepGroups: [{ name: "", steps: [
          "Soak the corn husks in hot water for 30 minutes, until soft.",
          "Beat the shortening until fluffy, about 3 minutes.",
          "Mix in the masa harina, baking powder, and salt, then beat in the broth a little at a time until the dough is soft, like thick hummus.",
          "Spread 2 tbsp of masa on each husk, add a few poblano strips and a stick of cheese, then fold and stand them upright in a steamer.",
          "Steam, covered, for 1 hour 15 minutes, until the masa pulls away from the husk.",
        ] }],
        tags: ["tamales", "vegetarian"],
      }),
      comments: [
        comment("Lupe Garcia", "These look perfect. Did you add any salsa to the rajas?", 20),
        comment("Ana Ruiz", "Just a spoonful of salsa verde in each one.", 18),
      ],
    }),
    post({
      createdAt: ago(48),
      author: person("Sam Okafor"),
      community: "weeknight",
      kind: "recipe",
      caption: "One pan, no boiling. My kids ask for this every week.",
      likes: 31,
      recipe: recipe({
        title: "Sheet-Pan Gnocchi with Sausage",
        author: "Sam Okafor",
        yield: "4 servings",
        totalTime: "30 min",
        ingredientGroups: [{ name: "", items: [
          "1 lb shelf-stable potato gnocchi",
          "1 lb Italian sausage links, cut into 1-inch pieces",
          "2 bell peppers, cut into strips",
          "1 red onion, cut into wedges",
          "2 tbsp olive oil",
          "1 tsp dried oregano",
          "½ tsp salt",
          "¼ cup grated parmesan",
        ] }],
        stepGroups: [{ name: "", steps: [
          "Heat the oven to 450°F.",
          "Toss the gnocchi (straight from the package), sausage, peppers, and onion with the olive oil, oregano, and salt on a sheet pan.",
          "Spread everything out in one layer so it browns instead of steaming.",
          "Roast for 20 minutes, stirring halfway, until the gnocchi are crisp and the sausage is cooked through.",
          "Sprinkle with the parmesan before serving.",
        ] }],
        tags: ["sheet pan", "weeknight"],
      }),
      comments: [comment("Marcus Bell", "Doing this tonight.", 40)],
    }),
    post({
      createdAt: ago(72),
      author: person("Lupe Garcia"),
      community: "tamales",
      kind: "recipe",
      caption: "Masa spreading party at my place Saturday. Here's the filling I'm making, enough for 4 dozen.",
      likes: 14,
      recipe: recipe({
        title: "Red Chile Pork Filling",
        author: "Lupe Garcia",
        yield: "Enough for 48 tamales",
        totalTime: "2 hr 30 min",
        ingredientGroups: [{ name: "", items: [
          "3 lb pork shoulder, cut into 3 pieces",
          "1 onion, halved",
          "4 garlic cloves",
          "2 tsp salt",
          "8 dried guajillo chiles, stemmed and seeded",
          "2 dried ancho chiles, stemmed and seeded",
          "1 tsp ground cumin",
          "1 tsp dried Mexican oregano",
        ] }],
        stepGroups: [{ name: "", steps: [
          "Cover the pork, onion, 2 garlic cloves, and salt with water in a large pot. Simmer, partly covered, for 2 hours, until the pork is tender.",
          "Toast the chiles in a dry pan for about 30 seconds per side, then soak them in hot water for 20 minutes.",
          "Blend the chiles with 1 cup of the pork broth, the remaining garlic, the cumin, and the oregano until smooth. Strain the sauce.",
          "Shred the pork, then simmer it in the chile sauce for 15 minutes, until thick.",
          "Save the leftover broth for the masa.",
        ] }],
        tags: ["tamales", "pork"],
      }),
      comments: [comment("Ana Ruiz", "I'll be there with the cheese tamales!", 60)],
    }),
  ];
}
