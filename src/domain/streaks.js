import { addDays, dateRange, minKey, weekStart } from './dates.js';
import { isDone, isScheduled } from './habits.js';

/** Primer día relevante: creación del hábito o el registro más antiguo (se puede rellenar hacia atrás). */
export function habitStart(habit, log = {}) {
  let start = habit.createdAt;
  for (const k of Object.keys(log)) start = minKey(start, k);
  return start;
}

/** Días cumplidos por semana (clave = lunes). */
export function doneDaysByWeek(habit, log, from, to) {
  const weeks = new Map();
  for (let w = weekStart(from); w <= to; w = addDays(w, 7)) weeks.set(w, 0);
  for (const [k, v] of Object.entries(log)) {
    if (k < from || k > to || !isDone(habit, v)) continue;
    const w = weekStart(k);
    weeks.set(w, (weeks.get(w) || 0) + 1);
  }
  return weeks;
}

/**
 * Rachas de un hábito.
 * - Diario / días concretos: días programados consecutivos cumplidos. Los días no programados no rompen.
 * - N por semana: semanas consecutivas que alcanzan N.
 * El periodo en curso (hoy, o la semana actual) nunca rompe la racha: aún hay tiempo.
 */
export function computeStreak(habit, log = {}, today) {
  const start = habitStart(habit, log);
  if (start > today) return { current: 0, best: 0, unit: unitOf(habit), pending: true };

  if (habit.schedule.type === 'weekly') {
    const weeks = [...doneDaysByWeek(habit, log, start, today).entries()];
    const met = weeks.map(([, n]) => n >= habit.schedule.times);
    const best = longestRun(met);
    const lastMet = met[met.length - 1];
    let current = 0;
    for (let i = met.length - 1 - (lastMet ? 0 : 1); i >= 0 && met[i]; i--) current++;
    return { current, best, unit: 'semana', pending: !lastMet };
  }

  const days = dateRange(start, today).filter((k) => isScheduled(habit, k));
  const done = days.map((k) => isDone(habit, log[k]));
  const best = longestRun(done);
  const todayIdx = days[days.length - 1] === today ? days.length - 1 : -1;
  const pending = todayIdx >= 0 && !done[todayIdx];
  let current = 0;
  for (let i = done.length - 1 - (pending ? 1 : 0); i >= 0 && done[i]; i--) current++;
  return { current, best, unit: 'día', pending };
}

function longestRun(bools) {
  let best = 0;
  let run = 0;
  for (const b of bools) {
    run = b ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

const unitOf = (habit) => (habit.schedule.type === 'weekly' ? 'semana' : 'día');

export function streakLabel(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}
