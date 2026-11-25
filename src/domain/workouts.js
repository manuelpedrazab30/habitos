import { addDays, weekday, WEEKDAYS } from './dates.js';

// Rutinas divididas en sesiones y sobrecarga progresiva.
//
// habit.sessions = [{ id, name, exercises: [{ id, name, sets, reps, repsMax, weight, unit }] }]
//   reps–repsMax = rango objetivo por serie (repsMax null = un solo número); unit 'kg' | 'lb'.
//   Una plantilla por día de entrenamiento de la semana: tantas como veces por semana
//   (semanal N → "Día A, B, C…" en rotación; días concretos → una por día; diario → 7).
//   [] = el hábito no tiene rutina.
// state.workouts[habitId]['YYYY-MM-DD'] = { sessionId, items: [{ exerciseId, name, sets, reps, weight, unit }] }
//   una sesión por día; guardarla también marca el día como hecho.
//   weight null = peso corporal / sin carga (no entra en las estadísticas de peso).
//   Pesos con decimales; cada registro guarda su unidad (sin unidad = kg). La unidad de un
//   ejercicio es la de su plantilla (exerciseUnit); las estadísticas convierten a ella los
//   registros en la otra. Cambiarla en la hoja de la sesión más reciente cambia la plantilla
//   (store.setWorkout → withUnits).
//
// Identidad de un ejercicio: su id o, si no coincide, su nombre normalizado. Así la misma
// "Sentadilla" en dos sesiones comparte historial y progresión.
//
// La estadística clave es el PESO. Regla de "doble progresión": cuando completas las reps
// del plan (el tope del rango si lo hay) con un peso, toca subir weightStep(unidad).

export const WEIGHT_STEP = 2.5; // kg
export const LB_STEP = 5; // lb
export const UNITS = ['kg', 'lb'];
const KG_LB = 2.20462;
export const normUnit = (u) => (u === 'lb' ? 'lb' : 'kg');
export const weightStep = (unit) => (normUnit(unit) === 'lb' ? LB_STEP : WEIGHT_STEP);
/** Convierte sin redondear (para comparar). */
export const toKg = (w, unit) => (normUnit(unit) === 'lb' ? w / KG_LB : w);
/** Convierte entre kg y lb, redondeado a 0,1 (para mostrar). */
export function convertWeight(w, from, to) {
  if (w === null || w === undefined || normUnit(from) === normUnit(to)) return w;
  const v = normUnit(to) === 'lb' ? w * KG_LB : w / KG_LB;
  return Math.round(v * 10) / 10;
}

/** Número con coma o punto decimal: "62,5", "62.5", "1.234,5" → número (o null). */
export function parseNumber(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = String(v).trim().replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Peso para un campo de texto: 62.5 → "62,5". */
export const weightText = (w) => (w === null || w === undefined ? '' : String(w).replace('.', ','));

/** "8-10", "8–10", "8 a 10" → { reps: 8, repsMax: 10 }; "8" → { reps: 8, repsMax: null }. */
export function parseReps(v) {
  const nums = String(v ?? '').match(/\d+/g)?.map(Number).filter((n) => n > 0) || [];
  if (!nums.length) return { reps: null, repsMax: null };
  const [a, b] = nums;
  if (!b || b === a) return { reps: a, repsMax: null };
  return { reps: Math.min(a, b), repsMax: Math.max(a, b) };
}

/** { reps: 8, repsMax: 10 } → "8–10"; sin rango → "8". */
export const repsText = ({ reps, repsMax } = {}, sep = '–') => (reps ? (repsMax ? `${reps}${sep}${repsMax}` : String(reps)) : '');
export const STALL_SESSIONS = 4; // sesiones seguidas sin subir peso = estancado
export const PR_XP = 15; // XP por cada récord de peso

const LETTERS = 'ABCDEFG';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `e${Date.now()}${Math.random().toString(36).slice(2)}`);
const num = parseNumber;
const posInt = (v) => (num(v) > 0 ? Math.round(num(v)) : null);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const normName = (s) => String(s || '').trim().toLowerCase();
const exKey = (item) => normName(item.name) || item.exerciseId;
const matches = (item, ex) => item.exerciseId === ex.id || (normName(item.name) && normName(item.name) === normName(ex.name));

// ── Plantillas de sesión

/** Cuántas plantillas tiene la rutina: una por entrenamiento de la semana. */
export function sessionCount(schedule) {
  if (schedule.type === 'weekly') return schedule.times;
  if (schedule.type === 'days') return schedule.days.length;
  return 7;
}

export function defaultSessionName(schedule, i) {
  if (schedule.type === 'weekly') return `Día ${LETTERS[i]}`;
  const wd = schedule.type === 'days' ? schedule.days[i] : i;
  return cap(WEEKDAYS[wd]);
}

const DEFAULT_NAME = new RegExp(`^(Día [A-G]|${WEEKDAYS.map(cap).join('|')})$`);
export const isDefaultSessionName = (name) => !name || DEFAULT_NAME.test(name);

export function normalizeRoutine(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && String(e.name || '').trim())
    .map((e) => {
      const reps = posInt(e.reps);
      const max = posInt(e.repsMax);
      return { id: e.id || uid(), name: String(e.name).trim(), sets: posInt(e.sets), reps, repsMax: reps && max > reps ? max : null, weight: num(e.weight), unit: normUnit(e.unit) };
    });
}

/**
 * Ajusta las sesiones al calendario: exactamente sessionCount(schedule) plantillas
 * (rellena con vacías o recorta las últimas) y nombres por defecto donde no hay uno propio.
 * Si ninguna tiene ejercicios, el hábito no tiene rutina ([]).
 */
export function normalizeSessions(list, schedule, { keepEmpty = false } = {}) {
  let sessions = (Array.isArray(list) ? list : []).map((s) => ({
    id: s?.id || uid(),
    name: String(s?.name || '').trim(),
    exercises: normalizeRoutine(s?.exercises),
  }));
  if (!keepEmpty && !sessions.some((s) => s.exercises.length)) return [];
  const n = sessionCount(schedule);
  while (sessions.length < n) sessions.push({ id: uid(), name: '', exercises: [] });
  sessions = sessions.slice(0, n);
  sessions.forEach((s, i) => { if (isDefaultSessionName(s.name)) s.name = defaultSessionName(schedule, i); });
  return sessions;
}

/** v3 tenía una rutina única: se copia a cada sesión para no cambiar lo que el usuario veía. */
export function sessionsFromLegacyRoutine(routine, schedule) {
  const list = normalizeRoutine(routine);
  if (!list.length) return [];
  return Array.from({ length: sessionCount(schedule) }, (_, i) => ({
    name: '',
    exercises: i === 0 ? list : list.map(({ id, ...rest }) => rest), // la primera conserva los ids (historial)
  }));
}

/** Ejercicios únicos de todas las sesiones (por nombre), en orden de aparición. */
export function allExercises(habit) {
  const seen = new Set();
  const out = [];
  for (const s of habit.sessions || []) {
    for (const ex of s.exercises) {
      const k = normName(ex.name);
      if (!seen.has(k)) { seen.add(k); out.push(ex); }
    }
  }
  return out;
}

export const hasRoutine = (habit) => Boolean(habit.sessions?.some((s) => s.exercises.length));

// ── Registros de sesión

export const entryItems = (entry) => (Array.isArray(entry) ? entry : entry?.items || []);

export function normalizeSession(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i) => i && (i.exerciseId || i.name))
    .map((i) => ({ exerciseId: i.exerciseId || null, name: String(i.name || '').trim(), sets: posInt(i.sets), reps: posInt(i.reps), weight: num(i.weight), unit: normUnit(i.unit) }));
}

/** Acepta el formato v3 (array) y el actual ({ sessionId, items }). */
export function normalizeWorkoutEntry(entry) {
  if (Array.isArray(entry)) return { sessionId: null, items: normalizeSession(entry) };
  return { sessionId: entry?.sessionId || null, items: normalizeSession(entry?.items) };
}

/**
 * Qué plantilla toca un día: la registrada ese día; si no, la de ese día de la semana
 * (días concretos / diario); si no (N por semana), la siguiente a la última hecha.
 */
export function sessionFor(habit, workouts = {}, key) {
  const sessions = habit.sessions || [];
  if (!sessions.length) return null;
  const logged = sessions.find((s) => s.id === workouts[key]?.sessionId);
  if (logged) return logged;
  if (habit.schedule.type === 'days') {
    const i = habit.schedule.days.indexOf(weekday(key));
    if (i >= 0) return sessions[i];
  }
  if (habit.schedule.type === 'daily') return sessions[weekday(key)] || sessions[0];
  const prev = Object.keys(workouts).filter((k) => k < key).sort().reverse();
  for (const k of prev) {
    const i = sessions.findIndex((s) => s.id === workouts[k]?.sessionId);
    if (i >= 0) return sessions[(i + 1) % sessions.length];
  }
  return sessions[0];
}

/** Registros de un ejercicio tal cual (cada uno en su unidad), de más antiguo a más reciente. */
export function rawHistory(workouts = {}, exercise) {
  const out = [];
  for (const [key, entry] of Object.entries(workouts)) {
    const it = entryItems(entry).find((i) => matches(i, exercise));
    if (it) out.push({ key, sets: it.sets, reps: it.reps, weight: it.weight ?? null, unit: normUnit(it.unit) });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Unidad en la que se registra y se muestra un ejercicio: la de su plantilla. */
export const exerciseUnit = (exercise) => normUnit(exercise?.unit);

/**
 * Sesiones con la unidad de cada ejercicio registrado en `items` (por nombre, en todas las
 * sesiones). Devuelve las mismas sesiones si no cambia nada.
 */
export function withUnits(sessions = [], items = []) {
  const units = new Map(items.filter((i) => normName(i.name)).map((i) => [normName(i.name), normUnit(i.unit)]));
  let changed = false;
  const next = sessions.map((s) => ({
    ...s,
    exercises: s.exercises.map((ex) => {
      const u = units.get(normName(ex.name));
      if (!u || u === normUnit(ex.unit)) return ex;
      changed = true;
      return { ...ex, unit: u };
    }),
  }));
  return changed ? next : sessions;
}

/** Historial de un ejercicio en todas las sesiones, con los pesos pasados a `unit`. */
export function exerciseHistory(workouts = {}, exercise, unit = exerciseUnit(exercise)) {
  return rawHistory(workouts, exercise).map((h) => ({ ...h, weight: convertWeight(h.weight, h.unit, unit), unit }));
}

/** Mejor peso de cada ejercicio, en kg: { [nombre normalizado]: kg }. */
export function bestWeights(workouts = {}) {
  const best = {};
  for (const entry of Object.values(workouts)) {
    for (const i of entryItems(entry)) {
      const k = exKey(i);
      if (i.weight === null || i.weight === undefined) continue;
      const w = toKg(i.weight, i.unit);
      if (!(best[k] >= w)) best[k] = w;
    }
  }
  return best;
}

/** Récords de peso batidos (sin contar la primera vez de cada ejercicio, que no supera nada). */
export function prCount(workouts = {}) {
  let count = 0;
  const best = {};
  for (const key of Object.keys(workouts).sort()) {
    for (const i of entryItems(workouts[key])) {
      if (i.weight === null || i.weight === undefined) continue;
      const k = exKey(i);
      const w = toKg(i.weight, i.unit);
      if (k in best && w > best[k] + 1e-9) count++;
      if (!(best[k] >= w)) best[k] = w;
    }
  }
  return count;
}

/**
 * Estado de sobrecarga de un ejercicio.
 * - change / changePct: desde la primera sesión con peso
 * - change4w: frente a la última sesión de hace ≥ 28 días
 * - atWeight: sesiones seguidas con el peso actual; stalled si ≥ STALL_SESSIONS
 * - suggestion: peso a probar la próxima vez si en la última sesión llegaste a las reps del plan
 *   (al tope del rango, si es un rango)
 * Todos los pesos en `unit` (la del último registro) y `step` el salto de esa unidad.
 */
export function exerciseStats(exercise, workouts = {}, today) {
  const unit = exerciseUnit(exercise);
  const step = weightStep(unit);
  const history = exerciseHistory(workouts, exercise, unit).filter((h) => h.weight !== null);
  if (!history.length) return { exercise, count: 0, history, unit, step };
  const first = history[0];
  const last = history[history.length - 1];
  const best = Math.max(...history.map((h) => h.weight));

  let atWeight = 0;
  for (let i = history.length - 1; i >= 0 && history[i].weight === last.weight; i--) atWeight++;

  const cutoff = addDays(today, -28);
  const ref = [...history].reverse().find((h) => h.key <= cutoff);
  const target = exercise.repsMax || exercise.reps;
  const readyToIncrease = Boolean(target && last.reps && last.reps >= target);

  return {
    exercise,
    unit,
    step,
    target,
    count: history.length,
    history,
    first,
    last,
    best,
    isPR: history.length > 1 && last.weight === best && history.slice(0, -1).every((h) => h.weight < best),
    change: last.weight - first.weight,
    changePct: first.weight ? (last.weight - first.weight) / first.weight : null,
    change4w: ref ? last.weight - ref.weight : null,
    atWeight,
    stalled: atWeight >= STALL_SESSIONS,
    readyToIncrease,
    suggestion: readyToIncrease ? Math.round((last.weight + step) * 100) / 100 : null,
  };
}

/**
 * Valores iniciales de la hoja para los ejercicios de una plantilla: lo registrado ese día
 * (si es esa misma plantilla), si no la última vez que hiciste cada ejercicio (en cualquier
 * sesión), y si nunca, el plan.
 */
export function prefillSession(exercises, workouts = {}, key, sessionId = null) {
  const existing = workouts[key];
  const sameSession = existing && (!sessionId || !existing.sessionId || existing.sessionId === sessionId);
  const items = sameSession ? entryItems(existing) : [];
  return exercises.map((ex) => {
    const today = items.find((i) => matches(i, ex));
    if (today) return { ...today, unit: normUnit(today.unit), exerciseId: ex.id, name: ex.name, done: true };
    const unit = exerciseUnit(ex);
    const prev = exerciseHistory(workouts, ex, unit).filter((h) => h.key < key).pop(); // en la unidad del plan
    const base = prev || ex;
    return { exerciseId: ex.id, name: ex.name, sets: base.sets ?? ex.sets, reps: base.reps ?? ex.reps, weight: base.weight ?? ex.weight, unit, done: !items.length };
  });
}

/** "3×8 @ 60 kg", "3×8–10 @ 135 lb" */
export function setLabel({ sets, reps, repsMax, weight, unit }, fmt = String) {
  const r = repsText({ reps, repsMax });
  const sr = sets && r ? `${sets}×${r}` : r ? `${r} reps` : sets ? `${sets} series` : '';
  const w = weight === null || weight === undefined ? 'peso corporal' : `${fmt(weight)} ${normUnit(unit)}`;
  return sr ? `${sr} @ ${w}` : w;
}
