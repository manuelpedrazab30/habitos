import { addDays, diffDays, weekday, todayKey } from './dates.js';
import { normalizeRoutine } from './workouts.js';

/**
 * Tres tipos de hábito cubren casi todo:
 *  - check:  sí/no por día (meditar, no fumar). Valor guardado: 1.
 *  - count:  cantidad por sesión con meta diaria (20 páginas, 8 vasos). Valor: cantidad.
 *  - target: una medida que evoluciona hacia un objetivo (peso, tiempo en 5 km). Valor: la medición.
 *
 * Calendario (schedule):
 *  - { type: 'daily' }                 todos los días
 *  - { type: 'days', days: [0, 2, 4] } días concretos (0 = lunes)
 *  - { type: 'weekly', times: 3 }      N veces por semana, cualquier día
 *
 * Meta con plazo (goal), opcional:
 *  - check:  { from, deadline } → meta de DURACIÓN: mantener el hábito entre dos fechas
 *            ("3 veces por semana durante 12 semanas"). Se mide en periodos cumplidos
 *            (semanas para hábitos semanales, días programados para el resto), no en veces.
 *  - count:  { total, deadline } → "1000 páginas" antes de una fecha
 *  - target: { start, value, deadline } → de 85 kg a 78 kg antes de una fecha
 *
 * Rutina (routine), opcional y solo en check: ejercicios con series, reps y peso planificados.
 * Las sesiones se guardan aparte en state.workouts (ver workouts.js).
 *
 * En todos los tipos, un registro = un día. En un hábito "3 veces por semana", cada
 * registro es un día de esa semana; la semana se cumple al llegar a 3 días distintos.
 */
export const KINDS = {
  check: { label: 'Sí / No', hint: 'Lo hiciste o no. Ej.: meditar, entrenar.' },
  count: { label: 'Cantidad', hint: 'Sumas una cantidad cada día. Ej.: páginas, vasos de agua.' },
  target: { label: 'Medida objetivo', hint: 'Una cifra que quieres llevar a un valor. Ej.: peso.' },
};

export const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#8b5cf6', '#84cc16'];

export const TEMPLATES = [
  { name: 'Meditar', emoji: '🧘', kind: 'check', schedule: { type: 'daily' } },
  { name: 'Leer', emoji: '📚', kind: 'count', unit: 'páginas', dailyGoal: 20, step: 5, schedule: { type: 'daily' } },
  {
    name: 'Entrenar', emoji: '🏋️', kind: 'check', schedule: { type: 'weekly', times: 3 }, goal: { weeks: 12 },
    routine: [{ name: 'Sentadilla', sets: 3, reps: 8 }, { name: 'Press banca', sets: 3, reps: 8 }, { name: 'Remo con barra', sets: 3, reps: 10 }],
  },
  { name: 'Agua', emoji: '💧', kind: 'count', unit: 'vasos', dailyGoal: 8, step: 1, schedule: { type: 'daily' } },
  { name: 'Peso', emoji: '⚖️', kind: 'target', unit: 'kg', schedule: { type: 'weekly', times: 1 }, goal: {} },
  { name: 'Correr', emoji: '🏃', kind: 'count', unit: 'km', dailyGoal: 5, step: 1, schedule: { type: 'days', days: [1, 3, 5] } },
];

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `h${Date.now()}${Math.random().toString(36).slice(2)}`);

export function createHabit(input, now = new Date()) {
  const kind = KINDS[input.kind] ? input.kind : 'check';
  const habit = {
    id: input.id || uid(),
    name: (input.name || '').trim(),
    emoji: input.emoji || '✨',
    color: input.color || COLORS[0],
    kind,
    unit: kind === 'check' ? '' : (input.unit || '').trim(),
    dailyGoal: kind === 'count' ? Number(input.dailyGoal) || 1 : null,
    step: kind === 'count' ? Number(input.step) || 1 : null,
    schedule: normalizeSchedule(input.schedule),
    routine: kind === 'check' ? normalizeRoutine(input.routine) : [],
    goal: null,
    createdAt: input.createdAt || todayKey(now),
    archived: Boolean(input.archived),
  };
  habit.goal = normalizeGoal(kind, input.goal, habit.createdAt);
  return habit;
}

function normalizeSchedule(s) {
  if (s?.type === 'days' && Array.isArray(s.days) && s.days.length) {
    return { type: 'days', days: [...new Set(s.days.map(Number))].sort() };
  }
  if (s?.type === 'weekly') {
    return { type: 'weekly', times: Math.min(7, Math.max(1, Number(s.times) || 1)) };
  }
  return { type: 'daily' };
}

function num(v) {
  return v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);
}

function normalizeGoal(kind, g = {}, createdAt) {
  let deadline = g?.deadline || null;
  if (kind === 'target') return { start: num(g?.start), value: num(g?.value), deadline };
  if (kind === 'check') {
    // Duración: desde `from` hasta `deadline` (incluido). `weeks` es un atajo de entrada (plantillas).
    const from = g?.from || createdAt;
    if (!deadline && num(g?.weeks)) deadline = addDays(from, num(g.weeks) * 7 - 1);
    return { from: deadline ? from : null, deadline };
  }
  return { total: num(g?.total), deadline };
}

/** Semanas (redondeadas) que abarca una meta de duración. */
export function durationWeeks(goal) {
  return goal?.from && goal?.deadline ? Math.max(1, Math.round((diffDays(goal.from, goal.deadline) + 1) / 7)) : null;
}

export function validateHabit(h) {
  const errors = {};
  if (!h.name) errors.name = 'Ponle un nombre.';
  if (h.kind === 'count' && !(h.dailyGoal > 0)) errors.dailyGoal = 'La meta diaria debe ser mayor que 0.';
  if (h.kind === 'target') {
    if (h.goal.value === null) errors.goalValue = 'Indica el valor al que quieres llegar.';
    if (h.goal.start === null) errors.goalStart = 'Indica tu valor actual.';
    if (h.goal.start !== null && h.goal.start === h.goal.value) errors.goalValue = 'El objetivo debe ser distinto del valor actual.';
  }
  if (h.kind === 'check' && h.goal.deadline && h.goal.deadline < h.goal.from) errors.deadline = 'La fecha de fin es anterior al inicio de la meta.';
  else if (h.kind !== 'check' && h.goal.deadline && h.goal.deadline < h.createdAt) errors.deadline = 'La fecha límite ya pasó.';
  return errors;
}

/** ¿Se espera el hábito este día? Los semanales admiten cualquier día. */
export function isScheduled(habit, key) {
  return habit.schedule.type === 'days' ? habit.schedule.days.includes(weekday(key)) : true;
}

/** ¿El valor registrado cuenta como cumplido? */
export function isDone(habit, value) {
  if (value === undefined || value === null) return false;
  if (habit.kind === 'check') return value >= 1;
  if (habit.kind === 'count') return value >= habit.dailyGoal;
  return true; // target: registrar la medición ya cuenta
}

/** Dirección de un objetivo de medida: -1 bajar (peso), +1 subir. */
export function targetDirection(habit) {
  return habit.goal.value < habit.goal.start ? -1 : 1;
}

export function scheduleLabel(schedule) {
  if (schedule.type === 'weekly') return schedule.times === 1 ? '1 vez por semana' : `${schedule.times} veces por semana`;
  if (schedule.type === 'days') {
    const names = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
    return schedule.days.map((d) => names[d]).join(' · ');
  }
  return 'Todos los días';
}

/** Total acumulado: cantidad sumada (count) o días cumplidos (check/target). */
export function accumulated(habit, log = {}) {
  let sum = 0;
  for (const v of Object.values(log)) {
    if (habit.kind === 'count') sum += Number(v) || 0;
    else if (isDone(habit, v)) sum += 1;
  }
  return sum;
}
