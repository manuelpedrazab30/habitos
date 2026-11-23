// Avisos de hábitos (lógica pura, sin red ni DOM). La parte con efectos vive en src/push.js.
//
// El servidor que envía los avisos no puede leer tus datos (van cifrados), así que la app le sube
// una lista pequeña y SIN cifrar de los próximos avisos: hora, título y un texto con cifras.
// Nunca incluye nombres de hábitos: solo cuántos faltan y, si procede, la racha en riesgo.
// La lista se recalcula y se vuelve a subir con cada cambio, así que un hábito marcado a tiempo
// hace desaparecer su aviso.

import { addDays, fromKey, todayKey, weekStart } from './dates.js';
import { isDone, isScheduled } from './habits.js';
import { computeStreak, doneDaysByWeek } from './streaks.js';

export const DEFAULT_TIME = '20:00';
export const REMINDER_DAYS = 3; // hoy y los dos días siguientes (por si la app no se abre)
export const RISK_STREAK = 3;   // racha mínima para avisar de que está en riesgo

/** Hábitos que se esperan ese día y aún no están cumplidos (hoy) o que tocan (días futuros). */
export function pendingFor(state, day, today) {
  const out = [];
  for (const h of state.habits.filter((x) => !x.archived)) {
    if (!isScheduled(h, day)) continue;
    const log = state.entries[h.id] || {};
    if (day === today && isDone(h, log[day])) continue;
    if (h.schedule.type === 'weekly') {
      // La semana ya cumplida no pide más; si no, cualquier día vale
      const w = weekStart(day);
      const done = doneDaysByWeek(h, log, w, today < w ? w : today).get(w) || 0;
      if (done >= h.schedule.times) continue;
    }
    out.push(h);
  }
  return out;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Aviso de un día (null si no hace falta). */
export function reminderFor(state, day, today, time = DEFAULT_TIME, now = new Date()) {
  const [hh, mm] = time.split(':').map(Number);
  const at = fromKey(day);
  at.setHours(hh, mm, 0, 0);
  if (at <= now) return null;
  const pending = pendingFor(state, day, today);
  if (!pending.length) return null;
  // Racha en riesgo: solo hábitos de calendario diario o de días concretos, hoy
  let risk = 0;
  if (day === today) {
    for (const h of pending) {
      if (h.schedule.type === 'weekly') continue;
      risk = Math.max(risk, computeStreak(h, state.entries[h.id] || {}, today).current);
    }
  }
  const body = `Te ${pending.length === 1 ? 'queda' : 'quedan'} ${plural(pending.length, 'hábito', 'hábitos')} hoy`
    + (risk >= RISK_STREAK ? `; tu racha de ${risk} días corre riesgo` : '');
  return { id: `habits-${day}`, at: at.toISOString(), title: 'Hábitos de hoy', body, url: './#/' };
}

/** Lista completa de avisos a subir. */
export function buildReminders(state, { now = new Date(), time = DEFAULT_TIME, days = REMINDER_DAYS } = {}) {
  const today = todayKey(now);
  const out = [];
  for (let i = 0; i < days; i++) {
    const r = reminderFor(state, addDays(today, i), today, time, now);
    if (r) out.push(r);
  }
  return out;
}

export const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
