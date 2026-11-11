import { dateRange } from './dates.js';
import { accumulated, isDone, isScheduled, targetDirection } from './habits.js';
import { doneDaysByWeek, habitStart } from './streaks.js';
import { durationProgress } from './stats.js';

// La XP se DERIVA siempre del historial (nunca se guarda): deshacer un registro o
// rellenar días pasados deja la XP coherente sin migraciones ni contadores.

export const XP = {
  base: 10, // cada cumplimiento
  streakStep: 2, // extra por cada día de racha previo…
  streakCap: 10, // …hasta este número de días
  weekMet: 20, // semana cumplida (hábitos N por semana)
  weekStreakStep: 5,
  goalReached: 250, // meta con plazo alcanzada
};

export function habitXp(habit, log = {}, today) {
  const start = habitStart(habit, log);
  if (start > today) return 0;
  let xp = 0;

  if (habit.schedule.type === 'weekly') {
    for (const v of Object.values(log)) if (isDone(habit, v)) xp += XP.base;
    let run = 0;
    for (const [, n] of doneDaysByWeek(habit, log, start, today)) {
      if (n >= habit.schedule.times) {
        xp += XP.weekMet + XP.weekStreakStep * Math.min(run, XP.streakCap);
        run++;
      } else run = 0;
    }
  } else {
    let run = 0;
    for (const k of dateRange(start, today)) {
      if (!isScheduled(habit, k)) {
        if (isDone(habit, log[k])) xp += XP.base; // extra fuera de calendario: suma, no rompe
        continue;
      }
      if (isDone(habit, log[k])) {
        xp += XP.base + XP.streakStep * Math.min(run, XP.streakCap);
        run++;
      } else if (k !== today) run = 0;
    }
  }

  if (goalReached(habit, log)) xp += XP.goalReached;
  return xp;
}

export function goalReached(habit, log = {}) {
  const g = habit.goal;
  if (habit.kind === 'target') {
    if (g.value === null || g.start === null) return false;
    const dir = targetDirection(habit);
    return Object.values(log).some((v) => (dir < 0 ? v <= g.value : v >= g.value));
  }
  if (habit.kind === 'check') return Boolean(durationProgress(habit, log, '9999-12-31')?.reached);
  if (!g.total) return false;
  return accumulated(habit, log) >= g.total;
}

export function totalXp(state, today) {
  return state.habits.reduce((acc, h) => acc + habitXp(h, state.entries[h.id], today), 0);
}

/** XP acumulada necesaria para alcanzar el nivel n. Nivel 2 = 100, 3 = 300, 4 = 600… */
export function xpForLevel(n) {
  return 50 * n * (n - 1);
}

export function levelInfo(xp) {
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.08 * xp)) / 2));
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, xp, into: xp - floor, span: next - floor, toNext: next - xp };
}

