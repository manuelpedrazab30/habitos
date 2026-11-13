import { test, eq, ok } from './runner.js';
import {
  accountBalances, categoriesByUse, deleteAccount, financeMessages, formatMoney, lastAccountId, monthSummary,
  normalizeFinance, parseAmount, payPeriod, pendingPaydays, periodSummary, recentExpenses, saveTransaction,
  validateTransaction, fixedDueDates, fixedDues, pendingFixedCosts, monthlyFixedTotal, fixedCostPayment, saveFixedCost,
  deleteFixedCost, saveRecurringTransfer, deleteRecurringTransfer, transferDueDates, pendingTransfers, recurringTransferTx,
  reserveBalance, spendingBalance, headline, saveMainBalance,
} from '../src/domain/finance.js';

const T = '2026-11-11'; // miércoles

function base(extra = {}) {
  return normalizeFinance({
    since: '2026-10-01',
    accounts: [{ id: 'bank', name: 'Banco', initial: 100000 }, { id: 'card', name: 'Tarjeta', initial: 0 }],
    paydays: [{ id: 'p1', day: 1, amount: 125000, accountId: 'bank' }, { id: 'p15', day: 15, amount: 125000, accountId: 'bank' }],
    ...extra,
  }, T);
}
const exp = (id, amount, date, categoryId = 'cat-food', accountId = 'card', note = '') => ({ id, type: 'expense', amount, date, categoryId, accountId, note });

test('finance: parseAmount entiende formatos españoles y anglosajones', () => {
  eq(parseAmount('12,50'), 1250);
  eq(parseAmount('12.5'), 1250);
  eq(parseAmount('1.234,56'), 123456);
  eq(parseAmount('1,234.56'), 123456);
  eq(parseAmount('1.200'), 120000, 'tres cifras tras el punto = miles');
  eq(parseAmount('€ 8'), 800);
  eq([parseAmount(''), parseAmount('0'), parseAmount('-5'), parseAmount('abc')], [null, null, null, null]);
});
test('finance: formatMoney con signo', () => {
  ok(formatMoney(1250, 'EUR').includes('12,50'));
  ok(formatMoney(-500, 'EUR').startsWith('−'));
  ok(formatMoney(500, 'EUR', { sign: true }).startsWith('+'));
});
test('finance: normalizeFinance pone categorías y cobros 1 y 15 por defecto', () => {
  const f = normalizeFinance(null, T);
  eq(f.paydays.map((p) => p.day), [1, 15]);
  ok(f.categories.length >= 8);
  eq([f.currency, f.since, f.accounts, f.transactions], ['EUR', T, [], []]);
});
test('finance: periodos de cobro del 1 al 14 y del 15 a fin de mes', () => {
  const f = base();
  eq(payPeriod(f, T), { start: '2026-11-01', end: '2026-11-14', next: '2026-11-15', nextPayday: f.paydays[1] });
  const p2 = payPeriod(f, '2026-11-15');
  eq([p2.start, p2.end, p2.next], ['2026-11-15', '2026-11-30', '2026-12-01']);
  const p3 = payPeriod(f, '2026-12-31');
  eq([p3.start, p3.next], ['2026-12-15', '2027-01-01']);
  const late = normalizeFinance({ paydays: [{ day: 31 }] }, T);
  eq(payPeriod(late, '2027-02-28').start, '2027-02-28', 'día 31 en febrero = último día');
});
test('finance: resumen del periodo y dinero por día hasta el cobro', () => {
  let f = base();
  f = saveTransaction(f, { type: 'income', amount: 125000, date: '2026-11-01', accountId: 'bank', paydayId: 'p1' });
  f = saveTransaction(f, exp('a', 10000, '2026-11-03'));
  f = saveTransaction(f, exp('b', 5000, T));
  f = saveTransaction(f, exp('old', 99900, '2026-10-30')); // periodo anterior
  const p = periodSummary(f, T);
  eq([p.income, p.expenses, p.left, p.daysLeft, p.perDay, p.expected], [125000, 15000, 110000, 4, 27500, 0]);
  const msg = financeMessages(f, T)[0].text;
  ok(msg.includes('hasta el cobro del 15') && msg.includes('al día durante 4 días'), msg);
});
test('finance: saldos con ingresos, gastos y transferencias', () => {
  let f = base();
  f = saveTransaction(f, { type: 'income', amount: 125000, date: '2026-11-01', accountId: 'bank' });
  f = saveTransaction(f, exp('a', 2000, '2026-11-02', 'cat-food', 'card'));
  f = saveTransaction(f, { type: 'transfer', amount: 2000, date: '2026-11-03', accountId: 'bank', toAccountId: 'card' });
  eq(accountBalances(f), { bank: 223000, card: 0 });
  eq(accountBalances(f, '2026-11-02'), { bank: 225000, card: -2000 });
  eq(deleteAccount(f, 'card').accounts.length, 2, 'con movimientos no se borra');
});
test('finance: gasto del mes por categoría y comparación al mismo día del mes pasado', () => {
  let f = base({ categories: [{ id: 'cat-food', name: 'Restaurantes', budget: 20000 }, { id: 'cat-super', name: 'Super' }] });
  f = saveTransaction(f, exp('a', 16500, '2026-11-02'));
  f = saveTransaction(f, exp('b', 2000, '2026-11-05', 'cat-super'));
  f = saveTransaction(f, exp('c', 10000, '2026-10-04'));
  f = saveTransaction(f, exp('d', 50000, '2026-10-20')); // después del día 11: no cuenta en la comparación
  const m = monthSummary(f, '2026-11', T);
  eq([m.total, m.categories[0].category.id, m.categories[0].spent, m.categories[0].budget], [18500, 'cat-food', 16500, 20000]);
  eq([m.dayOfMonth, m.prevSoFar], [11, 10000]);
  eq(m.daily.length, 30);
  const msgs = financeMessages(f, T).map((x) => x.text);
  ok(msgs.some((t) => t.includes('Restaurantes: llevas 165,00') && t.includes('de 200,00')), JSON.stringify(msgs));
  ok(msgs.some((t) => t.includes('85% más que a día 11 del mes pasado')), JSON.stringify(msgs));
});
test('finance: cobros pendientes de registrar', () => {
  let f = base({ since: '2026-11-01' });
  eq(pendingPaydays(f, T).map((x) => x.key), ['2026-11-01']);
  f = saveTransaction(f, { type: 'income', amount: 125000, date: '2026-11-02', accountId: 'bank', paydayId: 'p1' });
  eq(pendingPaydays(f, T), []);
  eq(pendingPaydays(base({ since: '2026-11-05' }), T), [], 'no pide cobros de antes del alta');
});
test('finance: atajos para registrar en un toque', () => {
  let f = base();
  f = saveTransaction(f, exp('a', 250, '2026-11-09', 'cat-food', 'card', 'Café'));
  f = saveTransaction(f, exp('b', 250, '2026-11-10', 'cat-food', 'card', 'café'));
  f = saveTransaction(f, exp('c', 4000, '2026-11-10', 'cat-super', 'bank'));
  eq(recentExpenses(f).map((t) => t.id), ['c', 'b'], 'sin repetir el mismo gasto, lo último primero');
  eq(categoriesByUse(f, T)[0].id, 'cat-food');
  eq(lastAccountId(f), 'bank');
  eq(lastAccountId(f, 'income'), 'bank', 'sin ingresos: la primera cuenta');
});
test('finance: validación de movimientos', () => {
  const f = base();
  eq(Object.keys(validateTransaction({ type: 'expense', amount: null, accountId: 'x' }, f)).sort(), ['account', 'amount', 'category']);
  eq(validateTransaction({ type: 'expense', amount: 100, accountId: 'bank', categoryId: 'cat-food' }, f), {});
  ok(validateTransaction({ type: 'transfer', amount: 100, accountId: 'bank', toAccountId: 'bank' }, f).toAccount);
  eq(saveTransaction(f, { type: 'expense', amount: 0, date: T, accountId: 'bank' }).transactions.length, 0, 'importe 0 no se guarda');
});

// ── Gastos fijos
const withFixed = (extra = {}) => {
  let f = base(extra);
  f = saveFixedCost(f, { id: 'rent', name: 'Alquiler', amount: 75000, day: 1, categoryId: 'cat-home', accountId: 'bank', createdAt: '2026-10-01' }, T);
  f = saveFixedCost(f, { id: 'gym', name: 'Gimnasio', amount: 3500, day: 13, categoryId: 'cat-health', accountId: 'card', createdAt: '2026-10-01' }, T);
  f = saveFixedCost(f, { id: 'ins', name: 'Seguro', amount: 36000, day: 31, frequency: 'yearly', month: 2, accountId: 'bank', createdAt: '2026-10-01' }, T);
  return f;
};
test('fixed: vencimientos mensuales y anuales (día 31 en febrero = último día)', () => {
  const f = withFixed();
  eq(fixedDueDates(f, '2026-11-01', '2026-11-30').map((d) => `${d.key} ${d.cost.id}`), ['2026-11-01 rent', '2026-11-13 gym']);
  eq(fixedDueDates(f, '2027-02-01', '2027-02-28').map((d) => d.key), ['2027-02-01', '2027-02-13', '2027-02-28']);
  eq(fixedDueDates(withFixed(), '2026-09-01', '2026-09-30'), [], 'nada antes del alta');
  eq(monthlyFixedTotal(f), 75000 + 3500 + 3000, 'el anual cuenta 1/12');
  eq(saveFixedCost(f, { name: '', amount: 100 }, T).fixedCosts.length, 3, 'sin nombre no se guarda');
});
test('fixed: pagado = gasto con su fixedCostId cerca de la fecha; pendientes hasta hoy', () => {
  let f = withFixed();
  eq(pendingFixedCosts(f, T).map((d) => d.key), ['2026-10-01', '2026-10-13', '2026-11-01']);
  f = saveTransaction(f, { ...fixedCostPayment(f.fixedCosts[0], '2026-11-01', T), id: 'p1' });
  eq(f.transactions[0], { id: 'p1', type: 'expense', amount: 75000, date: '2026-11-01', accountId: 'bank', toAccountId: null, categoryId: 'cat-home', note: 'Alquiler', paydayId: null, fixedCostId: 'rent', recurringId: null });
  f = saveTransaction(f, { ...fixedCostPayment(f.fixedCosts[0], '2026-10-01', T), id: 'p0', amount: 74000 });
  const due = fixedDues(f, '2026-10-01', '2026-10-31')[0];
  eq([due.paid, due.amount], [true, 74000], 'importe real pagado');
  eq(fixedCostPayment(f.fixedCosts[1], '2026-11-13', T).date, T, 'pagar por adelantado = hoy');
  eq(deleteFixedCost(f, 'rent').transactions.length, 2, 'borrar el fijo conserva los pagos');
});
test('fixed: lo pendiente del periodo se descuenta de lo disponible por día', () => {
  let f = withFixed();
  f = saveTransaction(f, { type: 'income', amount: 125000, date: '2026-11-01', accountId: 'bank', paydayId: 'p1' });
  f = saveTransaction(f, { ...fixedCostPayment(f.fixedCosts[0], '2026-11-01', T) });
  const p = periodSummary(f, T);
  eq([p.left, p.committed, p.free, p.perDay], [50000, 3500, 46500, 11625]);
  eq(p.pendingFixed.map((d) => d.cost.name), ['Gimnasio']);
  const msgs = financeMessages(f, T).map((x) => x.text);
  ok(msgs.some((t) => t.includes('tras los fijos pendientes (Gimnasio 35,00') && t.includes('116,25')), JSON.stringify(msgs));
  ok(msgs.some((t) => t.includes('Gimnasio (35,00') && t.includes('vence en 2 días en Tarjeta')), JSON.stringify(msgs));
  ok(msgs.some((t) => t.includes('Tus gastos fijos suman 815,00') && t.includes('33% de lo que cobras')), JSON.stringify(msgs));
});

// ── Transferencias periódicas entre cuentas
test('transfers: periódica los días 1 y 15, pendientes hasta hoy y "Hecho"', () => {
  let f = base();
  f = saveRecurringTransfer(f, { id: 'cash', name: 'Efectivo', amount: 20000, fromAccountId: 'bank', toAccountId: 'card', days: [15, 1], createdAt: '2026-10-01' }, T);
  eq(f.recurringTransfers[0].days, [1, 15], 'días ordenados');
  eq(transferDueDates(f, '2026-10-01', '2026-11-30').map((d) => d.key), ['2026-10-01', '2026-10-15', '2026-11-01', '2026-11-15']);
  eq(pendingTransfers(f, T).map((d) => d.key), ['2026-10-15', '2026-11-01'], 'máx. 30 días atrás, hasta hoy');
  f = saveTransaction(f, { ...recurringTransferTx(f.recurringTransfers[0], '2026-11-01', T), id: 't1' });
  eq(f.transactions[0].recurringId, 'cash');
  eq(pendingTransfers(f, T).map((d) => d.key), ['2026-10-15'], 'la del 1 ya está hecha');
  eq(accountBalances(f), { bank: 80000, card: 20000 }, 'mueve dinero sin gastarlo');
  eq(deleteRecurringTransfer(f, 'cash').transactions.length, 1, 'borrarla conserva las hechas');
});
test('transfers: validación (cuentas distintas, importe y algún día)', () => {
  const f = base();
  eq(saveRecurringTransfer(f, { amount: 100, fromAccountId: 'bank', toAccountId: 'bank', days: [1] }, T).recurringTransfers.length, 0);
  eq(saveRecurringTransfer(f, { amount: 0, fromAccountId: 'bank', toAccountId: 'card', days: [1] }, T).recurringTransfers.length, 0);
  eq(saveRecurringTransfer(f, { amount: 100, fromAccountId: 'bank', toAccountId: 'card', days: [40] }, T).recurringTransfers.length, 0);
  eq(normalizeFinance({ ...f, recurringTransfers: undefined }, T).recurringTransfers, [], 'datos antiguos sin el campo');
});

// ── Cuenta de reserva: el dinero del periodo sale de transferencias desde la reserva
function reserveSetup() {
  let f = normalizeFinance({
    since: '2026-10-01',
    accounts: [{ id: 'save', name: 'Ahorro', initial: 1000000, reserve: true }, { id: 'cash', name: 'Efectivo', initial: 0 }],
    paydays: [{ id: 'p1', day: 1 }, { id: 'p15', day: 15 }], // sin importe: no hay nómina
  }, T);
  f = saveRecurringTransfer(f, { id: 'q', name: 'Quincena', amount: 50000, fromAccountId: 'save', toAccountId: 'cash', days: [1, 15], createdAt: '2026-10-01' }, T);
  return saveTransaction(f, exp('e1', 12000, '2026-11-05', 'cat-food', 'cash'));
}
test('reserve: sin haber pasado aún el dinero, el periodo no sale en negativo', () => {
  const p = periodSummary(reserveSetup(), T);
  eq([p.received, p.expected, p.funds, p.expenses, p.left, p.free], [0, 50000, 50000, 12000, 38000, 38000]);
  eq(p.pendingItems.map((x) => [x.kind, x.key, x.amount]), [['transfer', '2026-11-01', 50000]]);
  const msg = financeMessages(reserveSetup(), T)[0].text;
  ok(msg.includes('Te quedan 380,00') && msg.includes('aún por pasar desde tu reserva'), msg);
});
test('reserve: al hacer la transferencia cuenta como recibido y deja de estar pendiente', () => {
  let f = reserveSetup();
  f = saveTransaction(f, recurringTransferTx(f.recurringTransfers[0], '2026-11-01', T));
  const p = periodSummary(f, T);
  eq([p.fromReserve, p.received, p.expected, p.left], [50000, 50000, 0, 38000]);
  eq([reserveBalance(f), spendingBalance(f)], [950000, 38000]);
});
test('reserve: ingresos a la reserva no son para gastar; apartar a la reserva resta', () => {
  let f = reserveSetup();
  f = saveTransaction(f, { type: 'income', amount: 300000, date: '2026-11-02', accountId: 'save' });
  f = saveTransaction(f, exp('e2', 99999, '2026-11-03', 'cat-shop', 'save')); // gasto pagado desde la reserva
  eq(periodSummary(f, T).left, 38000, 'ni el ingreso ni el gasto de la reserva cambian el periodo');
  f = saveTransaction(f, { type: 'transfer', amount: 10000, date: '2026-11-06', accountId: 'cash', toAccountId: 'save' });
  eq([periodSummary(f, T).saved, periodSummary(f, T).left], [10000, 28000]);
});
test('reserve: un cobro con importe aún sin registrar también cuenta como pendiente', () => {
  const f = base({ since: '2026-11-01' });
  const p = periodSummary(f, T);
  eq([p.received, p.expected, p.funds], [0, 125000, 125000]);
  eq(p.pendingItems[0].kind, 'payday');
});
test('reserve: los cobros sin importe que coinciden con la transferencia desde la reserva no piden registrarse', () => {
  const f = reserveSetup();
  eq(pendingPaydays(f, T), [], 'el 1 y el 15 los cubre la transferencia de la reserva');
  const g = { ...f, recurringTransfers: [] };
  eq(pendingPaydays(g, T).map((x) => x.key), ['2026-10-01', '2026-10-15', '2026-11-01'], 'sin transferencia sí se piden');
});

test('headline: por defecto "para gastar" del periodo', () => {
  const hl = headline(reserveSetup(), T);
  eq([hl.mode, hl.value], ['period', 38000]);
});
test('headline: saldo de una cuenta, con lo que llega y los fijos que salen de ella', () => {
  let f = saveMainBalance(reserveSetup(), 'cash');
  let hl = headline(f, T);
  // Efectivo: −120 € de saldo (la quincena del día 1 aún no se ha pasado: +500 € por llegar)
  eq([hl.mode, hl.account.id, hl.value, hl.incoming, hl.fixed, hl.available, hl.daysLeft, hl.perDay], ['account', 'cash', -12000, 50000, 0, 38000, 4, 9500]);
  f = saveFixedCost(f, { id: 'gym', name: 'Gimnasio', amount: 3500, day: 13, categoryId: 'cat-health', accountId: 'cash', createdAt: '2026-10-01' }, T);
  f = saveTransaction(f, recurringTransferTx(f.recurringTransfers[0], '2026-11-01', T));
  hl = headline(f, T);
  eq([hl.value, hl.incoming, hl.fixed, hl.available, hl.perDay], [38000, 0, 3500, 34500, 8625]);
});
test('headline: saldo total y vuelta a "para gastar" si la cuenta ya no existe', () => {
  const f = reserveSetup();
  eq(headline(saveMainBalance(f, 'total'), T).value, 988000);
  eq(saveMainBalance(f, 'nope').mainBalance, null, 'una cuenta desconocida no se guarda');
  eq(headline({ ...f, mainBalance: 'gone' }, T).mode, 'period');
  eq(normalizeFinance({ ...f, mainBalance: 'gone' }, T).mainBalance, null);
  eq(normalizeFinance({ ...f, mainBalance: 'cash' }, T).mainBalance, 'cash', 'se conserva al recargar');
});
