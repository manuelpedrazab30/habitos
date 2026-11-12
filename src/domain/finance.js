import { addDays, dateRange, diffDays, fromKey, toKey } from './dates.js';

// Finanzas personales: lógica pura (sin DOM). Importes SIEMPRE en céntimos enteros
// (1250 = 12,50 €) para no arrastrar errores de coma flotante.
//
// state.finance = {
//   currency: 'EUR',
//   since: 'YYYY-MM-DD',                       // alta del módulo: no se piden cobros anteriores
//   accounts:   [{ id, name, emoji, initial }],  // saldo inicial en céntimos
//   categories: [{ id, name, emoji, color, budget }],   // budget mensual en céntimos (opcional)
//   paydays:    [{ id, day, amount, accountId }],       // ingresos fijos: día del mes (1 y 15 por defecto)
//   fixedCosts: [{ id, name, amount, categoryId, accountId, day, frequency, month, createdAt }]
//     gastos fijos (alquiler, suscripciones…): frequency 'monthly' | 'yearly' (month 1–12).
//     Pagarlo crea un gasto con fixedCostId; nunca se marcan solos.
//   transactions: [{ id, type, amount, date, accountId, toAccountId, categoryId, note, paydayId, fixedCostId }]
//     type: 'expense' | 'income' | 'transfer'; amount siempre positivo.
// }
//
// Igual que con los hábitos: saldos, totales y periodos se DERIVAN de las transacciones.

export const CURRENCIES = ['EUR', 'USD', 'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'GBP'];

export const DEFAULT_CATEGORIES = [
  { id: 'cat-super', name: 'Supermercado', emoji: '🛒', color: '#10b981' },
  { id: 'cat-food', name: 'Restaurantes', emoji: '🍽️', color: '#f59e0b' },
  { id: 'cat-transport', name: 'Transporte', emoji: '🚗', color: '#06b6d4' },
  { id: 'cat-home', name: 'Vivienda', emoji: '🏠', color: '#6366f1' },
  { id: 'cat-bills', name: 'Servicios', emoji: '💡', color: '#8b5cf6' },
  { id: 'cat-subs', name: 'Suscripciones', emoji: '📱', color: '#ec4899' },
  { id: 'cat-fun', name: 'Ocio', emoji: '🎉', color: '#ef4444' },
  { id: 'cat-shop', name: 'Compras', emoji: '🛍️', color: '#84cc16' },
  { id: 'cat-health', name: 'Salud', emoji: '❤️', color: '#f43f5e' },
  { id: 'cat-other', name: 'Otros', emoji: '📦', color: '#64748b' },
];

export const ACCOUNT_PRESETS = [
  { name: 'Cuenta corriente', emoji: '🏦' },
  { name: 'Tarjeta de crédito', emoji: '💳' },
  { name: 'Efectivo', emoji: '💵' },
  { name: 'Ahorro', emoji: '🐷' },
];

const uid = (p) => (crypto.randomUUID ? `${p}-${crypto.randomUUID()}` : `${p}-${Date.now()}${Math.random().toString(36).slice(2)}`);
const cents = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null);

// ── Importes

/** "12,50" / "12.5" / "1.234,56" / "€ 8" → céntimos (1250…). null si no es un importe válido. */
export function parseAmount(text) {
  let s = String(text ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return null;
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  // Si el último separador va seguido de 1–2 cifras, es el decimal; el resto son miles
  if (lastSep >= 0 && s.length - lastSep - 1 <= 2) s = s.slice(0, lastSep).replace(/[.,]/g, '') + '.' + s.slice(lastSep + 1);
  else s = s.replace(/[.,]/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

const fmtCache = new Map();
export function formatMoney(c, currency = 'EUR', { sign = false, decimals = true } = {}) {
  const key = `${currency}|${decimals}`;
  if (!fmtCache.has(key)) {
    fmtCache.set(key, new Intl.NumberFormat('es', {
      style: 'currency', currency, minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0,
    }));
  }
  const s = fmtCache.get(key).format(Math.abs(c) / 100);
  if (c < 0) return `−${s}`;
  return sign && c > 0 ? `+${s}` : s;
}

/** Para la entrada: céntimos → "12,50" (sin símbolo). */
export const amountToInput = (c) => (c ? (c / 100).toFixed(2).replace('.', ',').replace(/,00$/, '') : '');

// ── Normalización / migración

export function normalizeFinance(raw, today) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const categories = Array.isArray(f.categories) && f.categories.length ? f.categories : DEFAULT_CATEGORIES;
  return {
    currency: CURRENCIES.includes(f.currency) ? f.currency : 'EUR',
    since: f.since || today,
    accounts: (f.accounts || []).filter((a) => a?.name).map((a) => ({ id: a.id || uid('acc'), name: String(a.name).trim(), emoji: a.emoji || '🏦', initial: cents(a.initial) ?? 0 })),
    categories: categories.filter((c) => c?.name).map((c) => ({ id: c.id || uid('cat'), name: String(c.name).trim(), emoji: c.emoji || '📦', color: c.color || '#64748b', budget: cents(c.budget) })),
    paydays: (Array.isArray(f.paydays) ? f.paydays : [{ day: 1 }, { day: 15 }]).map((p) => ({
      id: p.id || uid('pay'), day: Math.min(31, Math.max(1, Math.round(Number(p.day) || 1))), amount: cents(p.amount), accountId: p.accountId || null,
    })).sort((a, b) => a.day - b.day),
    fixedCosts: (f.fixedCosts || []).map((c) => normalizeFixedCost(c, today)).filter(Boolean),
    transactions: (f.transactions || []).map(normalizeTransaction).filter(Boolean),
  };
}

export function normalizeFixedCost(c, today) {
  const amount = cents(c?.amount);
  const name = String(c?.name || '').trim();
  if (!name || !(amount > 0)) return null;
  const frequency = c.frequency === 'yearly' ? 'yearly' : 'monthly';
  return {
    id: c.id || uid('fix'),
    name,
    amount,
    categoryId: c.categoryId || null,
    accountId: c.accountId || null,
    day: Math.min(31, Math.max(1, Math.round(Number(c.day) || 1))),
    frequency,
    month: frequency === 'yearly' ? Math.min(12, Math.max(1, Math.round(Number(c.month) || 1))) : null,
    createdAt: c.createdAt || today,
  };
}

export function normalizeTransaction(t) {
  const type = ['expense', 'income', 'transfer'].includes(t?.type) ? t.type : 'expense';
  const amount = cents(t?.amount);
  if (!amount || amount <= 0 || !t?.date || !t?.accountId) return null;
  return {
    id: t.id || uid('tx'),
    type,
    amount,
    date: t.date,
    accountId: t.accountId,
    toAccountId: type === 'transfer' ? t.toAccountId || null : null,
    categoryId: type === 'expense' ? t.categoryId || null : null,
    note: String(t.note || '').trim(),
    paydayId: type === 'income' ? t.paydayId || null : null,
    fixedCostId: type === 'expense' ? t.fixedCostId || null : null,
  };
}

export function validateTransaction(t, finance) {
  const errors = {};
  if (!(t.amount > 0)) errors.amount = 'Escribe un importe.';
  if (!finance.accounts.some((a) => a.id === t.accountId)) errors.account = 'Elige una cuenta.';
  if (t.type === 'expense' && !finance.categories.some((c) => c.id === t.categoryId)) errors.category = 'Elige una categoría.';
  if (t.type === 'transfer' && (!t.toAccountId || t.toAccountId === t.accountId)) errors.toAccount = 'Elige otra cuenta de destino.';
  return errors;
}

// ── Cambios (puros: devuelven un finance nuevo)

export function saveTransaction(finance, input) {
  const tx = normalizeTransaction(input);
  if (!tx) return finance;
  const exists = finance.transactions.some((t) => t.id === tx.id);
  return { ...finance, transactions: exists ? finance.transactions.map((t) => (t.id === tx.id ? tx : t)) : [...finance.transactions, tx] };
}

export const deleteTransaction = (finance, id) => ({ ...finance, transactions: finance.transactions.filter((t) => t.id !== id) });

export function saveAccount(finance, input) {
  const acc = { id: input.id || uid('acc'), name: String(input.name || '').trim(), emoji: input.emoji || '🏦', initial: cents(input.initial) ?? 0 };
  if (!acc.name) return finance;
  const exists = finance.accounts.some((a) => a.id === acc.id);
  return { ...finance, accounts: exists ? finance.accounts.map((a) => (a.id === acc.id ? acc : a)) : [...finance.accounts, acc] };
}

/** Una cuenta con movimientos no se borra (perdería historial). */
export const accountInUse = (finance, id) => finance.transactions.some((t) => t.accountId === id || t.toAccountId === id);
export const deleteAccount = (finance, id) => (accountInUse(finance, id) ? finance : {
  ...finance,
  accounts: finance.accounts.filter((a) => a.id !== id),
  paydays: finance.paydays.map((p) => (p.accountId === id ? { ...p, accountId: null } : p)),
});

export function saveCategory(finance, input) {
  const cat = { id: input.id || uid('cat'), name: String(input.name || '').trim(), emoji: input.emoji || '📦', color: input.color || '#64748b', budget: cents(input.budget) || null };
  if (!cat.name) return finance;
  const exists = finance.categories.some((c) => c.id === cat.id);
  return { ...finance, categories: exists ? finance.categories.map((c) => (c.id === cat.id ? cat : c)) : [...finance.categories, cat] };
}

export const categoryInUse = (finance, id) => finance.transactions.some((t) => t.categoryId === id);
export const deleteCategory = (finance, id) => (categoryInUse(finance, id) ? finance : { ...finance, categories: finance.categories.filter((c) => c.id !== id) });

export const savePaydays = (finance, paydays) => normalizeFinance({ ...finance, paydays }, finance.since);

export function saveFixedCost(finance, input, today) {
  const cost = normalizeFixedCost(input, today);
  if (!cost) return finance;
  const exists = finance.fixedCosts.some((c) => c.id === cost.id);
  return { ...finance, fixedCosts: exists ? finance.fixedCosts.map((c) => (c.id === cost.id ? cost : c)) : [...finance.fixedCosts, cost] };
}

/** Borrar un gasto fijo no toca los pagos ya registrados (quedan como gastos normales). */
export const deleteFixedCost = (finance, id) => ({ ...finance, fixedCosts: finance.fixedCosts.filter((c) => c.id !== id) });

// ── Saldos

export function accountBalances(finance, upTo = '9999-12-31') {
  const bal = Object.fromEntries(finance.accounts.map((a) => [a.id, a.initial]));
  for (const t of finance.transactions) {
    if (t.date > upTo) continue;
    if (t.type === 'income') bal[t.accountId] = (bal[t.accountId] ?? 0) + t.amount;
    else bal[t.accountId] = (bal[t.accountId] ?? 0) - t.amount;
    if (t.type === 'transfer' && t.toAccountId) bal[t.toAccountId] = (bal[t.toAccountId] ?? 0) + t.amount;
  }
  return bal;
}

export const totalBalance = (finance) => Object.values(accountBalances(finance)).reduce((a, b) => a + b, 0);

// ── Periodos de cobro (del 1 al 14, del 15 a fin de mes…)

const monthKeyOf = (key) => key.slice(0, 7);
const lastDayOfMonth = (y, m) => new Date(y, m + 1, 0).getDate();

/** Fecha de cobro de un día del mes concreto, recortada a fin de mes (día 31 en febrero → 28/29). */
function paydayIn(y, m, day) {
  return toKey(new Date(y, m, Math.min(day, lastDayOfMonth(y, m))));
}

/** Fechas de cobro entre dos claves, con el payday al que corresponden. */
export function paydayDates(finance, from, to) {
  const out = [];
  const start = fromKey(from);
  const end = fromKey(to);
  for (let y = start.getFullYear(), m = start.getMonth(); y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth()); m === 11 ? (y++, m = 0) : m++) {
    for (const p of finance.paydays) {
      const key = paydayIn(y, m, p.day);
      if (key >= from && key <= to) out.push({ key, payday: p });
    }
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Periodo que contiene `key`: desde el último cobro (incluido) hasta el día antes del siguiente. */
export function payPeriod(finance, key) {
  if (!finance.paydays.length) {
    const d = fromKey(key);
    const start = toKey(new Date(d.getFullYear(), d.getMonth(), 1));
    const next = toKey(new Date(d.getFullYear(), d.getMonth() + 1, 1));
    return { start, end: addDays(next, -1), next };
  }
  const around = paydayDates(finance, addDays(key, -62), addDays(key, 62));
  const prev = [...around].reverse().find((p) => p.key <= key);
  const nxt = around.find((p) => p.key > key);
  return { start: prev.key, end: addDays(nxt.key, -1), next: nxt.key, nextPayday: nxt.payday };
}

const inRange = (t, from, to) => t.date >= from && t.date <= to;
const sumOf = (list) => list.reduce((a, t) => a + t.amount, 0);

/**
 * Resumen del periodo de cobro actual: lo ingresado, lo gastado y cuánto queda por día
 * hasta el siguiente cobro (incluido hoy).
 */
export function periodSummary(finance, today) {
  const p = payPeriod(finance, today);
  const txs = finance.transactions.filter((t) => inRange(t, p.start, p.end));
  const income = sumOf(txs.filter((t) => t.type === 'income'));
  const expenses = sumOf(txs.filter((t) => t.type === 'expense'));
  const opening = paydayDates(finance, p.start, p.start)[0]?.payday; // el cobro que abre el periodo
  const expected = opening?.amount ?? null;
  const daysLeft = diffDays(today, p.end) + 1;
  const left = income - expenses;
  const elapsed = diffDays(p.start, today) + 1;
  // Gastos fijos de este periodo aún sin pagar (vencidos o por venir): ese dinero ya tiene dueño
  const pendingFixed = fixedDues(finance, p.start, p.end).filter((d) => !d.paid);
  const committed = sumOf(pendingFixed);
  const free = left - committed;
  return {
    ...p, income, expenses, left, committed, pendingFixed, free, daysLeft,
    perDay: daysLeft > 0 ? Math.floor(free / daysLeft) : free,
    elapsed, length: diffDays(p.start, p.end) + 1, expected, opening,
  };
}

// ── Gastos fijos

/** Fechas de vencimiento entre dos claves (desde el alta de cada gasto fijo). */
export function fixedDueDates(finance, from, to) {
  const out = [];
  const start = fromKey(from);
  const end = fromKey(to);
  for (let y = start.getFullYear(), m = start.getMonth(); y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth()); m === 11 ? (y++, m = 0) : m++) {
    for (const c of finance.fixedCosts) {
      if (c.frequency === 'yearly' && c.month !== m + 1) continue;
      const key = paydayIn(y, m, c.day);
      if (key >= from && key <= to && key >= c.createdAt) out.push({ key, cost: c });
    }
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.cost.name.localeCompare(b.cost.name)));
}

/** Pago registrado de un vencimiento: gasto con su fixedCostId en los 10 días alrededor (se puede pagar antes). */
export function fixedPayment(finance, cost, key) {
  return finance.transactions.find((t) => t.type === 'expense' && t.fixedCostId === cost.id && Math.abs(diffDays(key, t.date)) <= 10) || null;
}

/** Vencimientos en un rango: { key, amount, cost, paid, payment }. amount = lo pagado si ya se pagó, si no lo previsto. */
export function fixedDues(finance, from, to) {
  return fixedDueDates(finance, from, to).map(({ key, cost }) => {
    const payment = fixedPayment(finance, cost, key);
    return { key, amount: payment ? payment.amount : cost.amount, cost, paid: Boolean(payment), payment };
  });
}

/** Vencidos (hasta hoy) sin pagar, como mucho 45 días atrás: se avisan con un botón "Pagado". */
export function pendingFixedCosts(finance, today) {
  return fixedDues(finance, addDays(today, -45), today).filter((d) => !d.paid);
}

/** Coste fijo mensual equivalente (los anuales cuentan 1/12). */
export function monthlyFixedTotal(finance) {
  return finance.fixedCosts.reduce((a, c) => a + (c.frequency === 'yearly' ? Math.round(c.amount / 12) : c.amount), 0);
}

/** Ingreso mensual esperado según los cobros fijos con importe. */
export const monthlyIncomeExpected = (finance) => finance.paydays.reduce((a, p) => a + (p.amount || 0), 0);

/** Gasto que crea "Pagado": en la fecha de vencimiento (o hoy si aún no ha llegado). */
export function fixedCostPayment(cost, key, today) {
  return { type: 'expense', amount: cost.amount, date: key <= today ? key : today, accountId: cost.accountId, categoryId: cost.categoryId, note: cost.name, fixedCostId: cost.id };
}

// ── Meses y categorías

export const monthKey = (key) => monthKeyOf(key);
export function monthBounds(mk) {
  const [y, m] = mk.split('-').map(Number);
  return { from: `${mk}-01`, to: toKey(new Date(y, m, 0)), days: lastDayOfMonth(y, m - 1) };
}
export function shiftMonth(mk, n) {
  const [y, m] = mk.split('-').map(Number);
  return toKey(new Date(y, m - 1 + n, 1)).slice(0, 7);
}
export const monthLabel = (mk, opts = { month: 'long', year: 'numeric' }) => fromKey(`${mk}-01`).toLocaleDateString('es', opts);

/**
 * Gasto de un mes: total, por categoría (con presupuesto) y por día; y comparación con
 * el mes anterior hasta el mismo día del mes (para que sea justa a mitad de mes).
 */
export function monthSummary(finance, mk, today) {
  const { from, to, days } = monthBounds(mk);
  const expenses = finance.transactions.filter((t) => t.type === 'expense' && inRange(t, from, to));
  const income = sumOf(finance.transactions.filter((t) => t.type === 'income' && inRange(t, from, to)));
  const total = sumOf(expenses);

  const byCat = new Map();
  for (const t of expenses) byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount);
  const categories = finance.categories
    .map((c) => ({ category: c, spent: byCat.get(c.id) || 0, budget: c.budget }))
    .concat(byCat.has(null) ? [{ category: { id: null, name: 'Sin categoría', emoji: '❔', color: '#94a3b8' }, spent: byCat.get(null), budget: null }] : [])
    .filter((r) => r.spent > 0 || r.budget)
    .sort((a, b) => b.spent - a.spent);

  const daily = dateRange(from, to).map((key) => ({ key, amount: sumOf(expenses.filter((t) => t.date === key)) }));

  // Mismo punto del mes anterior
  const isCurrent = mk === monthKeyOf(today);
  const dayOfMonth = isCurrent ? fromKey(today).getDate() : days;
  const prev = shiftMonth(mk, -1);
  const pb = monthBounds(prev);
  const prevTo = toKey(new Date(Number(prev.slice(0, 4)), Number(prev.slice(5)) - 1, Math.min(dayOfMonth, pb.days)));
  const prevSoFar = sumOf(finance.transactions.filter((t) => t.type === 'expense' && inRange(t, pb.from, prevTo)));
  const hasPrev = finance.transactions.some((t) => t.date < from);

  return { mk, from, to, days, total, income, categories, daily, count: expenses.length, dayOfMonth, prevSoFar: hasPrev ? prevSoFar : null, isCurrent };
}

/** Totales de gasto de los últimos `n` meses (incluido el actual). */
export function monthlyTotals(finance, n, today) {
  const cur = monthKeyOf(today);
  return Array.from({ length: n }, (_, i) => {
    const mk = shiftMonth(cur, i - n + 1);
    const { from, to } = monthBounds(mk);
    return { mk, total: sumOf(finance.transactions.filter((t) => t.type === 'expense' && inRange(t, from, to))) };
  });
}

// ── Para que registrar sea un toque

/** Categorías ordenadas por uso en los últimos 60 días (las más usadas primero). */
export function categoriesByUse(finance, today) {
  const since = addDays(today, -60);
  const uses = new Map();
  for (const t of finance.transactions) if (t.type === 'expense' && t.date >= since) uses.set(t.categoryId, (uses.get(t.categoryId) || 0) + 1);
  return [...finance.categories].sort((a, b) => (uses.get(b.id) || 0) - (uses.get(a.id) || 0));
}

/** Cuenta usada en el último movimiento de ese tipo (o la primera). */
export function lastAccountId(finance, type = 'expense') {
  const last = [...finance.transactions].reverse().find((t) => t.type === type && finance.accounts.some((a) => a.id === t.accountId));
  return last?.accountId || finance.accounts[0]?.id || null;
}

/** Gastos repetibles: los últimos distintos (misma categoría, importe, cuenta y nota). */
export function recentExpenses(finance, n = 4) {
  const seen = new Set();
  const out = [];
  // Más reciente primero; a igual fecha, el último añadido (sort estable sobre la lista invertida)
  for (const t of [...finance.transactions].reverse().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))) {
    if (t.type !== 'expense') continue;
    const k = `${t.categoryId}|${t.amount}|${t.accountId}|${t.note.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Cobros esperados que aún no se han registrado (desde el alta del módulo y como mucho
 * 45 días atrás). Un cobro se da por registrado si hay un ingreso con su paydayId en
 * los 5 días alrededor de la fecha.
 */
export function pendingPaydays(finance, today) {
  const from = finance.since > addDays(today, -45) ? finance.since : addDays(today, -45);
  if (from > today) return [];
  return paydayDates(finance, from, today).filter(({ key, payday }) => !finance.transactions.some(
    (t) => t.type === 'income' && t.paydayId === payday.id && Math.abs(diffDays(key, t.date)) <= 5,
  ));
}

// ── Mensajes con cifras concretas (mismo formato que domain/messages.js)

export function financeMessages(finance, today) {
  const out = [];
  const money = (c) => formatMoney(c, finance.currency);
  const push = (kind, priority, text) => out.push({ id: `fin:${out.length}`, kind, priority, text });

  const p = periodSummary(finance, today);
  const nextLabel = fromKey(p.next).toLocaleDateString('es', { day: 'numeric', month: 'short' });
  const days = (n) => `${n} ${n === 1 ? 'día' : 'días'}`;
  if (p.income > 0) {
    if (p.left >= 0 && p.committed > 0) {
      const names = p.pendingFixed.map((d) => `${d.cost.name} ${money(d.amount)}`).join(', ');
      push(p.free < 0 ? 'risk' : p.perDay < p.income / p.length / 2 ? 'risk' : 'goal', 80, p.free >= 0
        ? `Te quedan ${money(p.left)} hasta el cobro del ${nextLabel}; tras los fijos pendientes (${names}), ${money(p.perDay)} al día durante ${days(p.daysLeft)}.`
        : `Te quedan ${money(p.left)} hasta el ${nextLabel}, pero tienes ${money(p.committed)} en fijos pendientes (${names}): faltan ${money(-p.free)}.`);
    } else if (p.left >= 0) {
      push(p.perDay < p.income / p.length / 2 ? 'risk' : 'goal', 80,
        `Te quedan ${money(p.left)} hasta el cobro del ${nextLabel}: ${money(p.perDay)} al día durante ${days(p.daysLeft)}.`);
    } else {
      push('risk', 90, `Llevas ${money(-p.left)} gastados por encima de lo que ingresaste este periodo, y faltan ${p.daysLeft} ${p.daysLeft === 1 ? 'día' : 'días'} para el ${nextLabel}.`);
    }
  }

  // Fijos que vencen en los próximos 3 días (los ya vencidos tienen su propia tarjeta)
  for (const d of fixedDues(finance, addDays(today, 1), addDays(today, 3)).filter((x) => !x.paid)) {
    const n = diffDays(today, d.key);
    const acc = finance.accounts.find((a) => a.id === d.cost.accountId);
    const emoji = finance.categories.find((c) => c.id === d.cost.categoryId)?.emoji || '📌';
    push('today', 70, `${emoji} ${d.cost.name} (${money(d.amount)}) vence ${n === 1 ? 'mañana' : `en ${n} días`}${acc ? ` en ${acc.name}` : ''}.`);
  }
  const fixedMonthly = monthlyFixedTotal(finance);
  const incomeMonthly = monthlyIncomeExpected(finance);
  if (fixedMonthly > 0 && incomeMonthly > 0) {
    push('insight', 30, `Tus gastos fijos suman ${money(fixedMonthly)} al mes: el ${Math.round((fixedMonthly / incomeMonthly) * 100)}% de lo que cobras. Te quedan ${money(incomeMonthly - fixedMonthly)} para el resto.`);
  }

  const m = monthSummary(finance, monthKeyOf(today), today);
  for (const r of m.categories) {
    if (!r.budget) continue;
    const daysLeft = m.days - m.dayOfMonth;
    if (r.spent > r.budget) push('risk', 75, `${r.category.emoji} ${r.category.name}: ${money(r.spent - r.budget)} por encima del presupuesto de ${money(r.budget)}.`);
    else if (r.spent >= r.budget * 0.8) push('today', 65, `${r.category.emoji} ${r.category.name}: llevas ${money(r.spent)} de ${money(r.budget)} y quedan ${daysLeft} días de mes; margen de ${money(r.budget - r.spent)}.`);
  }

  if (m.prevSoFar !== null && m.prevSoFar > 0 && m.total > 0) {
    const diff = m.total - m.prevSoFar;
    const pctv = Math.round((Math.abs(diff) / m.prevSoFar) * 100);
    if (pctv >= 5) {
      push('insight', 40, `Llevas ${money(m.total)} este mes, ${pctv}% ${diff < 0 ? 'menos' : 'más'} que a día ${m.dayOfMonth} del mes pasado (${money(m.prevSoFar)}).`);
    }
  }

  // La categoría que más ha crecido frente al mes anterior completo
  const prevM = monthSummary(finance, shiftMonth(monthKeyOf(today), -1), today);
  const grow = m.categories
    .map((r) => ({ r, prev: prevM.categories.find((x) => x.category.id === r.category.id)?.spent || 0 }))
    .filter((x) => x.prev > 0 && x.r.spent > x.prev)
    .sort((a, b) => (b.r.spent - b.prev) - (a.r.spent - a.prev))[0];
  if (grow) push('insight', 35, `${grow.r.category.emoji} ${grow.r.category.name} ya supera todo el mes pasado: ${money(grow.r.spent)} frente a ${money(grow.prev)}.`);

  return out.sort((a, b) => b.priority - a.priority);
}
