import { createHabit } from './domain/habits.js';

// Estado único de la app, persistido en localStorage. Todo lo derivado (rachas, XP,
// niveles, estadísticas) se calcula al vuelo desde aquí y NO se guarda.
//
// state = {
//   version: 2,
//   habits: Habit[],                                  // ver domain/habits.js
//   entries: { [habitId]: { 'YYYY-MM-DD': number } }, // un valor por hábito y día
//   settings: {}
// }

export const STORAGE_KEY = 'habitos.state';
export const VERSION = 2;

const empty = () => ({ version: VERSION, habits: [], entries: {}, settings: {} });

/** Punto único para migrar datos antiguos cuando cambie el esquema (subir VERSION y añadir un paso). */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return empty();
  const s = { ...empty(), ...raw };
  // v1 → v2: los hábitos sí/no pasan de meta por número de veces (goal.total) a meta de
  // duración (goal.from + goal.deadline). createHabit() descarta `total` y fija `from`.
  s.habits = (s.habits || []).map((h) => createHabit(h));
  s.entries = s.entries && typeof s.entries === 'object' ? s.entries : {};
  s.version = VERSION;
  return s;
}

export function createStore(storage = globalThis.localStorage) {
  let state = load();
  const listeners = new Set();
  let lastUndo = null;

  function load() {
    try {
      return migrate(JSON.parse(storage?.getItem(STORAGE_KEY) || 'null'));
    } catch {
      return empty();
    }
  }

  function commit(next, undo = null) {
    state = next;
    lastUndo = undo;
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('No se pudo guardar', e);
    }
    listeners.forEach((fn) => fn(state));
  }

  const api = {
    get: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    addHabit(input) {
      const habit = createHabit(input);
      commit({ ...state, habits: [...state.habits, habit] });
      return habit;
    },

    updateHabit(id, input) {
      const prev = state.habits.find((h) => h.id === id);
      if (!prev) return;
      const habit = createHabit({ ...prev, ...input, id, createdAt: prev.createdAt });
      commit({ ...state, habits: state.habits.map((h) => (h.id === id ? habit : h)) });
    },

    setArchived(id, archived) {
      commit({ ...state, habits: state.habits.map((h) => (h.id === id ? { ...h, archived } : h)) });
    },

    deleteHabit(id) {
      const before = state;
      const entries = { ...state.entries };
      delete entries[id];
      commit({ ...state, habits: state.habits.filter((h) => h.id !== id), entries }, () => commit(before));
    },

    /** value null/undefined borra el registro del día. */
    setEntry(habitId, key, value) {
      const before = state;
      const log = { ...(state.entries[habitId] || {}) };
      if (value === null || value === undefined || Number.isNaN(value)) delete log[key];
      else log[key] = value;
      commit({ ...state, entries: { ...state.entries, [habitId]: log } }, () => commit(before));
    },

    undo() {
      const fn = lastUndo;
      lastUndo = null;
      fn?.();
    },

    exportJson: () => JSON.stringify(state, null, 2),

    importJson(text) {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed?.habits)) throw new Error('El archivo no parece una copia de esta app.');
      const before = state;
      commit(migrate(parsed), () => commit(before));
    },

    reset() {
      const before = state;
      commit(empty(), () => commit(before));
    },
  };
  return api;
}
