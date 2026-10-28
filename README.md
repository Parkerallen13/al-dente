# 🍝 Al Dente

Turn a recipe from anywhere into a clean, easy-to-follow card, then keep it in your own organized cookbook. Runs on your computer at `http://localhost:3000`.

**Sources it handles**

| Source | How to add it |
| --- | --- |
| Recipe websites and blogs | **Link** tab: paste the URL |
| Instagram, TikTok, YouTube, Pinterest posts | **Link** tab. If the site blocks it, paste the caption or upload a screenshot |
| Cookbook pages, recipe cards, handwritten notes, screenshots | **Photo / PDF** tab. Add several photos for recipes that span pages |
| Emails, texts, notes | **Paste text** tab |

**What you get**

- Ingredients you can check off, with ½× / 1× / 2× / 3× scaling
- Numbered steps you tap to mark done, with the next step highlighted
- **Cook mode**, which uses larger text and keeps the screen awake
- Categories you can create, rename and delete, plus favorites and search
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

Photos, PDFs, pasted text, social posts and websites without that data are read by Claude (`claude-opus-5-5`). For those, get an API key at [console.anthropic.com](https://console.anthropic.com/), put it in `.env` as `ANTHROPIC_API_KEY=...`, and restart.

## Where your recipes are stored

Everything is saved in `data/recipes.json` inside this folder. Back up that file to back up your cookbook. Git ignores it, so your recipes stay out of the repo.

## Project layout

```
server.js          Express server and REST API
lib/extract.js     Turns links, photos and text into recipes (JSON-LD parsing, then Claude)
lib/storage.js     Reads and writes data/recipes.json
public/            The web app (plain HTML, CSS and JS, no build step)
```

`npm run dev` restarts the server automatically when you edit files.
