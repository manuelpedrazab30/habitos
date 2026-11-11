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
      routine: [
        { id: 'demo-sq', name: 'Sentadilla', sets: 3, reps: 8, weight: 60 },
        { id: 'demo-bp', name: 'Press banca', sets: 3, reps: 8, weight: 40 },
        { id: 'demo-row', name: 'Remo con barra', sets: 3, reps: 10, weight: 40 },
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
  // Sesiones de gimnasio: sentadilla progresando, press banca estancado, remo listo para subir
  const workouts = { 'demo-gym': {} };
  const gymDays = Object.keys(entries['demo-gym']).sort();
  const stallFrom = gymDays.length - 5; // press banca: últimas 5 sesiones sin poder subir
  gymDays.forEach((k, n) => {
    const last = n === gymDays.length - 1;
    const sqReady = n % 4 === 3; // completa las reps justo antes de cada subida
    workouts['demo-gym'][k] = [
      { exerciseId: 'demo-sq', name: 'Sentadilla', sets: 3, reps: sqReady ? 8 : 7, weight: 60 + 2.5 * Math.floor(n / 4) },
      { exerciseId: 'demo-bp', name: 'Press banca', sets: 3, reps: n >= stallFrom ? 6 : 8, weight: 40 + 2.5 * (n < stallFrom ? Math.floor(n / 4) : Math.floor((stallFrom - 1) / 4) + 1) },
      { exerciseId: 'demo-row', name: 'Remo con barra', sets: 3, reps: last ? 10 : 8 + (n % 2), weight: 40 + 2.5 * Math.floor(n / 5) },
    ];
  });
  return { version: 3, habits, entries, workouts, settings: { demo: true } };
}
