# Al Dente versions

Screenshots of every version of Al Dente, for documentation and for bringing into Figma. Open `index.html` in a browser to see them all on one page.

| Folder | Version |
| --- | --- |
| `01-wireframe` | The first clickable grayscale wireframe, every screen (phone and tablet) |
| `02-first-app` | The original working app, commit `a27d712` |
| `03-color-redesign` | The app rebuilt on the wireframe layout in warm colors, commit `0c35514` |
| `04-lofi-classic` | Black-and-white lo-fi, Classic layout |
| `05-editorial` to `10-bistro` | The other lo-fi layouts from the burger menu: Editorial, Bold, Journal, Zine, Mid-Century, Bistro |

Each app version has the same screens at two sizes, using the same sample recipes:

- `phone-*.png`: 390 × 844 points, saved at 2× resolution (780 × 1688 pixels)
- `desktop-*.png`: 1440 × 900

`versions.json` lists every screenshot with its label.

## Bringing them into Figma

- **Screenshots:** drag a version's folder, or any PNG files, onto a Figma canvas. Each becomes an image. Phone screenshots come in at 2×, so scale them to 50% (390 × 844) to match a phone frame.
- **Editable layers:** to get real layers you can restyle, import a page with an HTML-to-Figma plugin (such as html.to.design). Good pages to import are `wireframe/gallery.html`, which has every wireframe screen at phone and tablet size, and the running app at `http://localhost:3000`.
