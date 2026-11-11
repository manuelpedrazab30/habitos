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
    createHabit({ id: 'demo-gym', name: 'Entrenar', emoji: '🏋️', color: '#f59e0b', kind: 'check', schedule: { type: 'weekly', times: 3 }, createdAt: start }),
    createHabit({ id: 'demo-peso', name: 'Peso', emoji: '⚖️', color: '#ef4444', kind: 'target', unit: 'kg', schedule: { type: 'weekly', times: 2 }, goal: { start: 86, value: 79, deadline: addDays(today, 75) }, createdAt: start }),
  ];

  const entries = { 'demo-meditar': {}, 'demo-leer': {}, 'demo-gym': {}, 'demo-peso': {} };
  for (let k = start; k < today; k = addDays(k, 1)) {
    const wd = weekday(k);
    const weekend = wd >= 5;
    if (rnd() < (weekend ? 0.45 : 0.85)) entries['demo-meditar'][k] = 1;
    if (rnd() < 0.8) entries['demo-leer'][k] = Math.round(10 + rnd() * 25);
    if ([0, 2, 4].includes(wd) && rnd() < 0.8) entries['demo-gym'][k] = 1;
    if ([0, 3].includes(wd)) {
      const t = diffDays(start, k);
      entries['demo-peso'][k] = Math.round((86 - t * 0.045 + (rnd() - 0.5) * 0.8) * 10) / 10;
    }
  }
  // Racha reciente de meditación para que se vean los mensajes de racha
  for (let i = 1; i <= 12; i++) entries['demo-meditar'][addDays(today, -i)] = 1;
  return { version: 1, habits, entries, settings: { demo: true } };
}
