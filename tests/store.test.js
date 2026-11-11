import { test, eq, ok } from './runner.js';
import { createStore, migrate, STORAGE_KEY } from '../src/store.js';

const memoryStorage = () => {
  const data = {};
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, data };
};

test('store: persiste y recarga', () => {
  const mem = memoryStorage();
  const a = createStore(mem);
  const h = a.addHabit({ name: 'Leer', kind: 'count', dailyGoal: 10 });
  a.setEntry(h.id, '2026-11-11', 12);
  const b = createStore(mem);
  eq(b.get().habits[0].name, 'Leer');
  eq(b.get().entries[h.id]['2026-11-11'], 12);
});
test('store: setEntry null borra y undo restaura', () => {
  const s = createStore(memoryStorage());
  const h = s.addHabit({ name: 'x' });
  s.setEntry(h.id, '2026-11-11', 1);
  s.setEntry(h.id, '2026-11-11', null);
  eq(s.get().entries[h.id]['2026-11-11'], undefined);
  s.undo();
  eq(s.get().entries[h.id]['2026-11-11'], 1);
});
test('store: datos corruptos arrancan vacío', () => {
  const mem = memoryStorage();
  mem.setItem(STORAGE_KEY, '{no es json');
  eq(createStore(mem).get().habits, []);
  eq(migrate(null).habits, []);
});
test('store: importar valida el formato', () => {
  const s = createStore(memoryStorage());
  let threw = false;
  try { s.importJson('{"foo":1}'); } catch { threw = true; }
  ok(threw);
  s.importJson(JSON.stringify({ habits: [{ name: 'A', kind: 'check' }], entries: {} }));
  eq(s.get().habits[0].name, 'A');
});
test('store: eliminar hábito borra sus registros y es reversible', () => {
  const s = createStore(memoryStorage());
  const h = s.addHabit({ name: 'x' });
  s.setEntry(h.id, '2026-11-11', 1);
  s.deleteHabit(h.id);
  eq([s.get().habits.length, s.get().entries[h.id]], [0, undefined]);
  s.undo();
  eq(s.get().habits.length, 1);
});

test('store: setWorkout guarda la plantilla, marca el día y desmarcar borra la sesión', () => {
  const s = createStore(memoryStorage());
  const h = s.addHabit({ name: 'Entrenar', kind: 'check', schedule: { type: 'weekly', times: 2 }, sessions: [{ exercises: [{ name: 'Sentadilla' }] }] });
  const [a] = s.get().habits[0].sessions;
  s.setWorkout(h.id, '2026-11-11', [{ exerciseId: a.exercises[0].id, name: 'Sentadilla', sets: 3, reps: 8, weight: 60 }], a.id);
  eq(s.get().entries[h.id]['2026-11-11'], 1);
  eq(s.get().workouts[h.id]['2026-11-11'].sessionId, a.id);
  eq(s.get().workouts[h.id]['2026-11-11'].items[0].weight, 60);
  s.setEntry(h.id, '2026-11-11', null);
  eq(s.get().workouts[h.id]['2026-11-11'], undefined);
  s.undo();
  eq(s.get().workouts[h.id]['2026-11-11'].items[0].weight, 60);
});
test('store: migra v3 (rutina única y sesiones como array) a v4', () => {
  const mem = memoryStorage();
  mem.setItem(STORAGE_KEY, JSON.stringify({
    version: 3,
    habits: [{ id: 'g', name: 'Entrenar', kind: 'check', schedule: { type: 'weekly', times: 3 }, routine: [{ id: 'sq', name: 'Sentadilla', reps: 8 }] }],
    entries: { g: { '2026-11-10': 1 } },
    workouts: { g: { '2026-11-10': [{ exerciseId: 'sq', name: 'Sentadilla', sets: 3, reps: 8, weight: 60 }] } },
  }));
  const st = createStore(mem).get();
  eq(st.version, 4);
  eq(st.habits[0].sessions.length, 3);
  eq(st.habits[0].routine, undefined);
  eq(st.workouts.g['2026-11-10'], { sessionId: null, items: [{ exerciseId: 'sq', name: 'Sentadilla', sets: 3, reps: 8, weight: 60 }] });
});
test('store: datos v2 migran con workouts vacío', () => {
  const mem = memoryStorage();
  mem.setItem(STORAGE_KEY, JSON.stringify({ version: 2, habits: [{ name: 'A', kind: 'check' }], entries: {} }));
  const st = createStore(mem).get();
  eq([st.version, st.workouts, st.habits[0].sessions], [4, {}, []]);
});
