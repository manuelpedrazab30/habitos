import { test, eq, ok } from './runner.js';
import { createHabit } from '../src/domain/habits.js';
import { buildReminders, pendingFor, validTime } from '../src/domain/notify.js';

const T = '2026-11-11'; // miércoles
const at = (h, m = 0) => new Date(2026, 10, 11, h, m); // hora local del miércoles
const habit = (name, extra = {}) => createHabit({ name, kind: 'check', schedule: { type: 'daily' }, createdAt: '2026-10-01', ...extra });
const days = (h, from, to) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [`2026-11-${String(from + i).padStart(2, '0')}`, 1]));

test('notify: avisa de los hábitos que faltan hoy, sin nombres', () => {
  const a = habit('Meditar'); const b = habit('Leer');
  const r = buildReminders({ habits: [a, b], entries: {} }, { now: at(9) });
  eq(r.length, 3);
  eq(r[0].id, 'habits-2026-11-11');
  eq(r[0].body, 'Te quedan 2 hábitos hoy');
  ok(!JSON.stringify(r).includes('Meditar'), 'no se filtran nombres');
  eq(new Date(r[0].at).getHours(), 20);
});
test('notify: un hábito cumplido hoy no cuenta y sin pendientes no hay aviso hoy', () => {
  const a = habit('Meditar');
  const state = { habits: [a], entries: { [a.id]: { [T]: 1 } } };
  eq(pendingFor(state, T, T).length, 0);
  const r = buildReminders(state, { now: at(9) });
  eq(r.map((x) => x.id), ['habits-2026-11-12', 'habits-2026-11-13']);
});
test('notify: si la hora de hoy ya pasó, solo quedan los días siguientes', () => {
  const r = buildReminders({ habits: [habit('Meditar')], entries: {} }, { now: at(21) });
  eq(r.map((x) => x.id), ['habits-2026-11-12', 'habits-2026-11-13']);
});
test('notify: la racha en riesgo se cita con su cifra', () => {
  const a = habit('Meditar');
  const state = { habits: [a], entries: { [a.id]: days(0, 4, 10) } }; // 7 días seguidos hasta ayer
  const r = buildReminders(state, { now: at(9) });
  eq(r[0].body, 'Te queda 1 hábito hoy; tu racha de 7 días corre riesgo');
});
test('notify: respeta días concretos, semanales cumplidos y archivados', () => {
  const lun = habit('Lunes', { schedule: { type: 'days', days: [0] } });
  const sem = habit('Semanal', { schedule: { type: 'weekly', times: 2 } });
  const arch = { ...habit('Viejo'), archived: true };
  const state = { habits: [lun, sem, arch], entries: { [sem.id]: { '2026-11-09': 1, '2026-11-10': 1 } } }; // semana cumplida
  eq(pendingFor(state, T, T).length, 0);
  const pend = pendingFor({ habits: [lun, sem], entries: {} }, T, T);
  eq(pend.map((x) => x.name), ['Semanal']);
});
test('notify: validTime', () => {
  ok(validTime('20:00') && validTime('07:30') && !validTime('24:00') && !validTime('7:30'));
});
