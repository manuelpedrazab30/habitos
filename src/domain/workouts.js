import { addDays } from './dates.js';

// Rutinas de entrenamiento y sobrecarga progresiva.
//
// habit.routine = [{ id, name, sets, reps, weight }]   plan: "Sentadilla 3×8 @ 60 kg"
// state.workouts[habitId]['YYYY-MM-DD'] = [{ exerciseId, name, sets, reps, weight }]
//   una sesión por día; guardar una sesión también marca el día como hecho.
//   weight null = peso corporal / sin carga (no entra en las estadísticas de peso).
//
// La estadística clave es el PESO por ejercicio. Regla de "doble progresión": cuando
// completas las reps del plan con un peso, toca subir WEIGHT_STEP la próxima vez.

export const WEIGHT_STEP = 2.5; // kg
export const STALL_SESSIONS = 4; // sesiones seguidas sin subir peso = estancado
export const PR_XP = 15; // XP por cada récord de peso

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `e${Date.now()}${Math.random().toString(36).slice(2)}`);

const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const posInt = (v) => (num(v) > 0 ? Math.round(num(v)) : null);

export function normalizeRoutine(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && String(e.name || '').trim())
    .map((e) => ({ id: e.id || uid(), name: String(e.name).trim(), sets: posInt(e.sets), reps: posInt(e.reps), weight: num(e.weight) }));
}

export function normalizeSession(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i) => i && i.exerciseId)
    .map((i) => ({ exerciseId: i.exerciseId, name: String(i.name || '').trim(), sets: posInt(i.sets), reps: posInt(i.reps), weight: num(i.weight) }));
}

/** Historial de un ejercicio, de más antiguo a más reciente: [{ key, sets, reps, weight }]. */
export function exerciseHistory(sessions = {}, exerciseId) {
  const out = [];
  for (const [key, items] of Object.entries(sessions)) {
    const it = items.find((i) => i.exerciseId === exerciseId);
    if (it) out.push({ key, sets: it.sets, reps: it.reps, weight: it.weight });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Mejor peso de cada ejercicio: { [exerciseId]: kg }. */
export function bestWeights(sessions = {}) {
  const best = {};
  for (const items of Object.values(sessions)) {
    for (const i of items) if (i.weight !== null && !(best[i.exerciseId] >= i.weight)) best[i.exerciseId] = i.weight;
  }
  return best;
}

/** Récords de peso batidos (sin contar la primera sesión de cada ejercicio, que no supera nada). */
export function prCount(sessions = {}) {
  let count = 0;
  const best = {};
  for (const key of Object.keys(sessions).sort()) {
    for (const i of sessions[key]) {
      if (i.weight === null) continue;
      if (i.exerciseId in best && i.weight > best[i.exerciseId]) count++;
      if (!(best[i.exerciseId] >= i.weight)) best[i.exerciseId] = i.weight;
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
 */
export function exerciseStats(exercise, sessions = {}, today) {
  const history = exerciseHistory(sessions, exercise.id).filter((h) => h.weight !== null);
  if (!history.length) return { exercise, count: 0, history };
  const first = history[0];
  const last = history[history.length - 1];
  const best = Math.max(...history.map((h) => h.weight));

  let atWeight = 0;
  for (let i = history.length - 1; i >= 0 && history[i].weight === last.weight; i--) atWeight++;

  const cutoff = addDays(today, -28);
  const ref = [...history].reverse().find((h) => h.key <= cutoff);
  const target = exercise.reps;
  const readyToIncrease = Boolean(target && last.reps && last.reps >= target);

  return {
    exercise,
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
    suggestion: readyToIncrease ? last.weight + WEIGHT_STEP : null,
  };
}

/**
 * Valores iniciales de la hoja de sesión: lo que ya registraste ese día, si no la última
 * vez que hiciste cada ejercicio, y si nunca, el plan de la rutina.
 */
export function prefillSession(routine, sessions = {}, key) {
  const existing = sessions[key];
  return routine.map((ex) => {
    const today = existing?.find((i) => i.exerciseId === ex.id);
    if (today) return { ...today, name: ex.name, done: true };
    const prev = exerciseHistory(sessions, ex.id).filter((h) => h.key < key).pop();
    const base = prev || ex;
    return { exerciseId: ex.id, name: ex.name, sets: base.sets ?? ex.sets, reps: base.reps ?? ex.reps, weight: base.weight ?? ex.weight, done: !existing };
  });
}

/** "3×8 @ 60 kg" */
export function setLabel({ sets, reps, weight }, fmt = String) {
  const sr = sets && reps ? `${sets}×${reps}` : reps ? `${reps} reps` : sets ? `${sets} series` : '';
  const w = weight === null || weight === undefined ? 'peso corporal' : `${fmt(weight)} kg`;
  return sr ? `${sr} @ ${w}` : w;
}
