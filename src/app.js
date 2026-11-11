import { createStore } from './store.js';
import { todayKey } from './domain/dates.js';
import { levelInfo, totalXp } from './domain/gamification.js';
import { computeStreak, streakLabel } from './domain/streaks.js';
import { demoState } from './demo.js';
import { bestWeights } from './domain/workouts.js';
import { fmt } from './domain/messages.js';
import { h, hideTip, toast } from './ui/dom.js';
import { todayView } from './ui/today.js';
import { habitFormView } from './ui/habitForm.js';
import { habitDetailView } from './ui/habitDetail.js';
import { progressView } from './ui/progress.js';
import { settingsView } from './ui/settings.js';

// Arranque, router por hash y feedback de gamificación.
// Cada cambio en el store vuelve a renderizar la vista activa entera (las vistas son
// funciones puras state → DOM); el estado efímero de UI vive en ctx.ui.

const store = createStore();
const main = document.getElementById('view');
const header = document.getElementById('level');

const ctx = {
  store,
  ui: { day: null, range: '3m', lineRange: '3m', editKey: null },
  today: () => todayKey(),
  go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  },
  rerender: () => render(),
  loadDemo() {
    store.importJson(JSON.stringify(demoState(todayKey())));
    toast('Datos de ejemplo cargados. Bórralos en Ajustes cuando quieras.', { timeout: 5000 });
  },

  /** Registrar un valor con feedback (XP, récords, nivel, deshacer). Todo registro pasa por aquí. */
  logEntry(habit, key, value) {
    withFeedback(habit, () => store.setEntry(habit.id, key, value));
  },

  /** Guardar una sesión de entrenamiento (marca el día como hecho) con el mismo feedback. */
  logWorkout(habit, key, items) {
    withFeedback(habit, () => store.setWorkout(habit.id, key, items), { saved: 'Sesión guardada' });
  },
};

function withFeedback(habit, mutate, { saved = null } = {}) {
  const today = todayKey();
  const before = store.get();
  const xpBefore = totalXp(before, today);
  const streakBefore = computeStreak(habit, before.entries[habit.id], today);
  const bestBefore = bestWeights(before.workouts?.[habit.id]);
  mutate();
  const after = store.get();
  const xpAfter = totalXp(after, today);
  const streakAfter = computeStreak(habit, after.entries[habit.id], today);
  const bestAfter = bestWeights(after.workouts?.[habit.id]);
  const gained = xpAfter - xpBefore;
  const lvAfter = levelInfo(xpAfter).level;
  const undo = { action: 'Deshacer', onAction: () => store.undo() };
  // Récords de peso nuevos (no cuenta la primera vez que se registra un ejercicio)
  const prs = (habit.routine || []).filter((ex) => ex.id in bestBefore && bestAfter[ex.id] > bestBefore[ex.id]);

  if (gained > 0) {
    celebrate(habit.id);
    if (lvAfter > levelInfo(xpBefore).level) {
      toast(`Nivel ${lvAfter} alcanzado`, { tone: 'level', timeout: 4500 });
    } else if (prs.length) {
      toast(`Récord de peso: ${prs.map((ex) => `${ex.name} ${fmt(bestAfter[ex.id])} kg`).join(', ')} (+${gained} XP)`, { tone: 'good', timeout: 5000, ...undo });
    } else if (streakAfter.best > streakBefore.best && streakAfter.best > 1) {
      toast(`Nuevo récord en ${habit.name}: ${streakLabel(streakAfter.best, streakAfter.unit)} (+${gained} XP)`, { tone: 'good', ...undo });
    } else {
      toast(`+${gained} XP · ${habit.emoji} ${habit.name}`, { tone: 'good', ...undo });
    }
  } else if (gained < 0) {
    toast(`${habit.emoji} ${habit.name}: registro quitado (${gained} XP)`, undo);
  } else if (saved) {
    toast(saved, undo);
  }
}

function celebrate(habitId) {
  requestAnimationFrame(() => {
    document.querySelectorAll(`[data-habit="${habitId}"]`).forEach((el) => {
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    });
  });
}

const routes = [
  [/^#\/?$/, (st) => todayView(st, ctx)],
  [/^#\/progreso$/, (st) => progressView(st, ctx)],
  [/^#\/nuevo$/, (st, m, params) => habitFormView(st, ctx, null, params)],
  [/^#\/editar\/([^/?]+)$/, (st, m, params) => habitFormView(st, ctx, m[1], params)],
  [/^#\/habito\/([^/?]+)$/, (st, m) => habitDetailView(st, ctx, m[1])],
  [/^#\/ajustes$/, (st) => settingsView(st, ctx)],
];

function render() {
  hideTip();
  const state = store.get();
  const [path, query = ''] = (location.hash || '#/').split('?');
  const params = new URLSearchParams(query);
  const route = routes.find(([re]) => re.test(path)) || routes[0];
  const scrollY = window.scrollY;
  main.replaceChildren(route[1](state, path.match(route[0]), params));
  window.scrollTo(0, scrollY);
  renderHeader(state);
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === path || (path === '#' && a.getAttribute('href') === '#/')));
}

function renderHeader(state) {
  const lv = levelInfo(totalXp(state, todayKey()));
  header.replaceChildren(
    h('a', { href: '#/progreso', class: 'level-chip', title: `${lv.xp} XP · faltan ${lv.toNext} para el nivel ${lv.level + 1}` },
      h('span', { class: 'lvl' }, `Nv ${lv.level}`),
      h('span', { class: 'bar' }, h('span', { style: { width: `${(lv.into / lv.span) * 100}%` } })),
    ),
  );
}

// Formularios: no re-renderizar mientras el usuario escribe en uno
store.subscribe(() => {
  if (main.querySelector('form.habit-form')) return renderHeader(store.get());
  render();
});
window.addEventListener('hashchange', () => {
  ctx.ui.editKey = null;
  render();
  window.scrollTo(0, 0);
});

// Si la app queda abierta pasada la medianoche, "hoy" cambia
let lastDay = todayKey();
setInterval(() => {
  if (todayKey() !== lastDay) {
    lastDay = todayKey();
    ctx.ui.day = null;
    render();
  }
}, 60_000);

// Las gráficas se dibujan al ancho real (ui/charts.js chartWidth): re-render al girar/redimensionar
let lastWidth = window.innerWidth;
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (window.innerWidth === lastWidth || main.querySelector('form.habit-form')) return;
    lastWidth = window.innerWidth;
    render();
  }, 200);
});

// Tooltips en táctil: se cierran al desplazar o tocar fuera de una gráfica
window.addEventListener('scroll', hideTip, { passive: true });
document.addEventListener('touchstart', (e) => { if (!e.target.closest('svg')) hideTip(); }, { passive: true });

// PWA: uso sin conexión una vez instalada. Solo en HTTPS real; en localhost no, para no
// servir código cacheado mientras se desarrolla.
if ('serviceWorker' in navigator && window.isSecureContext && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker no registrado', e));
}

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'n') ctx.go('#/nuevo');
  if (e.key === 'h') ctx.go('#/');
  if (e.key === 'p') ctx.go('#/progreso');
});

render();
