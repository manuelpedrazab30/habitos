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
