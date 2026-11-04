// The burger menu in the tab bar: switch between the layouts. They all work the
// same; they differ in personality and how much motion they use.
import { state, saveProfile, esc, toast, LAYOUTS_OFFERED } from "./core.js";

const LAYOUTS = [
  { id: "classic", name: "Classic", risk: "Safe", about: "Calm and familiar: a photo grid, rounded tabs, no motion." },
  { id: "editorial", name: "Editorial", risk: "Some risk", about: "Magazine type, numbered recipe lists, thin rules, and soft page transitions." },
  { id: "bold", name: "Bold", risk: "Most risk", about: "Heavy type, hard shadows, a floating tab dock, and springy animations." },
  { id: "journal", name: "Journal", risk: "Eclectic", about: "Lifestyle-magazine feel: fashion serifs, a mixed-size mosaic, pull quotes, and slow fades." },
  { id: "zine", name: "Zine", risk: "Wild", about: "Bold's outlines, shadows and floating dock with Journal's fashion serifs, mosaic and pull quotes." },
  { id: "midcentury", name: "Mid-Century", risk: "Retro", about: "Americana diner signage: starbursts, ringed buttons, ticket-stub cards, and a jaunty swing." },
  { id: "bistro", name: "Bistro", risk: "Playful", about: "A boutique French café: script menus, a striped awning, a chalkboard cook mode, and little wiggles." },
];

export function wireLayoutMenu() {
  const button = document.querySelector(".burger");
  const menu = document.getElementById("layout-menu");

  const offered = LAYOUTS.filter((l) => LAYOUTS_OFFERED.includes(l.id));
  const draw = () => {
    const current = document.documentElement.dataset.layout;
    menu.innerHTML = `<p class="label">Layout</p>
      ${offered.map((l) => `<button class="layout-pick ${l.id === current ? "is-active" : ""}" type="button" data-layout-pick="${l.id}" aria-pressed="${l.id === current}">
        <span class="layout-sample layout-sample-${l.id}" aria-hidden="true">Aa</span>
        <span class="row-text grow"><span class="row-title">${esc(l.name)} <span class="pill">${esc(l.risk)}</span></span><span class="small muted">${esc(l.about)}</span></span>
      </button>`).join("")}`;
  };
  const setOpen = (open) => {
    if (open) draw();
    menu.hidden = !open;
    button.setAttribute("aria-expanded", open);
    button.classList.toggle("is-open", open);
  };

  button.addEventListener("click", () => setOpen(menu.hidden));
  menu.addEventListener("click", async (e) => {
    const id = e.target.closest("[data-layout-pick]")?.dataset.layoutPick;
    if (!id) return;
    setOpen(false);
    await saveProfile({ layout: id });
    toast(`Layout: ${LAYOUTS.find((l) => l.id === id).name}`);
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !button.contains(e.target)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) setOpen(false);
  });
}
