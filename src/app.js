import { createStore } from './store.js';
import { todayKey } from './domain/dates.js';
import { levelInfo, totalXp } from './domain/gamification.js';
import { computeStreak, streakLabel } from './domain/streaks.js';
import { demoState } from './demo.js';
import { allExercises, bestWeights, normName } from './domain/workouts.js';
import { fmt } from './domain/messages.js';
import { isDone } from './domain/habits.js';
import { h, hideTip, toast } from './ui/dom.js';
import { confetti } from './ui/confetti.js';
import { initTheme } from './ui/theme.js';
import { backupOverdue, requestPersistentStorage } from './backup.js';
import { todayView } from './ui/today.js';
import { habitFormView } from './ui/habitForm.js';
import { habitDetailView } from './ui/habitDetail.js';
import { progressView } from './ui/progress.js';
import { settingsView } from './ui/settings.js';
import { financeOverviewView } from './ui/finance/overview.js';
import { transactionsView } from './ui/finance/transactions.js';
import { accountsView } from './ui/finance/accounts.js';
import { openEntrySheet } from './ui/finance/entrySheet.js';
import { demoFinance } from './demo.js';
import { homeView } from './ui/home.js';
import { inboxOverviewView } from './ui/inbox/overview.js';
import { inboxListView } from './ui/inbox/list.js';
import { inboxConnectView } from './ui/inbox/connect.js';
import { handleOAuthRedirect } from './inbox/gmail.js';
import { inboxBusy, refreshInbox, runAi, saveInboxConfig } from './inbox/state.js';

// Arranque, router por hash y feedback de gamificación.
// Cada cambio en el store vuelve a renderizar la vista activa entera (las vistas son
// funciones puras state → DOM); el estado efímero de UI vive en ctx.ui.

const store = createStore();
const main = document.getElementById('view');
const header = document.getElementById('level');
const nav = document.getElementById('nav');
const sections = document.getElementById('sections');
const SECTION_KEY = 'panel.section';

const ctx = {
  store,
  ui: { day: null, range: '3m', lineRange: '3m', editKey: null, month: null, txFilter: null },
  today: () => todayKey(),
  go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  },
  rerender: () => render(),
  loadDemo() {
    // Solo hábitos: conserva las finanzas que ya hubiera
    store.importJson(JSON.stringify({ ...demoState(todayKey()), finance: store.get().finance }));
    toast('Datos de ejemplo cargados. Bórralos en Ajustes cuando quieras.', { timeout: 5000 });
  },
  loadFinanceDemo() {
    store.setFinance(demoFinance(todayKey()));
    toast('Finanzas de ejemplo cargadas. Bórralas en Cuentas cuando quieras.', { timeout: 5000 });
  },

  /** Finanzas: guarda un `finance` nuevo (de las funciones puras) con aviso y "Deshacer". */
  saveFinance(next, message) {
    store.setFinance(next);
    if (message) toast(message, { tone: 'good', action: 'Deshacer', onAction: () => store.undo() });
  },
  /** Hoja de registro rápido. opts: { type, tx } (tx = editar un movimiento). */
  /** Correo: leer la bandeja (Gmail o ejemplo) y, si hay clave, pedir el resumen con IA. */
  refreshInbox() {
    const st = store.get();
    return refreshInbox({ finance: st.finance, currency: st.finance.currency, onChange: () => render() });
  },
  runInboxAi() {
    const st = store.get();
    return runAi({ finance: st.finance, currency: st.finance.currency, onChange: () => render() });
  },
  openEntry(opts = {}) {
    openEntrySheet(ctx, opts);
  },

  /** Registrar un valor con feedback (XP, récords, nivel, deshacer). Todo registro pasa por aquí. */
  logEntry(habit, key, value) {
    withFeedback(habit, key, () => store.setEntry(habit.id, key, value));
  },

  /** Guardar una sesión de entrenamiento (marca el día como hecho) con el mismo feedback. */
  logWorkout(habit, key, items, sessionId) {
    withFeedback(habit, key, () => store.setWorkout(habit.id, key, items, sessionId), { saved: 'Sesión guardada' });
  },
};

function withFeedback(habit, key, mutate, { saved = null } = {}) {
  const today = todayKey();
  const before = store.get();
  const doneBefore = isDone(habit, before.entries[habit.id]?.[key]);
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
  const prs = allExercises(habit).filter((ex) => {
    const k = normName(ex.name);
    return k in bestBefore && bestAfter[k] > bestBefore[k];
  });

  // Confeti solo cuando el día pasa de no cumplido a cumplido (no al subir un contador
  // ya cumplido ni al editar una medición existente).
  if (!doneBefore && isDone(habit, after.entries[habit.id]?.[key])) {
    requestAnimationFrame(() => confetti({ origin: document.querySelector(`[data-habit="${habit.id}"]`), color: habit.color }));
  }

  if (gained > 0) {
    celebrate(habit.id);
    if (lvAfter > levelInfo(xpBefore).level) {
      toast(`Nivel ${lvAfter} alcanzado`, { tone: 'level', timeout: 4500 });
    } else if (prs.length) {
      toast(`Récord de peso: ${prs.map((ex) => `${ex.name} ${fmt(bestAfter[normName(ex.name)])} kg`).join(', ')} (+${gained} XP)`, { tone: 'good', timeout: 5000, ...undo });
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
  [/^#\/inicio$/, (st) => homeView(st, ctx)],
  [/^#\/correo$/, (st) => inboxOverviewView(st, ctx)],
  [/^#\/correo\/bandeja$/, (st) => inboxListView(st, ctx)],
  [/^#\/correo\/conexion$/, (st) => inboxConnectView(st, ctx)],
  [/^#\/finanzas$/, (st) => financeOverviewView(st, ctx)],
  [/^#\/finanzas\/nuevo$/, (st) => { setTimeout(() => ctx.openEntry(), 0); return financeOverviewView(st, ctx); }],
  [/^#\/finanzas\/movimientos$/, (st) => transactionsView(st, ctx)],
  [/^#\/finanzas\/cuentas$/, (st) => accountsView(st, ctx)],
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
  renderNav(path);
}

// ── Panel: cuatro secciones (Inicio, Hábitos, Finanzas, Correo), cada una con su barra inferior.
// Elementos especiales: 'gasto' abre el registro rápido; 'refresh' actualiza el correo.
const NAVS = {
  inicio: [['#/inicio', '◉', 'Inicio'], ['#/', '◎', 'Hábitos'], ['gasto', '＋', 'Gasto', 'add'], ['#/correo', '✉', 'Correo']],
  habitos: [['#/', '◎', 'Hoy'], ['#/progreso', '▤', 'Progreso'], ['#/nuevo', '＋', 'Nuevo', 'add'], ['#/ajustes', '⚙', 'Ajustes']],
  finanzas: [['#/finanzas', '◔', 'Resumen'], ['#/finanzas/movimientos', '≡', 'Movimientos'], ['gasto', '＋', 'Gasto', 'add'], ['#/finanzas/cuentas', '▣', 'Cuentas']],
  correo: [['#/correo', '◔', 'Resumen'], ['#/correo/bandeja', '≡', 'Bandeja'], ['refresh', '↻', 'Actualizar', 'add'], ['#/correo/conexion', '⚙', 'Conexión']],
};
const SECTIONS = [['inicio', '#/inicio', 'Inicio'], ['habitos', '#/', 'Hábitos'], ['finanzas', '#/finanzas', 'Finanzas'], ['correo', '#/correo', 'Correo']];
const sectionOf = (path) => (path.startsWith('#/inicio') ? 'inicio' : path.startsWith('#/finanzas') ? 'finanzas' : path.startsWith('#/correo') ? 'correo' : 'habitos');

function renderNav(path) {
  const section = sectionOf(path);
  localStorage.setItem(SECTION_KEY, section);
  document.body.dataset.section = section;
  sections.replaceChildren(...SECTIONS.map(([id, href, label]) => h('a', { href, class: section === id ? 'on' : '' }, label)));
  const current = path === '#' || path === '' ? '#/' : path === '#/finanzas/nuevo' ? '#/finanzas' : path;
  // Punto de aviso en Ajustes cuando toca hacer copia de seguridad (src/backup.js)
  const alert = backupOverdue(store.get()) ? 'alert' : '';
  nav.replaceChildren(...NAVS[section].map(([href, icon, label, cls]) => (href === 'gasto' || href === 'refresh'
    ? h('button', {
      type: 'button', class: `nav-item ${cls || ''} ${href === 'refresh' && inboxBusy() ? 'spinning' : ''}`,
      onClick: () => (href === 'gasto' ? ctx.openEntry() : ctx.refreshInbox()),
    }, h('span', { 'aria-hidden': 'true' }, icon), href === 'refresh' && inboxBusy() ? (inboxBusy() === 'ai' ? 'Resumiendo' : 'Leyendo') : label)
    : h('a', { href, class: `nav-item ${cls || ''} ${href === current ? 'on' : ''} ${href === '#/ajustes' ? alert : ''}`, title: href === '#/ajustes' && alert ? 'Toca hacer copia de seguridad' : null }, h('span', { 'aria-hidden': 'true' }, icon), label))));
}

function renderHeader(state) {
  if (sectionOf((location.hash || '#/').split('?')[0]) !== 'habitos') {
    const overdue = backupOverdue(state);
    header.replaceChildren(h('a', { href: '#/ajustes', class: `icon-link ${overdue ? 'alert' : ''}`, 'aria-label': overdue ? 'Ajustes: toca hacer copia de seguridad' : 'Ajustes', title: overdue ? 'Toca hacer copia de seguridad' : 'Ajustes (copia de seguridad, estilo)' }, '⚙'));
    return;
  }
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
// Clase .enter durante la carga y cada cambio de ruta: los temas pueden animar la entrada
// sin repetirla en cada re-render (cada registro vuelve a pintar la vista).
function markEnter() {
  main.classList.add('enter');
  clearTimeout(markEnter.t);
  markEnter.t = setTimeout(() => main.classList.remove('enter'), 900);
}
window.addEventListener('hashchange', () => {
  ctx.ui.editKey = null;
  markEnter();
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
  if (e.key === 'f') ctx.go('#/finanzas');
  if (e.key === 'i') ctx.go('#/inicio');
  if (e.key === 'c') ctx.go('#/correo');
  if (e.key === 'g') { e.preventDefault(); ctx.openEntry(); }
});

// Al abrir la app sin ruta, vuelve a la última sección usada
// Vuelta de la pantalla de Google (Gmail): antes de pintar, para que el router no vea el token
const oauth = handleOAuthRedirect();
if (oauth?.ok) saveInboxConfig({ mode: 'gmail' });
// Al abrir la app sin ruta, vuelve a la última sección usada (la primera vez, Inicio)
if (!location.hash) {
  const last = localStorage.getItem(SECTION_KEY);
  const start = { finanzas: '#/finanzas', correo: '#/correo', habitos: '#/' }[last] || '#/inicio';
  if (start !== '#/') location.replace(start);
}
initTheme();
markEnter();
render();
// Que el navegador no borre los datos por falta de espacio (en la app instalada suele concederse)
requestPersistentStorage();
if (oauth?.ok) ctx.refreshInbox();
else if (oauth?.error) toast(oauth.error, { tone: 'bad', timeout: 6000 });
