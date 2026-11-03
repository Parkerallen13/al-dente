// Al Dente wireframe: switches screens and fakes a few interactions.
// Nothing is saved and there is no real AI. Every result is mock data.

// Used to fill in the recipe name on shared screens like "Saved to Library".
const RECIPES = {
  burrito: { title: 'Copycat Chipotle Burrito Bowl', source: 'From Instagram · @weeknightbowls' },
  tamales: { title: "Grandma's Tamales", source: 'From a photo of a handwritten card + voice memo' },
  lemon: { title: 'Lemon Ricotta Pasta', source: 'From smallkitchen.blog' },
  chili: { title: "Dad's Weeknight Chili", source: 'From a voice memo · 2:14' },
  banana: { title: 'Brown Butter Banana Bread', source: 'From bakewell.blog' },
};

const app = document.getElementById('app');
const menu = document.getElementById('screens-menu');
const menuToggle = menu.querySelector('.screens-toggle');

// recipe: the recipe the current flow is about
// then:   where the Saving screen goes when it finishes
// pick:   preselect the current recipe on Send recipes
// count:  how many recipes are selected to send
// posted: the recipe you shared to the community feed, once you post it
const state = { recipe: 'burrito', then: null, pick: false, count: 2, posted: null };
let savingTimer;

const plural = (n) => `${n} recipe${n === 1 ? '' : 's'}`;
const clock = (secs) => {
  const h = Math.floor(secs / 3600);
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
};

// ---------- Screens ----------

function show(id) {
  const screen = document.getElementById(id);
  if (!screen || !screen.classList.contains('screen')) {
    if (id !== 'welcome') show('welcome');
    return;
  }

  app.querySelectorAll('.screen.is-current').forEach((s) => s.classList.remove('is-current'));
  screen.classList.add('is-current');
  screen.querySelectorAll('.scroll').forEach((el) => { el.scrollTop = 0; });
  fill(screen);

  document.title = `${screen.dataset.label} · Al Dente wireframe`;
  menu.querySelectorAll('a[href^="#"]').forEach((a) => a.classList.toggle('is-current', a.hash === `#${id}`));

  clearTimeout(savingTimer);
  if (id === 'saving' && state.then) {
    const next = state.then;
    state.then = null;
    savingTimer = setTimeout(() => { location.hash = next; }, 2000);
  }

  if (id === 'send') {
    if (state.pick) {
      screen.querySelectorAll('input[name="send"]').forEach((box) => { box.checked = box.value === state.recipe; });
      state.pick = false;
    }
    countSelected(screen);
  }

  if (id === 'community') {
    if (state.posted) fill(screen.querySelector('[data-new-post]'), state.posted);
    filterPosts(screen, screen.querySelector('[data-community].is-active').dataset.community);
  }

  if (screen.querySelector('.cook-page')) setPage(screen, 0);
  screen.querySelector('.book')?.classList.remove('is-flipped');
}

// Swap in the current recipe and selection count on screens that several flows share.
function fill(screen, key = state.recipe) {
  const recipe = RECIPES[key];
  screen.querySelectorAll('[data-bind]').forEach((el) => { el.textContent = recipe[el.dataset.bind]; });
  screen.querySelectorAll('[data-to]').forEach((el) => { el.setAttribute('href', `#${el.dataset.to.replace('{r}', key)}`); });
  screen.querySelectorAll('[data-count]').forEach((el) => { el.textContent = plural(state.count); });
}

function route() {
  show(location.hash.slice(1) || 'welcome');
}

// ---------- Send recipes ----------

function countSelected(screen) {
  state.count = screen.querySelectorAll('input[name="send"]:checked').length;
  screen.querySelector('[data-count-label]').textContent = `${plural(state.count)} selected`;
  screen.querySelector('[data-send-next]').classList.toggle('is-disabled', state.count === 0);
}

// ---------- Cook mode ----------

function setPage(screen, index) {
  const pages = [...screen.querySelectorAll('.cook-page')];
  pages.forEach((page, i) => { page.hidden = i !== index; });
  screen.querySelector('[data-page-label]').textContent = pages[index].dataset.label;
  screen.querySelector('[data-page-prev]').classList.toggle('is-disabled', index === 0);
  screen.querySelector('[data-page-next]').textContent = index === pages.length - 1 ? 'Finish' : 'Next steps ›';
}

function turnPage(screen, step) {
  const pages = [...screen.querySelectorAll('.cook-page')];
  const next = pages.findIndex((page) => !page.hidden) + step;
  if (next >= pages.length) {
    location.hash = screen.querySelector('[data-done]').dataset.done;
  } else if (next >= 0) {
    setPage(screen, next);
  }
}

function addTimer(screen, label, secs) {
  const bar = screen.querySelector('.timerbar');
  const timer = document.createElement('span');
  const time = document.createElement('b');
  timer.className = 'timer';
  timer.dataset.secs = secs;
  time.textContent = clock(secs);
  timer.append(`${label} `, time);
  bar.insertBefore(timer, bar.querySelector('[data-add-timer]'));
}

// Only the timers on the screen you are looking at count down.
setInterval(() => {
  app.querySelectorAll('.screen.is-current .timer[data-secs]').forEach((timer) => {
    const secs = Math.max(0, Number(timer.dataset.secs) - 1);
    timer.dataset.secs = secs;
    timer.querySelector('b').textContent = secs ? clock(secs) : 'Done';
  });
}, 1000);

// ---------- Library ----------

function filterCards(screen, test) {
  screen.querySelectorAll('.card').forEach((card) => { card.hidden = !test(card); });
}

function setActiveChip(screen, chip) {
  screen.querySelectorAll('[data-filter], [data-community]').forEach((c) => c.classList.toggle('is-active', c === chip));
}

// ---------- Community ----------

// Your own post stays hidden until you post one.
function filterPosts(screen, community) {
  screen.querySelectorAll('.post').forEach((post) => {
    post.hidden = (community !== 'all' && post.dataset.in !== community) || ('newPost' in post.dataset && !state.posted);
  });
}

// ---------- Screens menu and frame size ----------

function setMenu(open) {
  menu.classList.toggle('is-open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
}

function setView(view) {
  document.body.dataset.view = view;
  menu.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
  try { localStorage.setItem('aldente-view', view); } catch (e) { /* storage blocked: the view just won't be remembered */ }
}

// ---------- Events ----------

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (link) {
    if (link.dataset.r) state.recipe = link.dataset.r;
    if (link.dataset.then) state.then = link.dataset.then;
    if ('pick' in link.dataset) state.pick = true;
    if ('posted' in link.dataset) state.posted = state.recipe;
    if (menu.contains(link)) setMenu(false);
    return;
  }

  const button = event.target.closest('button');
  if (!button) return;
  const screen = button.closest('.screen');
  const data = button.dataset;

  if (button === menuToggle) setMenu(!menu.classList.contains('is-open'));
  else if (data.view) setView(data.view);
  else if (data.filter) {
    setActiveChip(screen, button);
    filterCards(screen, (card) => data.filter === 'all' || card.dataset.collections.split(' ').includes(data.filter));
  } else if (data.community) {
    setActiveChip(screen, button);
    filterPosts(screen, data.community);
  } else if (data.startTimer) {
    addTimer(screen, data.label, Number(data.startTimer));
    button.disabled = true;
    button.textContent = 'Timer running';
  } else if ('addTimer' in data) addTimer(screen, 'Timer', 300);
  else if ('pageNext' in data) turnPage(screen, 1);
  else if ('pagePrev' in data) turnPage(screen, -1);
  else if ('bookNext' in data) screen.querySelector('.book').classList.add('is-flipped');
  else if ('bookPrev' in data) screen.querySelector('.book').classList.remove('is-flipped');
  else if ('selectAll' in data) {
    screen.querySelectorAll('input[name="send"]').forEach((box) => { box.checked = true; });
    countSelected(screen);
  } else if (data.pressed) {
    const label = button.textContent;
    button.textContent = data.pressed;
    data.pressed = label;
    button.classList.toggle('is-on');
  }
});

document.addEventListener('input', (event) => {
  if (!event.target.matches('[data-search]')) return;
  const screen = event.target.closest('.screen');
  const query = event.target.value.trim().toLowerCase();
  setActiveChip(screen, screen.querySelector('[data-filter="all"]'));
  filterCards(screen, (card) => card.dataset.title.includes(query));
});

document.addEventListener('change', (event) => {
  if (event.target.name === 'send') countSelected(event.target.closest('.screen'));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setMenu(false);
});

window.addEventListener('hashchange', route);

let savedView = null;
try { savedView = localStorage.getItem('aldente-view'); } catch (e) { /* storage blocked */ }
setView(['phone', 'tablet', 'full'].includes(savedView) ? savedView : 'phone');
route();
