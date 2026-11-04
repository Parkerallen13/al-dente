// Community posts live in data/community.json, on this computer only. There are no
// accounts yet, so you are the only real author; a new file starts with sample posts
// (marked sample: true) so the feed has something in it. Writes use the same
// temp-file-and-rename approach as storage.js.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

// DATA_DIR points at the mounted disk in production (see fly.toml).
const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
const DB_FILE = path.join(DATA_DIR, "community.json");

export const COMMUNITIES = [
  { id: "weeknight", name: "Weeknight Cooks" },
  { id: "tamales", name: "Tamale Season" },
  { id: "baking", name: "Bread & Baking" },
];

// Bump this when the sample posts change. Older files get the new samples on load;
// posts you wrote are kept.
const SAMPLES_VERSION = 2;

let cache = null;
let writeQueue = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(DB_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    cache = { samplesVersion: SAMPLES_VERSION, posts: samplePosts() };
    await persist();
  }
  if ((cache.samplesVersion ?? 1) < SAMPLES_VERSION) {
    cache.posts = [...cache.posts.filter((p) => !p.sample), ...samplePosts()];
    cache.samplesVersion = SAMPLES_VERSION;
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

  // The sample cooks are parody celebrities, so no real person's name or words are used.
  return [
    post({
      createdAt: ago(2),
      author: person("Gordon Hamsay"),
      community: "weeknight",
      kind: "recipe",
      caption: "Third salmon this week I didn't have to shout at. Broil it for the last 2 minutes so the glaze gets sticky. If it's still raw in the middle, we need to talk.",
      likes: 247,
      recipe: recipe({
        title: "Miso Butter Salmon, Done Properly",
        author: "Gordon Hamsay",
        description: "Sweet, salty, sticky salmon in 25 minutes. Absolutely stunning. Finally.",
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
          "Heat the oven to 425°F and line a sheet pan with foil. Yes, foil. Nobody wants to scrub.",
          "Mash 3 tbsp white miso, 2 tbsp butter, 1 tbsp honey, 1 tbsp rice vinegar, and 1 tsp ginger into a smooth paste.",
          "Pat 4 salmon fillets bone dry, set them skin side down on the pan, and spread the miso butter over the tops.",
          "Bake for 10 minutes, then switch to broil for 2 minutes, until the glaze is browned in spots. Browned. Not black.",
          "Top with 2 sliced scallions and serve over rice. Beautiful.",
        ] }],
        notes: ["Dry salmon is the whole trick. Wet salmon steams, and steamed salmon makes me sad."],
        tags: ["salmon", "weeknight"],
      }),
      comments: [
        comment("Keanu Leaves", "You're breathtaking. So is this salmon.", 1.5),
        comment("Gordon Hamsay", "Cheers, Keanu. Use white miso, not red. Red gets too salty under the broiler.", 1.2),
        comment("Julia Childish", "Made it with twice the butter. I regret nothing.", 0.7),
        comment("Martha Stewpot", "Saving this for my casual Thursday dinner for 40.", 0.2),
      ],
    }),
    post({
      createdAt: ago(5),
      author: person("Martha Stewpot"),
      community: "weeknight",
      kind: "question",
      caption: "What do you make when you have 20 minutes and no energy? I usually whip up a seven-course tasting menu, but my assistant says that's \"not a weeknight thing.\"",
      likes: 89,
      comments: [
        comment("Snoop Doughnut", "Fried rice, nephew. Day-old rice, frozen peas, two eggs, soy sauce. Ten minutes, zero stress.", 4.5),
        comment("Paula Butter", "A stick of butter and a spoon. It's called self-care, y'all.", 4),
        comment("Gordon Hamsay", "Eggs on toast. Done. Stop overthinking it, Martha.", 3),
      ],
    }),
    post({
      createdAt: ago(26),
      author: person("Guy Fiery"),
      community: "tamales",
      kind: "made",
      rating: 5,
      caption: "Welcome to Flavortown, population: these tamales. Made 'em with my mom. Shortening instead of lard keeps 'em vegetarian, and they were still FLUFFY, bro.",
      likes: 132,
      recipe: recipe({
        title: "Off-the-Hook Rajas con Queso Tamales",
        author: "Guy Fiery",
        description: "Roasted poblanos and melty cheese tucked into fluffy masa. Off. The. Hook.",
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
          "Soak 30 corn husks in hot water for 30 minutes, until soft.",
          "Beat 1 cup shortening until fluffy, about 3 minutes. Fluffier than my hair. Almost.",
          "Mix in 4 cups masa harina, 2 tsp baking powder, and 1½ tsp salt, then beat in 3 cups broth a little at a time until the dough is soft, like thick hummus.",
          "Spread 2 tbsp of masa on each husk, add a few poblano strips and a stick of cheese, then fold and stand them upright in a steamer.",
          "Steam, covered, for 1 hour 15 minutes, until the masa pulls away from the husk. That's money.",
        ] }],
        tags: ["tamales", "vegetarian"],
      }),
      comments: [
        comment("Dolly Parsley", "Those look tastier than a Tennessee Sunday! Did you put salsa in the rajas, sugar?", 20),
        comment("Guy Fiery", "A spoonful of salsa verde in each one. Flavortown approved.", 18),
      ],
    }),
    post({
      createdAt: ago(48),
      author: person("Snoop Doughnut"),
      community: "weeknight",
      kind: "recipe",
      caption: "One pan, no boiling, no stress. The kids ask for this every week. Drop it like it's hot (the oven's at 450°F).",
      likes: 420,
      recipe: recipe({
        title: "Sheet-Pan Gnocchi Fo' Shizzle",
        author: "Snoop Doughnut",
        description: "Crispy gnocchi, sausage, and peppers, all on one pan. Laid back, like it should be.",
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
          "Toss 1 lb gnocchi (straight from the package), the sausage, peppers, and onion with 2 tbsp olive oil, 1 tsp oregano, and ½ tsp salt on a sheet pan.",
          "Spread everything out in one layer so it browns instead of steaming. Give it room to breathe.",
          "Roast for 20 minutes, stirring halfway, until the gnocchi are crisp and the sausage is cooked through.",
          "Sprinkle with ¼ cup parmesan and serve it up.",
        ] }],
        notes: ["Spread it out. Gnocchi need their personal space, just like me."],
        tags: ["sheet pan", "weeknight"],
      }),
      comments: [
        comment("Taylor Swiss", "I knew this gnocchi was trouble when it walked in. Making it tonight.", 40),
      ],
    }),
    post({
      createdAt: ago(72),
      author: person("Dolly Parsley"),
      community: "tamales",
      kind: "recipe",
      caption: "Working 9 to 5 on a masa spreading party this Saturday! Here's my filling, enough for 4 dozen. Bring your own husks, darlin'.",
      likes: 95,
      recipe: recipe({
        title: "Red Chile Pork Filling (Worth Every Minute)",
        author: "Dolly Parsley",
        description: "Slow-simmered pork in a smoky guajillo sauce. It takes a while, and so does anything good.",
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
          "Cover 3 lb pork, the onion, 2 of the garlic cloves, and 2 tsp salt with water in a large pot. Simmer, partly covered, for 2 hours, until the pork is tender.",
          "Toast the chiles in a dry pan for about 30 seconds per side, then soak them in hot water for 20 minutes.",
          "Blend the chiles with 1 cup of the pork broth, the other 2 garlic cloves, 1 tsp cumin, and 1 tsp oregano until smooth. Strain the sauce.",
          "Shred the pork, then simmer it in the chile sauce for 15 minutes, until thick.",
          "Save the leftover broth for the masa.",
        ] }],
        notes: ["Waste not, want not. That leftover broth makes the best masa in the county."],
        tags: ["tamales", "pork"],
      }),
      comments: [comment("Guy Fiery", "I'll be there with the cheese tamales! Flavortown's coming to you.", 60)],
    }),
    post({
      createdAt: ago(96),
      author: person("Mary Berry-Good"),
      community: "baking",
      kind: "recipe",
      caption: "A proper bake with a proper bottom. If yours comes out soggy, I'll know. I always know.",
      likes: 156,
      recipe: recipe({
        title: "No-Soggy-Bottom Banana Bread",
        author: "Mary Berry-Good",
        description: "Moist inside, golden outside, and absolutely no soggy bottom.",
        yield: "1 loaf",
        totalTime: "1 hr 10 min",
        ingredientGroups: [{ name: "", items: [
          "½ cup butter, melted",
          "3 very ripe bananas",
          "⅔ cup brown sugar",
          "2 eggs",
          "1 tsp vanilla",
          "1¾ cups flour",
          "1 tsp baking soda",
          "½ tsp salt",
        ] }],
        stepGroups: [{ name: "", steps: [
          "Heat the oven to 350°F and grease a loaf pan. Properly. Into the corners.",
          "Mash 3 bananas, then whisk in ½ cup melted butter, ⅔ cup brown sugar, 2 eggs, and 1 tsp vanilla.",
          "Fold in 1¾ cups flour, 1 tsp baking soda, and ½ tsp salt until just combined. Lumps are fine. Overmixing is not.",
          "Pour into the pan and bake for 55 minutes, until a skewer comes out clean.",
          "Cool in the pan for 10 minutes, then turn it out onto a rack so the bottom doesn't steam.",
        ] }],
        notes: ["The rack at the end is what saves the bottom. Don't skip it."],
        tags: ["baking", "banana bread"],
      }),
      comments: [
        comment("Paula Butter", "I'd add another stick of butter, but that's just me, honey.", 90),
        comment("Mary Berry-Good", "It's always just you, Paula.", 88),
      ],
    }),
  ];
}
