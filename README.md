# 🍝 Al Dente

Turn a recipe from anywhere into a clean, easy-to-follow card, then keep it in your own organized cookbook. Runs on your computer at `http://localhost:3000`. On a phone you get a bottom tab bar; on a wider screen the tabs move to a sidebar. The layout follows the wireframe in `wireframe/`.

**Sources it handles**

| Source | How to add it |
| --- | --- |
| Recipe websites and blogs | **+ Add recipe → Paste a link** |
| Instagram, TikTok, YouTube, Pinterest posts | **Paste a link**. If the site blocks it, paste the caption or upload a screenshot |
| Cookbook pages, recipe cards, handwritten notes, screenshots | **Take or upload a photo**. Add several photos for recipes that span pages |
| Emails, texts, notes | **Paste text** |
| Your own recipe | **Type it manually** |
| A recipe you know by heart | **Record a voice memo**: talk it through and the browser transcribes it (Chrome, Edge or Safari) |
| No recipe yet | **Generate** (on the Recipes screen): pick a cuisine, dietary needs, time and ingredients to use up, or tap **Surprise me**, and the AI writes an original recipe |

Imported recipes open on a review screen so you can fix anything and pick a collection before saving. When the AI couldn't read or hear something clearly, like a smudged amount, it's listed there under **Please check**.

On Android, install Al Dente from Chrome's menu (**Install app**) and it appears in the Share sheet of other apps. Installing needs HTTPS or `localhost`.

**What you get**

- **First-run setup**: your name, photo and dietary needs. There's no account, and it all stays on this computer
- Steps that show the amount of each ingredient where it's first used ("Boil the rigatoni (8 oz)"), so you don't flip back to the list. On phones, **Steps** and **Ingredients** are two tabs; wider screens show both side by side
- Ingredients you can check off, with a servings stepper from ½× to 4× that scales the amounts in the steps too
- Numbered steps you tap to mark done, with the next step highlighted
- **Dietary flags**: recipes that may not fit your needs (dairy, nuts, gluten, meat, or anything you list) are marked on cards and recipe pages. The check is based on ingredient names, so it can miss things
- Ratings, **I made this**, private notes on each recipe, and a cooking history on your profile
- **Cook mode**: three large steps per page, one-tap timers for any time a step mentions, the screen kept awake, and an assistant you can type or speak questions to
- **Cookbook**: a simulator of the Al Dente e-ink kitchen device. Pair it, send recipes, and use its four buttons (or the arrow keys, Enter and Esc). **Book view** reads any recipe as book pages
- **Community**: join communities, share a recipe from your library with a caption, like and comment on posts, and save recipes from posts into your library. The sample posts come from parody celebrity chefs like Gordon Hamsay and Mary Berry-Good
- Collections you can create, rename and delete, plus favorites and search
- Light, dark, or match-your-device appearance (**Profile → Settings**)
- Four layouts to choose from in the **Layout** (☰) menu in the tab bar: Classic, Editorial, Mid-Century and Bistro. They all work the same and are black and white for now; they differ in type, shapes and motion. Bold, Journal and Zine are still styled in `public/styles.css`; add them to `LAYOUTS_OFFERED` in `public/js/core.js` to offer them again
- Editing and printing

## Setup

You need [Node.js](https://nodejs.org) 20.12 or newer.

```bash
cd al-dente
npm install
cp .env.example .env     # then paste your Anthropic API key into .env
npm start
```

Then open **http://localhost:3000**.

### The API key

Most recipe websites include structured recipe data, so Al Dente reads them directly. Those links work without a key and cost nothing.

Photos, PDFs, pasted text, voice memos, social posts and websites without that data are read by Claude (`claude-opus-5-5`). Claude also writes generated recipes and answers questions to the cook-mode assistant. For those, get an API key at [console.anthropic.com](https://console.anthropic.com/), put it in `.env` as `ANTHROPIC_API_KEY=...`, and restart.

## Where your recipes are stored

Everything is saved in `data/recipes.json` inside this folder. Back up that file to back up your cookbook. Git ignores it, so your recipes stay out of the repo.

Community posts are saved in `data/community.json`, also on this computer only. Al Dente has no accounts yet, so you're the only real poster. The feed starts with a few posts marked **Sample** so there's something to look at. Delete `data/community.json` to reset the feed to those samples.

Your profile (name, photo, dietary needs, theme, joined communities, and the cookbook simulator) is saved in `data/profile.json`. Delete it to start setup over.

## Project layout

```
server.js            Express server and REST API
lib/extract.js       Turns links, photos, text and voice memos into recipes (JSON-LD parsing, then Claude)
lib/assistant.js     Answers cook-mode questions about a recipe (Claude)
lib/storage.js       Reads and writes data/recipes.json
lib/community.js     Reads and writes data/community.json, and holds the sample posts
lib/profile.js       Reads and writes data/profile.json
public/app.js        Routes: which screen renders for each URL
public/js/           Screens, one file per area (library, recipe, cook, cookbook, community, profile) plus core.js
public/              Also the page, styles, install manifest and icons (plain HTML, CSS and JS, no build step)
wireframe/           Clickable grayscale wireframe (index.html) and a gallery of every screen
docs/versions/       Screenshots of every version so far, with a gallery page (index.html) and Figma notes
```

Colors, fonts and corner radii are tokens at the top of `public/styles.css`, so a new visual style only changes those values.

`npm run dev` restarts the server automatically when you edit files.
