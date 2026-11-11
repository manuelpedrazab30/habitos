import { test, eq, ok, near } from './runner.js';
import { addDays, dateRange, diffDays, weekday, weekStart } from '../src/domain/dates.js';
import { createHabit, isDone, isScheduled, validateHabit } from '../src/domain/habits.js';
import { computeStreak } from '../src/domain/streaks.js';
import { habitXp, levelInfo, goalReached } from '../src/domain/gamification.js';
import { completionRate, durationProgress, linearTrend, targetProjection, totalProjection, weekStatus, weekdayRates } from '../src/domain/stats.js';
import { durationMessage, habitMessages, overloadMessages, targetMessage } from '../src/domain/messages.js';
import { bestWeights, exerciseStats, normalizeRoutine, prCount, prefillSession, setLabel } from '../src/domain/workouts.js';

const T = '2026-11-11'; // miércoles
const logOf = (keys, v = 1) => Object.fromEntries(keys.map((k) => [k, v]));
const daily = (extra = {}) => createHabit({ name: 'x', kind: 'check', schedule: { type: 'daily' }, createdAt: '2026-11-01', ...extra });

// ── Fechas
test('dates: addDays cruza meses y años', () => {
  eq(addDays('2026-12-31', 1), '2027-01-01');
  eq(addDays('2026-03-01', -1), '2026-02-28');
});
test('dates: weekday 0 = lunes y weekStart', () => {
  eq(weekday('2026-11-09'), 0);
  eq(weekday(T), 2);
  eq(weekday('2026-11-15'), 6);
  eq(weekStart(T), '2026-11-09');
});
test('dates: diffDays robusto a cambios de horario', () => {
  eq(diffDays('2026-03-28', '2026-03-30'), 2);
  eq(diffDays('2026-10-24', '2026-10-26'), 2);
  eq(dateRange('2026-11-09', '2026-11-11'), ['2026-11-09', '2026-11-10', '2026-11-11']);
});

// ── Hábitos
test('habits: createHabit normaliza tipos y calendario', () => {
  const h = createHabit({ name: '  Leer ', kind: 'count', dailyGoal: '20', schedule: { type: 'weekly', times: 12 } });
  eq(h.name, 'Leer');
  eq(h.dailyGoal, 20);
  eq(h.schedule, { type: 'weekly', times: 7 });
  eq(createHabit({ kind: 'raro' }).kind, 'check');
});
test('habits: validación de objetivo de medida', () => {
  const h = createHabit({ name: 'Peso', kind: 'target', goal: { start: 80, value: 80 } });
  ok(validateHabit(h).goalValue);
  ok(validateHabit(createHabit({ name: '', kind: 'check' })).name);
  eq(validateHabit(createHabit({ name: 'Peso', kind: 'target', goal: { start: 85, value: 78 } })), {});
});
test('habits: isDone e isScheduled', () => {
  const c = createHabit({ name: 'a', kind: 'count', dailyGoal: 10 });
  ok(!isDone(c, 9));
  ok(isDone(c, 10));
  const d = createHabit({ name: 'b', schedule: { type: 'days', days: [0, 2] } });
  ok(isScheduled(d, '2026-11-09'));
  ok(!isScheduled(d, '2026-11-10'));
});

// ── Rachas
test('streaks: diaria con hoy pendiente no rompe', () => {
  const s = computeStreak(daily(), logOf(dateRange('2026-11-05', '2026-11-10')), T);
  eq([s.current, s.best, s.pending], [6, 6, true]);
  const s2 = computeStreak(daily(), logOf(dateRange('2026-11-05', T)), T);
  eq([s2.current, s2.pending], [7, false]);
});
test('streaks: un hueco reinicia la racha actual pero conserva el récord', () => {
  const s = computeStreak(daily(), logOf(['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-09', '2026-11-10']), T);
  eq([s.current, s.best], [2, 3]);
});
test('streaks: días concretos ignoran días no programados', () => {
  const h = daily({ schedule: { type: 'days', days: [0, 2, 4] } });
  const s = computeStreak(h, logOf(['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09']), T);
  eq([s.current, s.pending], [4, true]);
});
test('streaks: N por semana cuenta semanas cumplidas', () => {
  const h = daily({ schedule: { type: 'weekly', times: 2 }, createdAt: '2026-10-26' });
  const log = logOf(['2026-10-27', '2026-10-29', '2026-11-03', '2026-11-05', '2026-11-10']);
  const s = computeStreak(h, log, T);
  eq([s.current, s.best, s.unit, s.pending], [2, 2, 'semana', true]);
  eq(computeStreak(h, { ...log, [T]: 1 }, T).current, 3);
});
test('streaks: registros anteriores a la creación cuentan (relleno hacia atrás)', () => {
  const s = computeStreak(daily({ createdAt: T }), logOf(['2026-11-09', '2026-11-10']), T);
  eq(s.current, 2);
});

// ── XP y niveles
test('levels: umbrales 100 / 300 / 600', () => {
  eq(levelInfo(0).level, 1);
  eq(levelInfo(99).level, 1);
  eq(levelInfo(100).level, 2);
  eq(levelInfo(299).level, 2);
  eq(levelInfo(300).level, 3);
  eq(levelInfo(100).span, 200);
  eq(levelInfo(250).toNext, 50);
});
test('xp: bonus creciente por racha', () => {
  const h = daily({ createdAt: '2026-11-09' });
  eq(habitXp(h, logOf(['2026-11-09', '2026-11-10', T]), T), 10 + 12 + 14);
  eq(habitXp(h, logOf(['2026-11-09', T]), T), 10 + 10);
});
test('xp: meta de total alcanzada suma bonus', () => {
  const h = createHabit({ name: 'l', kind: 'count', dailyGoal: 10, goal: { total: 30 }, createdAt: '2026-11-09' });
  const log = { '2026-11-09': 12, '2026-11-10': 12, [T]: 12 };
  ok(goalReached(h, log));
  eq(habitXp(h, log, T), 36 + 250);
});

// ── Estadísticas
test('stats: tendencia lineal', () => {
  near(linearTrend([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }]).slope, 2);
  eq(linearTrend([{ x: 1, y: 1 }]), null);
});
test('stats: completionRate excluye hoy si aún no está hecho', () => {
  const h = daily({ createdAt: addDays(T, -9) });
  const log = logOf([addDays(T, -9), addDays(T, -7), addDays(T, -5), addDays(T, -3), addDays(T, -1)]);
  near(completionRate(h, log, addDays(T, -29), T, T), 5 / 9);
});
test('stats: proyección de objetivo detecta retraso', () => {
  const h = createHabit({ name: 'Peso', kind: 'target', unit: 'kg', goal: { start: 90, value: 80, deadline: addDays(T, 50) }, createdAt: addDays(T, -14) });
  const log = { [addDays(T, -14)]: 90, [addDays(T, -7)]: 89, [T]: 88 };
  const p = targetProjection(h, log, T);
  near(p.perDay, -1 / 7);
  eq(p.etaKey, addDays(T, 56));
  eq(p.onTrack, false);
  near(p.requiredPerDay, -8 / 50);
  const msg = targetMessage(h, p, T);
  ok(msg.includes('Te faltan 8 kg'), msg);
  ok(msg.includes('6 días tarde'), msg);
});
test('stats: proyección de total', () => {
  const h = createHabit({ name: 'l', kind: 'count', dailyGoal: 5, goal: { total: 100 }, createdAt: addDays(T, -9) });
  const log = Object.fromEntries(dateRange(addDays(T, -9), T).map((k) => [k, 5]));
  const p = totalProjection(h, log, T);
  eq([p.done, p.remaining, p.perDay], [50, 50, 5]);
  eq(p.etaKey, addDays(T, 10));
});
test('stats: weekStatus y weekdayRates', () => {
  const h = daily({ schedule: { type: 'weekly', times: 3 } });
  eq(weekStatus(h, logOf(['2026-11-09']), T), { done: 1, times: 3, daysLeft: 5, met: false });
  const rates = weekdayRates([daily()], { [daily().id]: {} }, '2026-11-01', T, T);
  eq(rates.length, 7);
});

// ── Mensajes
test('messages: avisa cuando hoy iguala el récord', () => {
  const h = daily({ createdAt: '2026-10-20' });
  const log = logOf([...dateRange('2026-10-20', '2026-10-26'), ...dateRange('2026-11-05', '2026-11-10')]);
  const msgs = habitMessages(h, log, T);
  ok(msgs.some((m) => m.kind === 'streak' && m.text.includes('igualas tu mejor racha (7 días)')), JSON.stringify(msgs));
});
test('messages: semanal con todos los días restantes necesarios', () => {
  const h = daily({ schedule: { type: 'weekly', times: 5 } });
  const msgs = habitMessages(h, {}, T); // miércoles: quedan 5 días (incluido hoy), faltan 5
  ok(msgs.some((m) => m.kind === 'risk' && m.text.includes('necesitas todos')), JSON.stringify(msgs));
});

// ── Metas de duración (hábitos sí/no) y registros semanales por día
test('habits: meta de sí/no es de duración, no de número de veces', () => {
  const h = createHabit({ name: 'Entrenar', kind: 'check', goal: { weeks: 12 }, createdAt: T });
  eq(h.goal, { from: T, deadline: addDays(T, 83) });
  const legacy = createHabit({ name: 'x', kind: 'check', goal: { total: 60 }, createdAt: T });
  eq(legacy.goal, { from: null, deadline: null }, 'migración v1: se descarta total');
  ok(validateHabit(createHabit({ name: 'x', kind: 'check', goal: { from: T, deadline: addDays(T, -1) } })).deadline);
});
test('weekly: cada registro es un día distinto de la semana', () => {
  const h = daily({ schedule: { type: 'weekly', times: 3 } });
  eq(weekStatus(h, logOf(['2026-11-09', '2026-11-10']), T).done, 2);
  eq(weekStatus(h, logOf(['2026-11-09', '2026-11-10', T]), T).met, true);
});
test('duration: semanal cuenta semanas cumplidas, falladas y restantes', () => {
  const h = daily({ schedule: { type: 'weekly', times: 3 }, createdAt: '2026-10-19', goal: { from: '2026-10-19', weeks: 4 } });
  eq(h.goal.deadline, '2026-11-15');
  const log = logOf(['2026-10-19', '2026-10-21', '2026-10-23', '2026-10-28', '2026-11-02', '2026-11-04', '2026-11-06', '2026-11-10']);
  const p = durationProgress(h, log, T);
  eq([p.unit, p.total, p.met, p.missed, p.remaining, p.required, p.failed], ['semana', 4, 2, 1, 1, 4, true]);
});
test('duration: diaria y mensaje con margen concreto', () => {
  const h = daily({ createdAt: addDays(T, -9), goal: { from: addDays(T, -9), deadline: addDays(T, 10) } });
  const past = dateRange(addDays(T, -9), addDays(T, -1)).slice(1); // 8 de 9 días pasados
  const p = durationProgress(h, logOf(past), T);
  eq([p.total, p.met, p.missed, p.remaining, p.required, p.needed, p.reached, p.failed], [20, 8, 1, 11, 16, 8, false, false]);
  const msg = durationMessage(h, p);
  ok(msg.includes('Llevas 8 de 20 días cumplidos'), msg);
  ok(msg.includes('puedes fallar 3 días más'), msg);
});
test('duration: lograda al 80% suma bonus de meta', () => {
  const h = daily({ schedule: { type: 'weekly', times: 1 }, createdAt: '2026-11-02', goal: { from: '2026-11-02', weeks: 2 } });
  const log = logOf(['2026-11-03', '2026-11-10']);
  ok(goalReached(h, log));
  ok(durationProgress(h, log, T).reached);
  ok(habitXp(h, log, T) >= 250);
});

// ── Rutinas y sobrecarga progresiva
const routine = [{ id: 'sq', name: 'Sentadilla', sets: 3, reps: 8 }, { id: 'bp', name: 'Press banca', sets: 3, reps: 8 }];
const sess = (sq, bp, repsBp = 8) => [
  { exerciseId: 'sq', name: 'Sentadilla', sets: 3, reps: 8, weight: sq },
  { exerciseId: 'bp', name: 'Press banca', sets: 3, reps: repsBp, weight: bp },
];
test('workouts: rutina solo en hábitos sí/no y normalizada', () => {
  const h = createHabit({ name: 'Entrenar', kind: 'check', routine: [{ name: ' Sentadilla ', sets: '3', reps: '8', weight: '' }, { name: '' }] });
  eq(h.routine.length, 1);
  eq([h.routine[0].name, h.routine[0].sets, h.routine[0].weight], ['Sentadilla', 3, null]);
  eq(createHabit({ name: 'Leer', kind: 'count', routine: [{ name: 'x' }] }).routine, []);
  eq(normalizeRoutine(null), []);
});
test('workouts: estadísticas de peso, estancamiento y sugerencia', () => {
  const w = {
    '2026-10-01': sess(60, 50, 6), '2026-10-08': sess(62.5, 50, 6), '2026-10-15': sess(65, 50, 7),
    '2026-11-01': sess(67.5, 50, 7), '2026-11-10': sess(70, 50, 6),
  };
  const sq = exerciseStats(routine[0], w, T);
  eq([sq.last.weight, sq.best, sq.change, sq.isPR, sq.suggestion], [70, 70, 10, true, 72.5]);
  eq(sq.change4w, 7.5, 'frente a la sesión del 8 oct (la última ≥28 días antes)');
  const bp = exerciseStats(routine[1], w, T);
  eq([bp.atWeight, bp.stalled, bp.suggestion], [5, true, null]);
  eq(prCount(w), 4);
  eq(bestWeights(w), { sq: 70, bp: 50 });
});
test('workouts: la hoja se precarga con la última sesión o el plan', () => {
  const w = { '2026-11-09': sess(80, 55) };
  const rows = prefillSession(routine, w, T);
  eq([rows[0].weight, rows[0].reps, rows[0].done], [80, 8, true]);
  const fresh = prefillSession([{ id: 'dl', name: 'Peso muerto', sets: 3, reps: 5, weight: 100 }], w, T);
  eq([fresh[0].weight, fresh[0].sets], [100, 3]);
  eq(prefillSession(routine, w, '2026-11-09')[0].weight, 80, 'editar un día carga lo de ese día');
  eq(setLabel({ sets: 3, reps: 8, weight: 60 }), '3×8 @ 60 kg');
  eq(setLabel({ sets: 3, reps: 12, weight: null }), '3×12 @ peso corporal');
});
test('workouts: mensajes de sobrecarga concretos', () => {
  const h = createHabit({ name: 'Entrenar', emoji: '🏋️', kind: 'check', routine });
  h.routine[0].id = 'sq'; h.routine[1].id = 'bp';
  const w = { '2026-10-20': sess(60, 50, 6), '2026-10-27': sess(60, 50, 6), '2026-11-03': sess(60, 50, 6), '2026-11-10': sess(60, 50, 6) };
  const msgs = overloadMessages(h, w, T);
  ok(msgs.some((m) => m.text.includes('Sentadilla: completaste 3×8 @ 60 kg. Prueba 62,5 kg')), JSON.stringify(msgs));
  ok(msgs.some((m) => m.text.includes('Press banca lleva 4 sesiones en 50 kg')), JSON.stringify(msgs));
});
test('xp: cada récord de peso suma', () => {
  const h = daily({ createdAt: '2026-11-09' });
  const log = logOf(['2026-11-09', '2026-11-10']);
  const w = { '2026-11-09': sess(60, 40), '2026-11-10': sess(62.5, 42.5) };
  eq(habitXp(h, log, T, w) - habitXp(h, log, T), 30);
});
