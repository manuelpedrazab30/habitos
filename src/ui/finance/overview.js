import { diffDays, formatDate, fromKey } from '../../domain/dates.js';
import {
  ACCOUNT_PRESETS, accountBalances, CURRENCIES, financeMessages, formatMoney, monthKey, monthLabel, monthlyTotals,
  monthSummary, normalizeFinance, parseAmount, payPeriod, pendingPaydays, periodSummary, saveAccount, saveTransaction, shiftMonth,
  fixedCostPayment, fixedDues, monthBounds, monthlyFixedTotal, monthlyIncomeExpected, pendingFixedCosts,
  pendingTransfers, recurringTransferTx, reserveBalance,
} from '../../domain/finance.js';
import { h } from '../dom.js';
import { barChart, ring } from '../charts.js';
import { txRow } from './transactions.js';
import { accountSheet, fixedCostSheet } from './accounts.js';

/** Resumen de finanzas: cobros pendientes, lo que queda hasta el próximo cobro, gasto del mes y saldos. */
export function financeOverviewView(state, ctx) {
  const fin = state.finance;
  if (!fin.accounts.length) return setupView(fin, ctx);

  const today = ctx.today();
  const money = (c, o) => formatMoney(c, fin.currency, o);
  const mk = ctx.ui.month || monthKey(today);
  const p = periodSummary(fin, today);
  const m = monthSummary(fin, mk, today);
  const pending = pendingPaydays(fin, today);
  const dueFixed = pendingFixedCosts(fin, today);
  const dueTransfers = pendingTransfers(fin, today);
  const catOf = (id) => fin.categories.find((c) => c.id === id);
  const messages = financeMessages(fin, today).filter((x) => x.priority < 80 || p.funds === 0).slice(0, 3); // el "te quedan" ya está en la tarjeta
  const balances = accountBalances(fin);
  const total = Object.values(balances).reduce((a, b) => a + b, 0);
  const hasReserve = fin.accounts.some((a) => a.reserve);
  // Transferencias periódicas que ya tocaban y no se han hecho: lo que va a llegar a cada cuenta
  const incoming = {};
  for (const { rt } of dueTransfers) incoming[rt.toAccountId] = (incoming[rt.toAccountId] || 0) + rt.amount;
  const recent = [...fin.transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 5);
  const accName = (id) => fin.accounts.find((a) => a.id === id);
  const maxCat = Math.max(1, ...m.categories.map((r) => Math.max(r.spent, r.budget || 0)));

  return h('section', { class: 'view finance' },
    // Cobros del 1 y del 15 sin registrar: un toque
    pending.map(({ key, payday }) => h('div', { class: 'card payday' },
      h('span', { class: 'emoji' }, '💰'),
      h('div', { class: 'payday-text' },
        h('strong', {}, `Cobro del ${formatDate(key, { day: 'numeric', month: 'long' })}`),
        h('p', { class: 'muted small' }, payday.amount ? `${money(payday.amount)} en ${accName(payday.accountId)?.name || 'tu cuenta'}` : '¿Cuánto has recibido?'),
      ),
      payday.amount && payday.accountId
        ? h('button', { class: 'btn primary small', onClick: () => ctx.saveFinance(
          saveTransaction(fin, { type: 'income', amount: payday.amount, date: key, accountId: payday.accountId, paydayId: payday.id, note: 'Cobro' }),
          `Ingreso de ${money(payday.amount)} registrado`,
        ) }, 'Registrar')
        : null,
      h('button', { class: 'btn ghost small', onClick: () => ctx.openEntry({ type: 'income', tx: { type: 'income', amount: payday.amount, date: key, accountId: payday.accountId, paydayId: payday.id, note: 'Cobro' } }) }, payday.amount ? 'Otro importe' : 'Registrar'),
    )),

    // Gastos fijos vencidos sin marcar: un toque
    dueFixed.map(({ key, cost }) => h('div', { class: 'card payday fixed-due' },
      h('span', { class: 'emoji' }, catOf(cost.categoryId)?.emoji || '📌'),
      h('div', { class: 'payday-text' },
        h('strong', {}, `${cost.name} · ${money(cost.amount)}`),
        h('p', { class: 'muted small' }, `${key === today ? 'Vence hoy' : `Venció el ${formatDate(key, { day: 'numeric', month: 'long' })}`}${accName(cost.accountId) ? ` · ${accName(cost.accountId).name}` : ''}`),
      ),
      cost.accountId && accName(cost.accountId)
        ? h('button', { class: 'btn primary small', onClick: () => ctx.saveFinance(saveTransaction(fin, fixedCostPayment(cost, key, today)), `${cost.name}: ${money(cost.amount)} pagado`) }, 'Pagado')
        : null,
      h('button', { class: 'btn ghost small', onClick: () => ctx.openEntry({ tx: fixedCostPayment(cost, key, today) }) }, cost.accountId ? 'Otro importe' : 'Registrar'),
    )),

    // Transferencias periódicas que tocan (p. ej. a efectivo cada 1 y 15): un toque
    dueTransfers.map(({ key, rt }) => h('div', { class: 'card payday transfer-due' },
      h('span', { class: 'emoji' }, '⇄'),
      h('div', { class: 'payday-text' },
        h('strong', {}, `${rt.name || 'Pasar dinero'} · ${money(rt.amount)}`),
        h('p', { class: 'muted small' }, `${accName(rt.fromAccountId)?.name || '?'} → ${accName(rt.toAccountId)?.name || '?'} · ${key === today ? 'toca hoy' : `tocaba el ${formatDate(key, { day: 'numeric', month: 'long' })}`}`),
      ),
      accName(rt.fromAccountId) && accName(rt.toAccountId)
        ? h('button', { class: 'btn primary small', onClick: () => ctx.saveFinance(saveTransaction(fin, recurringTransferTx(rt, key, today)), `${money(rt.amount)} pasados a ${accName(rt.toAccountId).name}`) }, 'Hecho')
        : null,
      h('button', { class: 'btn ghost small', onClick: () => ctx.openEntry({ tx: recurringTransferTx(rt, key, today) }) }, 'Otro importe'),
    )),

    // Periodo de cobro actual
    h('div', { class: 'card period' },
      h('div', { class: 'period-top' },
        ring(p.funds ? Math.min(1, p.expenses / p.funds) : 0, { size: 76, stroke: 8, color: p.left < 0 ? 'var(--bad)' : 'var(--good)', label: p.funds ? `${Math.round((p.expenses / p.funds) * 100)}%` : '—' }),
        h('div', { class: 'period-main' },
          h('small', { class: 'muted' }, `Del ${formatDate(p.start)} al ${formatDate(p.end)} · cobro en ${p.daysLeft} ${p.daysLeft === 1 ? 'día' : 'días'}`),
          h('div', { class: `money-big ${p.free < 0 ? 'neg' : ''}` }, p.funds ? money(p.free) : money(-p.expenses)),
          h('small', { class: 'muted' }, p.funds
            ? (p.free >= 0 ? `para gastar · ${money(p.perDay)} al día${p.committed ? ' (ya descontados los fijos)' : ''}` : p.left >= 0 ? 'te faltan para cubrir los fijos pendientes' : 'por encima de lo ingresado')
            : 'gastado este periodo (registra tu cobro, o una transferencia periódica desde tu reserva, para ver lo que te queda)'),
        ),
      ),
      h('div', { class: 'period-stats' },
        stat(p.fromReserve || p.expected ? 'Recibido' : 'Ingresado', money(p.received), 'pos'),
        stat('Gastado', money(p.expenses), 'neg'),
        p.committed ? stat('Fijos pendientes', money(p.committed), 'warn')
          : hasReserve ? stat('Reserva', money(reserveBalance(fin))) : stat('Saldo total', money(total)),
      ),
      // Dinero que entra este periodo pero aún no se ha movido: ya cuenta en "para gastar"
      p.pendingItems.length ? h('p', { class: 'muted small pending-line' }, p.pendingItems.map((x) => (x.kind === 'transfer'
        ? `+${money(x.amount)} por pasar desde ${accName(x.rt.fromAccountId)?.name || 'tu reserva'} (día ${Number(x.key.slice(8))})`
        : `+${money(x.amount)} de cobro por registrar (día ${Number(x.key.slice(8))})`)).join(' · '), ' · ya incluido arriba') : null,
      p.saved ? h('p', { class: 'muted small pending-line' }, `${money(p.saved)} apartados a tu reserva este periodo.`) : null,
      h('button', { class: 'btn primary big-add', onClick: () => ctx.openEntry() }, '＋ Añadir gasto'),
    ),

    messages.length ? h('ul', { class: 'messages' }, messages.map((x) => h('li', { class: `msg ${x.kind}` }, x.text))) : null,

    fixedCard(fin, ctx, today, money, catOf, accName),

    // Gasto del mes por categoría
    h('div', { class: 'card' },
      h('div', { class: 'card-head month-head' },
        h('button', { class: 'icon-btn small', 'aria-label': 'Mes anterior', onClick: () => { ctx.ui.month = shiftMonth(mk, -1); ctx.rerender(); } }, '‹'),
        h('div', { class: 'center' }, h('h2', {}, cap(monthLabel(mk))), h('div', { class: 'money-mid' }, money(m.total)),
          m.prevSoFar !== null && m.prevSoFar > 0 ? h('small', { class: m.total <= m.prevSoFar ? 'pos' : 'neg' },
            `${m.total <= m.prevSoFar ? '▼' : '▲'} ${money(Math.abs(m.total - m.prevSoFar))} vs. ${m.isCurrent ? `día ${m.dayOfMonth} del mes pasado` : 'el mes anterior'}`) : null),
        h('button', { class: 'icon-btn small', 'aria-label': 'Mes siguiente', disabled: mk >= monthKey(today), onClick: () => { ctx.ui.month = shiftMonth(mk, 1); ctx.rerender(); } }, '›'),
      ),
      m.categories.length
        ? h('ul', { class: 'cat-list' }, m.categories.map((r) => h('li', {},
          h('button', { class: 'cat-row', style: { '--c': r.category.color }, onClick: () => { ctx.ui.txFilter = { categoryId: r.category.id }; ctx.go('#/finanzas/movimientos'); } },
            h('span', { class: 'emoji' }, r.category.emoji),
            h('span', { class: 'cat-name' }, r.category.name),
            h('span', { class: 'cat-amount' }, money(r.spent), r.budget ? h('small', { class: 'muted' }, ` / ${money(r.budget, { decimals: false })}`) : null),
            h('span', { class: `bar ${r.budget && r.spent > r.budget ? 'over' : ''}` },
              h('span', { style: { width: `${(Math.min(r.spent, r.budget || r.spent) / (r.budget || maxCat)) * 100}%` } })),
          ))))
        : h('p', { class: 'muted' }, 'Sin gastos este mes.'),
    ),

    m.total ? dailyCard(m, money) : null,

    h('div', { class: 'card' },
      h('h2', {}, 'Últimos 6 meses'),
      barChart({
        bars: monthlyTotals(fin, 6, today).map((x) => ({
          label: monthLabel(x.mk, { month: 'short' }).replace('.', ''), value: Math.round(x.total / 100), highlight: x.mk === mk,
          tip: `<b>${cap(monthLabel(x.mk))}</b><br>${money(x.total)} gastados`,
        })),
        color: 'var(--accent)', format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')}k` : String(v)), height: 160,
      }),
    ),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Cuentas'),
        h('div', { class: 'head-actions' },
          fin.accounts.length > 1 ? h('button', { class: 'btn ghost small', onClick: () => ctx.openEntry({ type: 'transfer' }) }, '⇄ Mover dinero') : null,
          h('a', { href: '#/finanzas/cuentas', class: 'small' }, 'Editar'))),
      h('div', { class: 'acc-strip' }, fin.accounts.map((a) => h('div', { class: 'acc-chip' },
        h('button', { class: 'acc-main', 'aria-label': `Movimientos de ${a.name}`, onClick: () => { ctx.ui.txFilter = { accountId: a.id }; ctx.go('#/finanzas/movimientos'); } },
          h('span', { class: 'emoji' }, a.emoji), h('span', { class: 'acc-name' }, a.name, a.reserve ? h('span', { class: 'tag reserve-tag' }, 'Reserva') : null), h('b', { class: balances[a.id] < 0 ? 'neg' : '' }, money(balances[a.id] ?? 0)),
          incoming[a.id] ? h('small', { class: 'acc-incoming pos' }, `+${money(incoming[a.id])} por llegar`) : null),
        h('button', { class: 'acc-edit', 'aria-label': `Editar ${a.name}`, title: 'Editar nombre y saldo', onClick: () => accountSheet(ctx, a) }, '✎'),
      ))),
    ),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Últimos movimientos'), h('a', { href: '#/finanzas/movimientos', class: 'small' }, 'Ver todos')),
      recent.length ? h('div', { class: 'tx-list' }, recent.map((t) => txRow(t, fin, ctx))) : h('p', { class: 'muted' }, 'Aún no hay movimientos. Pulsa “＋ Añadir gasto”.'),
    ),
  );
}

/**
 * Gastos fijos: total mensual (y % de lo que cobras) y el estado de cada vencimiento
 * de este mes. Sin ninguno, una invitación a añadirlos.
 */
function fixedCard(fin, ctx, today, money, catOf, accName) {
  if (!fin.fixedCosts.length) {
    return h('div', { class: 'card invite' },
      h('h2', {}, '¿Tienes gastos fijos?'),
      h('p', { class: 'muted' }, 'Alquiler, suscripciones, gimnasio… Añádelos una vez: te recordaré cada vencimiento y lo que puedes gastar ya los tendrá descontados.'),
      h('button', { class: 'btn ghost', onClick: () => fixedCostSheet(ctx) }, '＋ Añadir gasto fijo'),
    );
  }
  const { from, to } = monthBounds(today.slice(0, 7));
  const dues = fixedDues(fin, from, to);
  const monthly = monthlyFixedTotal(fin);
  const income = monthlyIncomeExpected(fin);
  const paidSum = dues.filter((d) => d.paid).reduce((a, d) => a + d.amount, 0);
  const status = (d) => {
    if (d.paid) return h('span', { class: 'tag up' }, `✓ ${formatDate(d.payment.date)}`);
    const n = diffDays(today, d.key);
    if (n < 0) return h('span', { class: 'tag stall' }, 'Vencido');
    if (n === 0) return h('span', { class: 'tag stall' }, 'Hoy');
    return h('span', { class: 'tag' }, n === 1 ? 'Mañana' : `En ${n} días`);
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', {}, 'Gastos fijos'),
        h('small', { class: 'muted' }, `${money(monthly)} al mes${income ? ` · ${Math.round((monthly / income) * 100)}% de lo que cobras` : ''}`)),
      h('a', { href: '#/finanzas/cuentas', class: 'small' }, 'Editar')),
    dues.length ? h('ul', { class: 'plain fixed-list' }, dues.map((d) => h('li', { class: d.paid ? 'paid' : '' },
      h('span', { class: 'emoji' }, catOf(d.cost.categoryId)?.emoji || '📌'),
      h('span', { class: 'fx-text' }, h('b', {}, d.cost.name), h('small', { class: 'muted' }, `Día ${fromKey(d.key).getDate()}${accName(d.cost.accountId) ? ` · ${accName(d.cost.accountId).name}` : ''}`)),
      h('span', { class: 'fx-amount' }, money(d.amount)),
      status(d),
      !d.paid && d.cost.accountId ? h('button', { class: 'btn ghost small', onClick: () => ctx.saveFinance(saveTransaction(fin, fixedCostPayment(d.cost, d.key, today)), `${d.cost.name}: ${money(d.cost.amount)} pagado`) }, 'Pagar') : null,
    ))) : h('p', { class: 'muted small' }, 'Ningún vencimiento este mes.'),
    dues.length ? h('p', { class: 'muted small' }, `Pagado este mes: ${money(paidSum)} de ${money(dues.reduce((a, d) => a + d.amount, 0))}.`) : null,
  );
}

/**
 * Gasto por día del mes. Un gasto grande (alquiler) aplastaría el resto de barras, así
 * que la escala se corta en ~1,6× el percentil 85 de los días con gasto; esos días
 * salen en naranja y el tooltip da el importe real.
 */
function dailyCard(m, money) {
  const nonZero = m.daily.map((d) => d.amount).filter(Boolean).sort((a, b) => a - b);
  const p85 = nonZero[Math.min(nonZero.length - 1, Math.floor(nonZero.length * 0.85))] || 1;
  const cap = Math.max(p85 * 1.6, 1);
  const clipped = m.daily.some((d) => d.amount > cap);
  return h('div', { class: 'card' },
    h('h2', {}, 'Gasto por día'),
    barChart({
      bars: m.daily.map((d) => ({
        label: fromKey(d.key).getDate() % 5 === 1 ? String(fromKey(d.key).getDate()) : '',
        value: Math.min(d.amount, cap) / 100,
        highlight: d.amount > cap,
        tip: `<b>${formatDate(d.key, { weekday: 'short', day: 'numeric', month: 'short' })}</b><br>${money(d.amount)}`,
      })),
      max: cap / 100, color: 'var(--accent)', format: () => '', height: 150,
    }),
    h('p', { class: 'muted small' }, `Media: ${money(Math.round(m.total / m.dayOfMonth))} al día.${clipped ? ' En naranja, días fuera de escala (toca para ver el importe).' : ''}`),
  );
}

const stat = (label, value, cls = '') => h('div', { class: 'pstat' }, h('small', { class: 'muted' }, label), h('b', { class: cls }, value));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Primer uso: cuentas (con saldo actual opcional), cobros del 1 y del 15 y moneda.
 * Todo con valores por defecto: se puede empezar con un solo toque.
 */
function setupView(fin, ctx) {
  const picked = new Set([0, 2]); // cuenta corriente + efectivo
  const initial = {};
  const names = {}; // nombre propio de cada cuenta elegida (por defecto, el del preset)
  const pay = { 0: '', 1: '' };
  let currency = fin.currency;
  let payAccount = 0;
  const root = h('section', { class: 'view finance setup' });

  function paint() {
    root.replaceChildren(
      h('h1', {}, 'Tus finanzas'),
      h('p', { class: 'muted' }, 'Registra cada pago en dos toques y mira en qué se va tu dinero. Configúralo en 30 segundos; podrás cambiarlo todo después.'),
      h('div', { class: 'card' },
        h('h2', {}, '1. ¿Qué cuentas usas?'),
        h('div', { class: 'chips' }, ACCOUNT_PRESETS.map((a, i) => h('button', {
          class: `chip ${picked.has(i) ? 'on' : ''}`, 'aria-pressed': String(picked.has(i)),
          onClick: () => { picked.has(i) ? picked.delete(i) : picked.add(i); if (!picked.size) picked.add(i); paint(); },
        }, `${a.emoji} ${a.name}`))),
        h('p', { class: 'muted small' }, 'Ponles el nombre que uses tú (p. ej. “Nómina BBVA”, “Visa”). Podrás cambiarlo cuando quieras.'),
        [...picked].sort().map((i) => h('div', { class: 'setup-acc' },
          h('span', { class: 'emoji' }, ACCOUNT_PRESETS[i].emoji),
          h('label', { class: 'field' }, h('span', { class: 'label' }, 'Nombre'),
            h('input', { value: names[i] ?? ACCOUNT_PRESETS[i].name, 'aria-label': `Nombre de ${ACCOUNT_PRESETS[i].name}`, onInput: (e) => { names[i] = e.target.value; } })),
          h('label', { class: 'field' }, h('span', { class: 'label' }, 'Saldo actual'),
            h('input', { inputmode: 'decimal', placeholder: '0,00', value: initial[i] || '', 'aria-label': `Saldo actual de ${ACCOUNT_PRESETS[i].name}`, onInput: (e) => { initial[i] = e.target.value; } })),
        )),
      ),
      h('div', { class: 'card' },
        h('h2', {}, '2. ¿Cuánto cobras?'),
        h('p', { class: 'muted small' }, 'Cobras el día 1 y el 15. Con el importe, el día de cobro te bastará un toque para registrarlo.'),
        h('div', { class: 'row' },
          h('label', { class: 'field' }, h('span', { class: 'label' }, 'Día 1'), h('input', { inputmode: 'decimal', placeholder: 'Ej.: 1.200', value: pay[0], onInput: (e) => { pay[0] = e.target.value; } })),
          h('label', { class: 'field' }, h('span', { class: 'label' }, 'Día 15'), h('input', { inputmode: 'decimal', placeholder: 'Ej.: 1.200', value: pay[1], onInput: (e) => { pay[1] = e.target.value; } })),
        ),
        h('label', { class: 'field' }, h('span', { class: 'label' }, 'Lo recibes en'),
          h('select', { onChange: (e) => { payAccount = Number(e.target.value); } },
            [...picked].sort().map((i) => h('option', { value: i, selected: payAccount === i }, `${ACCOUNT_PRESETS[i].emoji} ${(names[i] ?? '').trim() || ACCOUNT_PRESETS[i].name}`)))),
        h('label', { class: 'field' }, h('span', { class: 'label' }, 'Moneda'),
          h('select', { onChange: (e) => { currency = e.target.value; } }, CURRENCIES.map((c) => h('option', { value: c, selected: c === currency }, c)))),
      ),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: start }, 'Empezar'),
        h('button', { class: 'btn ghost', onClick: () => ctx.loadFinanceDemo() }, 'Ver con datos de ejemplo'),
      ),
    );
  }

  function start() {
    // Desde el inicio del periodo actual: así se pide registrar el cobro que lo abrió
    const since = payPeriod(normalizeFinance(fin, ctx.today()), ctx.today()).start;
    let next = normalizeFinance({ ...fin, currency, since }, ctx.today());
    const ids = {};
    for (const i of [...picked].sort()) {
      const before = next.accounts.length;
      next = saveAccount(next, { ...ACCOUNT_PRESETS[i], name: (names[i] ?? '').trim() || ACCOUNT_PRESETS[i].name, initial: parseAmount(initial[i]) ?? 0 });
      if (next.accounts.length > before) ids[i] = next.accounts.at(-1).id;
    }
    const accountId = ids[payAccount] ?? ids[[...picked].sort()[0]];
    next = normalizeFinance({
      ...next,
      paydays: next.paydays.map((p, idx) => ({ ...p, amount: parseAmount(pay[idx]), accountId })),
    }, ctx.today());
    ctx.saveFinance(next, 'Finanzas listas. Registra tu primer gasto con ＋');
  }

  paint();
  return root;
}
