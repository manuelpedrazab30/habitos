import { formatDate, relativeDay } from '../../domain/dates.js';
import { formatMoney, monthBounds, monthKey, monthLabel, shiftMonth } from '../../domain/finance.js';
import { h } from '../dom.js';

/** Fila de un movimiento (compartida con el resumen). Tocarla abre la edición. */
export function txRow(t, fin, ctx) {
  const acc = (id) => fin.accounts.find((a) => a.id === id);
  const cat = fin.categories.find((c) => c.id === t.categoryId);
  const money = (c) => formatMoney(c, fin.currency);
  const icon = t.type === 'income' ? '💰' : t.type === 'transfer' ? '⇄' : cat?.emoji || '❔';
  const title = t.note || (t.type === 'income' ? 'Ingreso' : t.type === 'transfer' ? 'Transferencia' : cat?.name || 'Sin categoría');
  const sub = t.type === 'transfer'
    ? `${acc(t.accountId)?.name || '?'} → ${acc(t.toAccountId)?.name || '?'}`
    : [t.note && cat && t.note.toLowerCase() !== cat.name.toLowerCase() ? cat.name : null, acc(t.accountId)?.name].filter(Boolean).join(' · ');
  return h('button', { class: 'tx-row', style: cat ? { '--c': cat.color } : null, onClick: () => ctx.openEntry({ tx: t }) },
    h('span', { class: `tx-icon type-${t.type}` }, icon),
    h('span', { class: 'tx-text' }, h('span', { class: 'tx-title' }, title), h('span', { class: 'tx-sub' }, sub)),
    h('span', { class: `tx-amount type-${t.type}` }, t.type === 'expense' ? `−${money(t.amount)}` : t.type === 'income' ? `+${money(t.amount)}` : money(t.amount)),
  );
}

const TYPE_FILTERS = [[null, 'Todos'], ['expense', 'Gastos'], ['income', 'Ingresos'], ['transfer', 'Transferencias']];

/** Movimientos del mes, agrupados por día, con filtros por tipo, categoría y cuenta. */
export function transactionsView(state, ctx) {
  const fin = state.finance;
  const today = ctx.today();
  const mk = ctx.ui.month || monthKey(today);
  const f = ctx.ui.txFilter || {};
  const setFilter = (patch) => { ctx.ui.txFilter = { ...f, ...patch }; ctx.rerender(); };
  const { from, to } = monthBounds(mk);
  const money = (c) => formatMoney(c, fin.currency);

  const list = fin.transactions
    .filter((t) => t.date >= from && t.date <= to)
    .filter((t) => !f.type || t.type === f.type)
    .filter((t) => !f.categoryId || t.categoryId === f.categoryId)
    .filter((t) => !f.accountId || t.accountId === f.accountId || t.toAccountId === f.accountId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const byDay = new Map();
  for (const t of list) {
    if (!byDay.has(t.date)) byDay.set(t.date, []);
    byDay.get(t.date).push(t);
  }
  const spent = list.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
  const earned = list.filter((t) => t.type === 'income').reduce((a, t) => a + t.amount, 0);
  const cat = f.categoryId ? fin.categories.find((c) => c.id === f.categoryId) : null;

  return h('section', { class: 'view finance' },
    h('header', { class: 'day-nav' },
      h('button', { class: 'icon-btn', 'aria-label': 'Mes anterior', onClick: () => { ctx.ui.month = shiftMonth(mk, -1); ctx.rerender(); } }, '‹'),
      h('div', { class: 'day-title' }, h('h1', {}, cap(monthLabel(mk, { month: 'long' }))), h('p', { class: 'muted' }, mk.slice(0, 4))),
      h('button', { class: 'icon-btn', 'aria-label': 'Mes siguiente', disabled: mk >= monthKey(today), onClick: () => { ctx.ui.month = shiftMonth(mk, 1); ctx.rerender(); } }, '›'),
    ),
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi card' }, h('small', { class: 'muted' }, 'Gastado'), h('b', { class: 'neg' }, money(spent))),
      h('div', { class: 'kpi card' }, h('small', { class: 'muted' }, 'Ingresado'), h('b', { class: 'pos' }, money(earned))),
    ),
    h('div', { class: 'chips' },
      TYPE_FILTERS.map(([t, label]) => h('button', { class: `chip ${(f.type || null) === t ? 'on' : ''}`, onClick: () => setFilter({ type: t }) }, label)),
      cat ? h('button', { class: 'chip on', onClick: () => setFilter({ categoryId: null }) }, `${cat.emoji} ${cat.name} ✕`) : null,
    ),
    fin.accounts.length > 1 ? h('select', { class: 'filter-select', 'aria-label': 'Filtrar por cuenta', onChange: (e) => setFilter({ accountId: e.target.value || null }) },
      h('option', { value: '' }, 'Todas las cuentas'),
      fin.accounts.map((a) => h('option', { value: a.id, selected: f.accountId === a.id }, `${a.emoji} ${a.name}`)),
    ) : null,
    list.length
      ? [...byDay.entries()].map(([day, txs]) => {
        const dayOut = txs.filter((t) => t.type === 'expense').reduce((a, t) => a + t.amount, 0);
        return h('div', { class: 'tx-day' },
          h('div', { class: 'tx-day-head' }, h('span', {}, cap(relativeDay(day, today))), dayOut ? h('span', { class: 'muted' }, `−${money(dayOut)}`) : null),
          h('div', { class: 'card tx-list' }, txs.map((t) => txRow(t, fin, ctx))),
        );
      })
      : h('div', { class: 'card empty-note' },
        h('p', { class: 'muted' }, `Sin movimientos en ${monthLabel(mk, { month: 'long' })}${f.type || f.categoryId || f.accountId ? ' con estos filtros' : ''}.`),
        h('button', { class: 'btn primary', onClick: () => ctx.openEntry() }, '＋ Añadir gasto')),
    h('p', { class: 'muted small center' }, `${list.length} ${list.length === 1 ? 'movimiento' : 'movimientos'} · del ${formatDate(from)} al ${formatDate(to)}`),
  );
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
