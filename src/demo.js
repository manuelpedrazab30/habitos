import { addDays, diffDays, weekday } from './domain/dates.js';
import { createHabit } from './domain/habits.js';
import { normalizeFinance, DEFAULT_CATEGORIES, paydayDates } from './domain/finance.js';

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

/**
 * Finanzas de ejemplo (~100 días): cobros el 1 y el 15, gastos diarios variados, alquiler,
 * suscripciones y el pago mensual de la tarjeta. Restaurantes va alto este mes para que
 * se vea el aviso de presupuesto.
 */
export function demoFinance(today) {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const between = (a, b) => Math.round((a + rnd() * (b - a)) * 100); // céntimos
  const start = addDays(today, -100);
  const accounts = [
    { id: 'demo-bank', name: 'Cuenta corriente', emoji: '🏦', initial: 180000 },
    { id: 'demo-card', name: 'Tarjeta de crédito', emoji: '💳', initial: 0 },
    { id: 'demo-cash', name: 'Efectivo', emoji: '💵', initial: 8000 },
  ];
  const budgets = { 'cat-food': 20000, 'cat-fun': 12000, 'cat-super': 35000 };
  const categories = DEFAULT_CATEGORIES.map((c) => ({ ...c, budget: budgets[c.id] ?? null }));
  const paydays = [{ id: 'demo-pay1', day: 1, amount: 160000, accountId: 'demo-bank' }, { id: 'demo-pay15', day: 15, amount: 110000, accountId: 'demo-bank' }];
  const tx = [];
  const add = (t) => tx.push({ id: `demo-tx-${tx.length}`, note: '', ...t });
  const fin0 = normalizeFinance({ paydays }, today);

  for (const { key, payday } of paydayDates(fin0, start, today)) {
    add({ type: 'income', amount: payday.amount, date: key, accountId: 'demo-bank', paydayId: payday.id, note: 'Nómina' });
  }
  const thisMonth = today.slice(0, 7);
  for (let k = start; k <= today; k = addDays(k, 1)) {
    const d = Number(k.slice(8));
    const wd = weekday(k);
    const card = rnd() < 0.7 ? 'demo-card' : 'demo-bank';
    if (d === 1) add({ type: 'expense', amount: 75000, date: k, accountId: 'demo-bank', categoryId: 'cat-home', note: 'Alquiler', fixedCostId: 'demo-fx-rent' });
    if (d === 5) add({ type: 'expense', amount: 1299, date: k, accountId: 'demo-card', categoryId: 'cat-subs', note: 'Streaming', fixedCostId: 'demo-fx-stream' });
    if (d === 13 && k < today) add({ type: 'expense', amount: 3500, date: k, accountId: 'demo-card', categoryId: 'cat-health', note: 'Gimnasio', fixedCostId: 'demo-fx-gym' });
    if (d === 8) add({ type: 'expense', amount: between(45, 75), date: k, accountId: 'demo-bank', categoryId: 'cat-bills', note: 'Luz' });
    if (d === 20) add({ type: 'expense', amount: 3500, date: k, accountId: 'demo-bank', categoryId: 'cat-bills', note: 'Internet', fixedCostId: 'demo-fx-net' });
    if (d === 3) { // la tarjeta se liquida con lo gastado en ella el mes anterior
      const prevMonth = toKeyMonth(addDays(k, -5));
      const owed = tx.filter((t) => t.accountId === 'demo-card' && t.type === 'expense' && t.date.startsWith(prevMonth)).reduce((a, t) => a + t.amount, 0);
      if (owed) add({ type: 'transfer', amount: owed, date: k, accountId: 'demo-bank', toAccountId: 'demo-card', note: 'Pago tarjeta' });
    }
    if (d === 10) add({ type: 'transfer', amount: 6000, date: k, accountId: 'demo-bank', toAccountId: 'demo-cash', note: 'Cajero' });
    if ((wd === 1 || wd === 5) && rnd() < 0.9) add({ type: 'expense', amount: between(25, 85), date: k, accountId: card, categoryId: 'cat-super' });
    const restaurantP = k.startsWith(thisMonth) ? 0.6 : 0.35;
    if (rnd() < restaurantP) add({ type: 'expense', amount: between(9, 38), date: k, accountId: card, categoryId: 'cat-food' });
    if (wd < 5 && rnd() < 0.5) add({ type: 'expense', amount: between(1.5, 3.2), date: k, accountId: 'demo-cash', categoryId: 'cat-food', note: 'Café' });
    if (rnd() < 0.25) add({ type: 'expense', amount: between(2, 45), date: k, accountId: card, categoryId: 'cat-transport', note: rnd() < 0.4 ? 'Gasolina' : '' });
    if (wd >= 5 && rnd() < 0.45) add({ type: 'expense', amount: between(10, 60), date: k, accountId: card, categoryId: 'cat-fun' });
    if (rnd() < 0.08) add({ type: 'expense', amount: between(15, 120), date: k, accountId: card, categoryId: 'cat-shop' });
    if (rnd() < 0.04) add({ type: 'expense', amount: between(8, 60), date: k, accountId: card, categoryId: 'cat-health', note: 'Farmacia' });
  }
  const fixedCosts = [
    { id: 'demo-fx-rent', name: 'Alquiler', amount: 75000, day: 1, categoryId: 'cat-home', accountId: 'demo-bank', createdAt: start },
    { id: 'demo-fx-stream', name: 'Streaming', amount: 1299, day: 5, categoryId: 'cat-subs', accountId: 'demo-card', createdAt: start },
    { id: 'demo-fx-gym', name: 'Gimnasio', amount: 3500, day: 13, categoryId: 'cat-health', accountId: 'demo-card', createdAt: start },
    { id: 'demo-fx-net', name: 'Internet', amount: 3500, day: 20, categoryId: 'cat-bills', accountId: 'demo-bank', createdAt: start },
    { id: 'demo-fx-car', name: 'Seguro del coche', amount: 38000, day: 20, frequency: 'yearly', month: Number(addDays(today, 40).slice(5, 7)), categoryId: 'cat-transport', accountId: 'demo-bank', createdAt: start },
  ];
  return normalizeFinance({ currency: 'EUR', since: start, accounts, categories, paydays, fixedCosts, transactions: tx }, today);
}

function toKeyMonth(key) {
  return key.slice(0, 7);
}
