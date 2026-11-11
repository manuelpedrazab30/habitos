import { addDays, dateRange, diffDays, maxKey, weekStart, weekday } from './dates.js';
import { isDone, isScheduled, targetDirection } from './habits.js';
import { doneDaysByWeek, habitStart } from './streaks.js';
import { accumulated } from './gamification.js';

/**
 * % de cumplimiento en [from, to].
 * Semanales: cada semana completa aporta min(hechos, N)/N; la semana en curso solo cuenta si ya está cumplida.
 */
export function completionRate(habit, log = {}, from, to, today = to) {
  const start = maxKey(from, habitStart(habit, log));
  if (start > to) return null;

  if (habit.schedule.type === 'weekly') {
    const N = habit.schedule.times;
    let got = 0;
    let expected = 0;
    for (const [w, n] of doneDaysByWeek(habit, log, start, to)) {
      const inProgress = addDays(w, 6) >= today;
      if (inProgress && n < N) continue;
      got += Math.min(n, N);
      expected += N;
    }
    return expected ? got / expected : null;
  }

  let done = 0;
  let expected = 0;
  for (const k of dateRange(start, to)) {
    if (!isScheduled(habit, k)) continue;
    const ok = isDone(habit, log[k]);
    if (k === today && !ok) continue; // hoy aún no ha terminado
    expected++;
    if (ok) done++;
  }
  return expected ? done / expected : null;
}

/** % de cumplimiento por día de la semana (solo hábitos con días esperados: diarios y días concretos). */
export function weekdayRates(habits, entries, from, to, today = to) {
  const acc = Array.from({ length: 7 }, () => ({ done: 0, expected: 0 }));
  for (const h of habits) {
    if (h.schedule.type === 'weekly') continue;
    const log = entries[h.id] || {};
    const start = maxKey(from, habitStart(h, log));
    if (start > to) continue;
    for (const k of dateRange(start, to)) {
      if (!isScheduled(h, k)) continue;
      const ok = isDone(h, log[k]);
      if (k === today && !ok) continue;
      const slot = acc[weekday(k)];
      slot.expected++;
      if (ok) slot.done++;
    }
  }
  return acc.map((s) => ({ ...s, rate: s.expected ? s.done / s.expected : null }));
}

/** Intensidad de un día para el mapa de calor global: hechos / esperados (0..1), null si no había nada. */
export function dayIntensity(habits, entries, key) {
  let due = 0;
  let done = 0;
  for (const h of habits) {
    const log = entries[h.id] || {};
    if (key < habitStart(h, log)) continue;
    const ok = isDone(h, log[key]);
    if (h.schedule.type === 'weekly') {
      if (ok) { due++; done++; }
    } else if (isScheduled(h, key)) {
      due++;
      if (ok) done++;
    }
  }
  return due ? done / due : null;
}

/** Mínimos cuadrados sobre [{x, y}]. Devuelve pendiente por unidad de x. */
export function linearTrend(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: my - slope * mx };
}

/** Mediciones ordenadas de un hábito objetivo. */
export function measurements(log = {}) {
  return Object.entries(log)
    .map(([key, value]) => ({ key, value: Number(value) }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
}

/**
 * Proyección de un objetivo de medida: dónde estás, a qué ritmo vas y cuándo llegarías.
 * El ritmo usa las mediciones de los últimos 42 días (mín. 2) para reflejar la tendencia reciente.
 */
export function targetProjection(habit, log = {}, today) {
  const g = habit.goal;
  const ms = measurements(log);
  const current = ms.length ? ms[ms.length - 1].value : g.start;
  const dir = targetDirection(habit);
  const total = g.value - g.start;
  const remaining = g.value - current;
  const reached = dir < 0 ? current <= g.value : current >= g.value;
  const progress = total ? Math.min(1, Math.max(0, (current - g.start) / total)) : 0;

  const windowStart = addDays(today, -42);
  let recent = ms.filter((m) => m.key >= windowStart);
  if (recent.length < 2) recent = ms.slice(-2);
  const trend = linearTrend(recent.map((m) => ({ x: diffDays(today, m.key), y: m.value })));
  const perDay = trend ? trend.slope : null;

  let etaKey = null;
  if (!reached && perDay && Math.sign(perDay) === Math.sign(remaining)) {
    etaKey = addDays(today, Math.ceil(remaining / perDay));
  }

  const daysLeft = g.deadline ? diffDays(today, g.deadline) : null;
  const requiredPerDay = daysLeft && daysLeft > 0 && !reached ? remaining / daysLeft : null;
  const onTrack = reached || (etaKey && g.deadline ? etaKey <= g.deadline : null);

  return { current, start: g.start, goal: g.value, dir, remaining, reached, progress, perDay, etaKey, daysLeft, requiredPerDay, onTrack, trend, measurements: ms };
}

/**
 * Proyección de una meta de total (check: días cumplidos; count: cantidad acumulada).
 * El ritmo es la media diaria de los últimos 14 días (o desde el inicio si es más corto).
 */
export function totalProjection(habit, log = {}, today) {
  const g = habit.goal;
  if (!g.total) return null;
  const done = accumulated(habit, log);
  const remaining = Math.max(0, g.total - done);
  const reached = remaining === 0;

  const start = habitStart(habit, log);
  const from = maxKey(start, addDays(today, -13));
  const span = diffDays(from, today) + 1;
  let recent = 0;
  for (const [k, v] of Object.entries(log)) {
    if (k < from || k > today) continue;
    recent += habit.kind === 'count' ? Number(v) || 0 : isDone(habit, v) ? 1 : 0;
  }
  const perDay = span > 0 ? recent / span : 0;
  const etaKey = !reached && perDay > 0 ? addDays(today, Math.ceil(remaining / perDay)) : null;
  const daysLeft = g.deadline ? diffDays(today, g.deadline) : null;
  const requiredPerDay = daysLeft && daysLeft > 0 && !reached ? remaining / daysLeft : null;
  const onTrack = reached || (etaKey && g.deadline ? etaKey <= g.deadline : null);
  return { done, total: g.total, remaining, reached, progress: Math.min(1, done / g.total), perDay, etaKey, daysLeft, requiredPerDay, onTrack };
}

/** Situación de la semana actual para hábitos N por semana. */
export function weekStatus(habit, log = {}, today) {
  if (habit.schedule.type !== 'weekly') return null;
  const w = weekStart(today);
  let done = 0;
  for (const k of dateRange(w, today)) if (isDone(habit, log[k])) done++;
  const daysLeft = 6 - weekday(today) + (isDone(habit, log[today]) ? 0 : 1); // incluye hoy si aún no está hecho
  return { done, times: habit.schedule.times, daysLeft, met: done >= habit.schedule.times };
}

/** Hábitos ordenados de peor a mejor según los últimos 28 días, con la tendencia frente a los 28 anteriores. */
export function improvementAreas(habits, entries, today) {
  const curFrom = addDays(today, -27);
  const prevTo = addDays(today, -28);
  const prevFrom = addDays(today, -55);
  return habits
    .map((h) => {
      const log = entries[h.id] || {};
      const rate = completionRate(h, log, curFrom, today, today);
      const prev = completionRate(h, log, prevFrom, prevTo, today);
      return { habit: h, rate, prev, delta: rate !== null && prev !== null ? rate - prev : null };
    })
    .filter((r) => r.rate !== null)
    .sort((a, b) => a.rate - b.rate);
}

/** Totales por semana de un hábito (para barras). count: suma; check/target: días cumplidos. */
export function weeklyTotals(habit, log = {}, weeks, today) {
  const out = [];
  const lastWeek = weekStart(today);
  for (let i = weeks - 1; i >= 0; i--) {
    const w = addDays(lastWeek, -7 * i);
    let sum = 0;
    for (const k of dateRange(w, addDays(w, 6))) {
      const v = log[k];
      if (v === undefined) continue;
      sum += habit.kind === 'count' ? Number(v) || 0 : isDone(habit, v) ? 1 : 0;
    }
    out.push({ week: w, value: sum });
  }
  return out;
}
