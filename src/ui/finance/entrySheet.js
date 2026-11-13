import { addDays, formatDate } from '../../domain/dates.js';
import {
  amountToInput, categoriesByUse, deleteTransaction, formatMoney, lastAccountId, parseAmount, periodSummary,
  recentExpenses, saveAccount, saveTransaction, validateTransaction,
} from '../../domain/finance.js';
import { h, toast } from '../dom.js';
import { openSheet } from '../sheet.js';

const TYPES = [['expense', 'Gasto'], ['income', 'Ingreso'], ['transfer', 'Transferencia']];
const VISIBLE_CATEGORIES = 8;

/**
 * Registro rápido de un movimiento. Pensado para ser lo más corto posible:
 * escribir el importe → tocar la categoría → Guardar. La cuenta viene preseleccionada
 * (la última usada) y los gastos recientes se repiten con un toque.
 * opts: { type, tx } — tx para editar; también acepta un borrador parcial (p. ej. un cobro).
 */
export function openEntrySheet(ctx, { type = 'expense', tx = null } = {}) {
  const fin = ctx.store.get().finance;
  if (!fin.accounts.length) {
    ctx.go('#/finanzas');
    toast('Primero añade una cuenta');
    return;
  }
  const today = ctx.today();
  const editing = Boolean(tx?.id);
  const draft = {
    type: tx?.type || type,
    amount: tx?.amount ?? null,
    date: tx?.date || today,
    accountId: tx?.accountId || lastAccountId(fin, tx?.type || type),
    toAccountId: tx?.toAccountId || null,
    categoryId: tx?.categoryId || null,
    note: tx?.note || '',
    paydayId: tx?.paydayId || null,
    fixedCostId: tx?.fixedCostId || null, // pago de un gasto fijo con otro importe
    recurringId: tx?.recurringId || null, // transferencia periódica hecha con otro importe
    id: tx?.id,
  };
  let markReserve = false; // transferencia desde una cuenta que no es de reserva: marcarla al guardar
  const money = (c) => formatMoney(c, fin.currency);
  let showAll = false;
  let errors = {};

  let amountInput;
  const close = openSheet((closeSheet) => {
    const root = h('div', { class: 'entry', style: { display: 'contents' } });
    amountInput = h('input', {
      class: 'amount-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done',
      placeholder: '0,00', value: amountToInput(draft.amount), 'aria-label': 'Importe',
      onInput: () => { draft.amount = parseAmount(amountInput.value); paintSave(); },
      onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } },
    });
    const saveBtn = h('button', { class: 'btn primary', onClick: () => save() });
    const paintSave = () => {
      const verb = { expense: 'Guardar gasto', income: 'Guardar ingreso', transfer: 'Guardar transferencia' }[draft.type];
      saveBtn.textContent = draft.amount ? `${verb} · ${money(draft.amount)}` : verb;
    };

    function chipRow(items, selected, onPick, { label, error } = {}) {
      return h('div', { class: 'entry-block' },
        label ? h('span', { class: 'entry-label' }, label) : null,
        h('div', { class: 'chips' }, items.map((it) => h('button', {
          type: 'button', class: `chip pick ${it.id === selected ? 'on' : ''}`, 'aria-pressed': String(it.id === selected),
          style: it.color ? { '--c': it.color } : null,
          onClick: () => { onPick(it.id); errors = {}; paint(); },
        }, `${it.emoji} ${it.name}`))),
        error ? h('small', { class: 'error' }, error) : null,
      );
    }

    // Entre dos cuentas normales una transferencia solo mueve saldos: no suma a "para gastar".
    // Si sale de tu ahorro, marcarlo como reserva hace que cuente como dinero del periodo.
    function reserveHint() {
      const from = fin.accounts.find((a) => a.id === draft.accountId);
      const to = fin.accounts.find((a) => a.id === draft.toAccountId);
      if (!from || !to || from.reserve || to.reserve) return null;
      return h('div', { class: 'entry-block reserve-hint' },
        h('small', { class: 'muted' }, markReserve
          ? `«${from.name}» quedará como cuenta de reserva: su saldo no cuenta para gastar y lo que pases desde ella suma a «para gastar».`
          : `Moverá saldo de «${from.name}» a «${to.name}», pero no suma a «para gastar»: «${from.name}» no es una cuenta de reserva.`),
        h('button', { type: 'button', class: `chip ${markReserve ? 'on' : ''}`, 'aria-pressed': String(markReserve), onClick: () => { markReserve = !markReserve; paint(); } },
          markReserve ? '✓ Es mi ahorro (reserva)' : 'Es mi ahorro: marcarla como reserva'),
      );
    }

    function paint() {
      const focused = document.activeElement === amountInput;
      const cats = categoriesByUse(fin, today);
      const visible = showAll || cats.length <= VISIBLE_CATEGORIES ? cats : cats.slice(0, VISIBLE_CATEGORIES);
      if (draft.categoryId && !visible.some((c) => c.id === draft.categoryId)) visible.push(cats.find((c) => c.id === draft.categoryId));
      const recent = !editing && draft.type === 'expense' ? recentExpenses(fin, 4) : [];
      const catOf = (id) => fin.categories.find((c) => c.id === id);

      root.replaceChildren(...[
        h('div', { class: 'sheet-head' },
          h('h2', {}, editing ? 'Editar movimiento' : 'Nuevo movimiento'),
          h('button', { class: 'icon-btn small', 'aria-label': 'Cerrar', onClick: closeSheet }, '✕'),
        ),
        h('div', { class: 'seg' }, TYPES.map(([t, label]) => h('button', {
          type: 'button', class: draft.type === t ? 'on' : '',
          onClick: () => {
            draft.type = t;
            draft.accountId = editing ? draft.accountId : lastAccountId(fin, t);
            errors = {};
            paint();
          },
        }, label))),
        h('label', { class: `amount-wrap type-${draft.type}` }, amountInput, h('span', { class: 'currency' }, money(0).replace(/[\d\s.,]/g, '') || fin.currency)),
        errors.amount ? h('small', { class: 'error' }, errors.amount) : null,

        recent.length ? h('div', { class: 'entry-block' },
          h('span', { class: 'entry-label' }, 'Repetir'),
          h('div', { class: 'chips' }, recent.map((r) => h('button', {
            type: 'button', class: 'chip',
            onClick: () => {
              Object.assign(draft, { amount: r.amount, categoryId: r.categoryId, accountId: r.accountId, note: r.note });
              amountInput.value = amountToInput(r.amount);
              errors = {};
              paint();
            },
          }, `${catOf(r.categoryId)?.emoji || '•'} ${r.note || catOf(r.categoryId)?.name || ''} · ${money(r.amount)}`))),
        ) : null,

        draft.type === 'expense' ? h('div', { class: 'entry-block' },
          h('span', { class: 'entry-label' }, 'Categoría'),
          h('div', { class: 'cat-grid' }, visible.map((c) => h('button', {
            type: 'button', class: `cat-pick ${c.id === draft.categoryId ? 'on' : ''}`, style: { '--c': c.color }, 'aria-pressed': String(c.id === draft.categoryId),
            onClick: () => { draft.categoryId = c.id; errors = {}; paint(); },
          }, h('span', { class: 'emoji' }, c.emoji), h('span', {}, c.name))),
          cats.length > VISIBLE_CATEGORIES ? h('button', { type: 'button', class: 'cat-pick more', onClick: () => { showAll = !showAll; paint(); } }, h('span', { class: 'emoji' }, showAll ? '−' : '＋'), h('span', {}, showAll ? 'Menos' : 'Más')) : null),
          errors.category ? h('small', { class: 'error' }, errors.category) : null,
        ) : null,

        chipRow(fin.accounts, draft.accountId, (id) => { draft.accountId = id; }, { label: draft.type === 'income' ? 'Cuenta' : 'Desde', error: errors.account }),
        draft.type === 'transfer'
          ? chipRow(fin.accounts.filter((a) => a.id !== draft.accountId), draft.toAccountId, (id) => { draft.toAccountId = id; }, { label: 'Hacia', error: errors.toAccount })
          : null,
        draft.type === 'transfer' ? reserveHint() : null,

        h('div', { class: 'entry-block row-inline' },
          h('div', { class: 'chips' },
            [[today, 'Hoy'], [addDays(today, -1), 'Ayer']].map(([k, label]) => h('button', {
              type: 'button', class: `chip ${draft.date === k ? 'on' : ''}`, onClick: () => { draft.date = k; paint(); },
            }, label)),
          ),
          h('input', { type: 'date', class: 'date-input', value: draft.date, max: today, 'aria-label': 'Fecha', onChange: (e) => { if (e.target.value) { draft.date = e.target.value; paint(); } } }),
        ),
        h('input', { class: 'note-input', placeholder: 'Nota (opcional): café, gasolina…', value: draft.note, maxlength: 80, 'aria-label': 'Nota', onInput: (e) => { draft.note = e.target.value; } }),

        h('div', { class: 'sheet-actions' },
          saveBtn,
          editing ? h('button', { class: 'btn danger', onClick: () => {
            closeSheet();
            ctx.saveFinance(deleteTransaction(ctx.store.get().finance, draft.id), 'Movimiento eliminado');
          } }, 'Eliminar') : null,
        ),
      ].filter(Boolean));
      paintSave();
      if (focused) amountInput.focus();
    }

    function save() {
      draft.amount = parseAmount(amountInput.value);
      const current = ctx.store.get().finance;
      errors = validateTransaction(draft, current);
      if (Object.keys(errors).length) {
        paint();
        if (errors.amount) amountInput.focus();
        return;
      }
      closeSheet();
      const fromAcc = current.accounts.find((a) => a.id === draft.accountId);
      const base = draft.type === 'transfer' && markReserve && fromAcc ? saveAccount(current, { ...fromAcc, reserve: true }) : current;
      const next = saveTransaction(base, draft);
      const cat = current.categories.find((c) => c.id === draft.categoryId);
      let msg = {
        expense: `Gasto de ${money(draft.amount)} · ${cat?.emoji || ''} ${cat?.name || ''}`,
        income: `Ingreso de ${money(draft.amount)}`,
        transfer: `Transferencia de ${money(draft.amount)}${base !== current ? ` · «${fromAcc.name}» ahora es reserva` : ''}`,
      }[draft.type];
      if (editing) msg = 'Movimiento actualizado';
      else if (draft.type === 'expense' && draft.date >= periodSummary(next, today).start) {
        const p = periodSummary(next, today);
        if (p.funds > 0) msg += `. Quedan ${money(p.free)} para gastar hasta el ${formatDate(p.next)}`;
      }
      ctx.saveFinance(next, msg);
    }

    paint();
    return root;
  }, { label: 'Registrar movimiento' });

  // Foco inmediato (dentro del mismo toque, para que iOS abra el teclado numérico)
  if (!editing) amountInput?.focus();
  return close;
}
