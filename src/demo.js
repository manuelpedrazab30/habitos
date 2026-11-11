import { addDays, diffDays, weekday } from './domain/dates.js';
import { createHabit } from './domain/habits.js';

// Datos de ejemplo (~100 días) para explorar las gráficas sin esperar semanas.
// Pseudoaleatorio con semilla para que sea reproducible.
export function demoState(today) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const start = addDays(today, -100);

  const habits = [
    createHabit({ id: 'demo-meditar', name: 'Meditar', emoji: '🧘', color: '#6366f1', kind: 'check', schedule: { type: 'daily' }, createdAt: start }),
    createHabit({ id: 'demo-leer', name: 'Leer', emoji: '📚', color: '#10b981', kind: 'count', unit: 'páginas', dailyGoal: 20, step: 5, schedule: { type: 'daily' }, goal: { total: 2500, deadline: addDays(today, 60) }, createdAt: start }),
    createHabit({ id: 'demo-gym', name: 'Entrenar', emoji: '🏋️', color: '#f59e0b', kind: 'check', schedule: { type: 'weekly', times: 3 }, goal: { from: addDays(today, -58), deadline: addDays(today, 25) }, createdAt: start,
      sessions: [
        { id: 'demo-a', name: 'Día A · Empuje', exercises: [
          { id: 'demo-bp', name: 'Press banca', sets: 3, reps: 8, weight: 40 },
          { id: 'demo-ohp', name: 'Press militar', sets: 3, reps: 8, weight: 25 },
        ] },
        { id: 'demo-b', name: 'Día B · Tirón', exercises: [
          { id: 'demo-row', name: 'Remo con barra', sets: 3, reps: 10, weight: 40 },
          { id: 'demo-pu', name: 'Dominadas', sets: 3, reps: 8, weight: null },
        ] },
        { id: 'demo-c', name: 'Día C · Pierna', exercises: [
          { id: 'demo-sq', name: 'Sentadilla', sets: 3, reps: 8, weight: 60 },
          { id: 'demo-rdl', name: 'Peso muerto rumano', sets: 3, reps: 10, weight: 50 },
        ] },
      ] }),
    createHabit({ id: 'demo-peso', name: 'Peso', emoji: '⚖️', color: '#ef4444', kind: 'target', unit: 'kg', schedule: { type: 'weekly', times: 2 }, goal: { start: 86, value: 79, deadline: addDays(today, 75) }, createdAt: start }),
  ];

  const entries = { 'demo-meditar': {}, 'demo-leer': {}, 'demo-gym': {}, 'demo-peso': {} };
  for (let k = start; k < today; k = addDays(k, 1)) {
    const wd = weekday(k);
    const weekend = wd >= 5;
    if (rnd() < (weekend ? 0.45 : 0.85)) entries['demo-meditar'][k] = 1;
    if (rnd() < 0.8) entries['demo-leer'][k] = Math.round(10 + rnd() * 25);
    if ([0, 2, 4].includes(wd) && rnd() < 0.93) entries['demo-gym'][k] = 1;
    if ([0, 3].includes(wd)) {
      const t = diffDays(start, k);
      entries['demo-peso'][k] = Math.round((86 - t * 0.045 + (rnd() - 0.5) * 0.8) * 10) / 10;
    }
  }
  // Racha reciente de meditación para que se vean los mensajes de racha
  for (let i = 1; i <= 12; i++) entries['demo-meditar'][addDays(today, -i)] = 1;
  // Sesiones de gimnasio en rotación A → B → C: sentadilla progresando, press banca
  // estancado en sus últimas 5 sesiones y remo listo para subir.
  const workouts = { 'demo-gym': {} };
  const gymDays = Object.keys(entries['demo-gym']).sort();
  const order = ['demo-a', 'demo-b', 'demo-c'];
  const timesA = Math.ceil(gymDays.length / 3); // veces que se hizo el Día A
  const lastB = gymDays.length - 1 - ((gymDays.length - 2) % 3); // índice de la última sesión B
  const stallFrom = timesA - 5; // press banca: últimas 5 sesiones A con el mismo peso
  gymDays.forEach((k, n) => {
    const sessionId = order[n % 3];
    const i = Math.floor(n / 3); // nº de repetición de su sesión
    const last = n === lastB;
    const items = {
      'demo-a': [
        { exerciseId: 'demo-bp', name: 'Press banca', sets: 3, reps: i >= stallFrom ? 6 : 8, weight: 40 + 2.5 * (i < stallFrom ? Math.floor(i / 2) : Math.floor((stallFrom - 1) / 2) + 1) },
        { exerciseId: 'demo-ohp', name: 'Press militar', sets: 3, reps: 8, weight: 25 + 2.5 * Math.floor(i / 3) },
      ],
      'demo-b': [
        { exerciseId: 'demo-row', name: 'Remo con barra', sets: 3, reps: last ? 10 : 8 + (i % 2), weight: 40 + 2.5 * Math.floor(i / 2) },
        { exerciseId: 'demo-pu', name: 'Dominadas', sets: 3, reps: Math.min(8, 4 + Math.floor(i / 3)), weight: null },
      ],
      'demo-c': [
        { exerciseId: 'demo-sq', name: 'Sentadilla', sets: 3, reps: i % 2 ? 8 : 7, weight: 60 + 2.5 * Math.floor(i / 2) },
        { exerciseId: 'demo-rdl', name: 'Peso muerto rumano', sets: 3, reps: 10, weight: 50 + 2.5 * Math.floor(i / 3) },
      ],
    }[sessionId];
    workouts['demo-gym'][k] = { sessionId, items };
  });
  return { version: 4, habits, entries, workouts, settings: { demo: true } };
}
