import {
  accountBalances, accountInUse, amountToInput, categoryInUse, CURRENCIES, deleteAccount, deleteCategory, formatMoney,
  monthKey, monthSummary, normalizeFinance, parseAmount, saveAccount, saveCategory, savePaydays,
  deleteFixedCost, monthlyFixedTotal, saveFixedCost, deleteRecurringTransfer, saveRecurringTransfer,
} from '../../domain/finance.js';
import { COLORS } from '../../domain/habits.js';
import { todayKey } from '../../domain/dates.js';
import { h } from '../dom.js';
import { openSheet } from '../sheet.js';

const ACCOUNT_EMOJIS = ['🏦', '💳', '💵', '🐷', '📈', '🪙', '👛', '🌍'];
const CATEGORY_EMOJIS = ['🛒', '🍽️', '🚗', '🏠', '💡', '📱', '🎉', '🛍️', '❤️', '📚', '✈️', '🐾', '🎁', '☕', '⛽', '💪', '👶', '📦'];

/** Configuración de finanzas: cuentas, cobros fijos, categorías (con presupuesto) y moneda. */
export function accountsView(state, ctx) {
  const fin = state.finance;
  const money = (c, o) => formatMoney(c, fin.currency, o);
  const balances = accountBalances(fin);
  const month = monthSummary(fin, monthKey(ctx.today()), ctx.today());
  const spentBy = Object.fromEntries(month.categories.map((r) => [r.category.id, r.spent]));
  const accName = (id) => fin.accounts.find((a) => a.id === id);

  return h('section', { class: 'view finance' },
    h('h1', {}, 'Cuentas y categorías'),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Cuentas'),
        h('div', { class: 'head-actions' },
          fin.accounts.length > 1 ? h('button', { class: 'btn ghost small', onClick: () => ctx.openEntry({ type: 'transfer' }) }, '⇄ Mover dinero') : null,
          h('button', { class: 'btn ghost small', onClick: () => accountSheet(ctx) }, '＋ Cuenta'))),
      h('p', { class: 'muted small' }, 'Toca una cuenta para cambiarle el nombre, el icono o el saldo inicial, o para marcarla como reserva (ahorro que no tocas). Sus movimientos se conservan.'),
      fin.accounts.length ? h('ul', { class: 'plain settings-list' }, fin.accounts.map((a) => h('li', {},
        h('button', { class: 'settings-row', 'aria-label': `Editar ${a.name}`, onClick: () => accountSheet(ctx, a) },
          h('span', { class: 'emoji' }, a.emoji), h('span', { class: 'grow' }, a.name, a.reserve ? h('span', { class: 'tag reserve-tag' }, 'Reserva') : null),
          h('b', { class: balances[a.id] < 0 ? 'neg' : '' }, money(balances[a.id] ?? 0)), editMark()),
      ))) : h('p', { class: 'muted' }, 'Sin cuentas todavía.'),
    ),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Cobros fijos'), h('button', { class: 'btn ghost small', onClick: () => paydaySheet(ctx) }, '＋ Cobro')),
      h('p', { class: 'muted small' }, 'Marcan tus periodos (del 1 al 14, del 15 a fin de mes). Cada día de cobro aparece un aviso para registrarlo con un toque.'),
      h('ul', { class: 'plain settings-list' }, fin.paydays.map((p) => h('li', {},
        h('button', { class: 'settings-row', onClick: () => paydaySheet(ctx, p) },
          h('span', { class: 'emoji' }, '💰'), h('span', { class: 'grow' }, `Día ${p.day}`),
          h('span', { class: 'muted' }, p.amount ? `${money(p.amount)} · ${accName(p.accountId)?.name || 'sin cuenta'}` : 'Importe variable'), editMark()),
      ))),
    ),

    fin.accounts.length > 1 ? h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Transferencias periódicas'), h('button', { class: 'btn ghost small', onClick: () => transferSheet(ctx) }, '＋ Transferencia')),
      h('p', { class: 'muted small' }, 'Dinero que pasas entre tus cuentas siempre en las mismas fechas (p. ej. a efectivo cada día 1 y 15). Ese día te aviso para marcarla con un toque. No cuenta como gasto.'),
      (fin.recurringTransfers || []).length ? h('ul', { class: 'plain settings-list' }, fin.recurringTransfers.map((r) => h('li', {},
        h('button', { class: 'settings-row', 'aria-label': `Editar ${r.name || 'transferencia'}`, onClick: () => transferSheet(ctx, r) },
          h('span', { class: 'emoji' }, '⇄'),
          h('span', { class: 'grow' }, r.name || `${accName(r.fromAccountId)?.name || '?'} → ${accName(r.toAccountId)?.name || '?'}`,
            h('small', { class: 'muted block' }, `${r.name ? `${accName(r.fromAccountId)?.name || '?'} → ${accName(r.toAccountId)?.name || '?'} · ` : ''}días ${r.days.join(' y ')}`)),
          h('span', { class: 'muted' }, money(r.amount)), editMark()),
      ))) : null,
    ) : null,

    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Gastos fijos'), h('button', { class: 'btn ghost small', onClick: () => fixedCostSheet(ctx) }, '＋ Gasto fijo')),
      h('p', { class: 'muted small' }, fin.fixedCosts.length
        ? `${money(monthlyFixedTotal(fin))} al mes. Cada vencimiento aparece en el resumen para marcarlo como pagado, y lo pendiente se descuenta de lo que puedes gastar.`
        : 'Alquiler, suscripciones, seguros… Añádelos una vez y te avisaré de cada vencimiento.'),
      fin.fixedCosts.length ? h('ul', { class: 'plain settings-list' }, [...fin.fixedCosts].sort((a, b) => a.day - b.day).map((c) => {
        const cat = fin.categories.find((x) => x.id === c.categoryId);
        return h('li', {},
          h('button', { class: 'settings-row', 'aria-label': `Editar ${c.name}`, onClick: () => fixedCostSheet(ctx, c) },
            h('span', { class: 'emoji' }, cat?.emoji || '📌'),
            h('span', { class: 'grow' }, c.name, h('small', { class: 'muted block' }, c.frequency === 'yearly' ? `Cada año · ${c.day} de ${MONTHS[c.month - 1]}` : `Cada mes · día ${c.day}`)),
            h('span', { class: 'muted' }, money(c.amount)), editMark()));
      })) : null,
    ),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Categorías'), h('button', { class: 'btn ghost small', onClick: () => categorySheet(ctx) }, '＋ Categoría')),
      h('p', { class: 'muted small' }, 'Toca una para cambiarla o ponerle un presupuesto mensual: te avisaré al llegar al 80%.'),
      h('ul', { class: 'plain settings-list' }, fin.categories.map((c) => h('li', {},
        h('button', { class: 'settings-row', style: { '--c': c.color }, onClick: () => categorySheet(ctx, c) },
          h('span', { class: 'dot-c' }), h('span', { class: 'emoji' }, c.emoji), h('span', { class: 'grow' }, c.name),
          h('span', { class: 'muted' }, c.budget ? `${money(spentBy[c.id] || 0, { decimals: false })} / ${money(c.budget, { decimals: false })}` : spentBy[c.id] ? money(spentBy[c.id]) : ''), editMark()),
      ))),
    ),

    h('div', { class: 'card' },
      h('h2', {}, 'Moneda'),
      h('select', { onChange: (e) => ctx.saveFinance({ ...fin, currency: e.target.value }, `Moneda: ${e.target.value}`) },
        CURRENCIES.map((c) => h('option', { value: c, selected: c === fin.currency }, c))),
    ),

    h('div', { class: 'card' },
      h('h2', {}, 'Datos de finanzas'),
      h('p', { class: 'muted small' }, `${fin.transactions.length} movimientos. Se incluyen en “Exportar copia” de Ajustes.`),
      h('div', { class: 'actions' },
        !fin.transactions.length ? h('button', { class: 'btn ghost', onClick: () => ctx.loadFinanceDemo() }, 'Cargar datos de ejemplo') : null,
        h('button', { class: 'btn danger', onClick: () => {
          if (!confirm('¿Borrar cuentas, categorías y movimientos? Los hábitos no se tocan.')) return;
          ctx.saveFinance(normalizeFinance(null, todayKey()), 'Finanzas borradas');
        } }, 'Borrar finanzas'),
      ),
    ),
  );
}

// ── Hojas de edición

const editMark = () => h('span', { class: 'edit-mark', 'aria-hidden': 'true' }, '✎');

function formSheet(title, fields, { onSave, onDelete, deleteLabel = 'Eliminar', deleteDisabled = null, focus = null }) {
  openSheet((close) => {
    const err = h('small', { class: 'error' });
    const form = h('form', { class: 'sheet-form', onSubmit: (e) => {
      e.preventDefault();
      const msg = onSave();
      if (msg) { err.textContent = msg; return; }
      close();
    } },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Cerrar', onClick: close }, '✕')),
    fields, err,
    h('div', { class: 'sheet-actions' },
      h('button', { type: 'submit', class: 'btn primary' }, 'Guardar'),
      onDelete ? h('button', { type: 'button', class: 'btn danger', disabled: Boolean(deleteDisabled), title: deleteDisabled || '', onClick: () => { onDelete(); close(); } }, deleteLabel) : null,
    ),
    deleteDisabled ? h('small', { class: 'muted' }, deleteDisabled) : null,
    );
    return form;
  }, { label: title });
  // El nombre listo para escribir encima (renombrar = escribir y Guardar)
  if (focus) { focus.focus(); focus.select(); }
}

const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), input, hint ? h('small', { class: 'muted' }, hint) : null);

function emojiPicker(list, current, onPick) {
  const wrap = h('div', { class: 'emoji-row' });
  const paint = (sel) => wrap.replaceChildren(...list.map((e) => h('button', { type: 'button', class: `emoji-pick ${e === sel ? 'on' : ''}`, onClick: () => { onPick(e); paint(e); } }, e)));
  paint(current);
  return wrap;
}

export function accountSheet(ctx, acc = null) {
  const fin = ctx.store.get().finance;
  const d = { ...(acc || { name: '', emoji: '🏦', initial: 0, reserve: false }) };
  const reserve = h('input', { type: 'checkbox', checked: Boolean(d.reserve), 'aria-label': 'Cuenta de reserva' });
  const name = h('input', { value: d.name, placeholder: 'Ej.: Cuenta nómina', required: true });
  const initial = h('input', { inputmode: 'decimal', value: amountToInput(Math.abs(d.initial)) && `${d.initial < 0 ? '-' : ''}${amountToInput(Math.abs(d.initial))}`, placeholder: '0,00' });
  formSheet(acc ? 'Editar cuenta' : 'Nueva cuenta', [
    field('Nombre', name),
    emojiPicker(ACCOUNT_EMOJIS, d.emoji, (e) => { d.emoji = e; }),
    field('Saldo inicial', initial, 'El saldo que tenía antes del primer movimiento registrado aquí. En una tarjeta de crédito con deuda, ponlo en negativo.'),
    h('label', { class: 'check-field' }, reserve, h('span', {},
      h('b', {}, 'Cuenta de reserva'),
      h('small', { class: 'muted block' }, 'Ahorro que no tocas en el día a día. Su saldo no cuenta como dinero para gastar; lo que pasas desde aquí a tus otras cuentas sí cuenta como el dinero del periodo.'))),
  ], {
    focus: name,
    onSave: () => {
      if (!name.value.trim()) return 'Ponle un nombre.';
      const raw = initial.value.trim();
      const c = parseAmount(raw.replace('-', '')) ?? 0;
      ctx.saveFinance(saveAccount(ctx.store.get().finance, { ...d, name: name.value, initial: raw.startsWith('-') ? -c : c, reserve: reserve.checked }), acc ? 'Cuenta guardada' : `Cuenta “${name.value.trim()}” creada`);
      return null;
    },
    onDelete: acc ? () => ctx.saveFinance(deleteAccount(ctx.store.get().finance, acc.id), 'Cuenta eliminada') : null,
    deleteDisabled: acc && accountInUse(fin, acc.id) ? 'Tiene movimientos: no se puede eliminar sin perder historial.' : null,
  });
}

function categorySheet(ctx, cat = null) {
  const fin = ctx.store.get().finance;
  const d = { ...(cat || { name: '', emoji: '📦', color: COLORS[fin.categories.length % COLORS.length], budget: null }) };
  const name = h('input', { value: d.name, placeholder: 'Ej.: Mascotas' });
  const budget = h('input', { inputmode: 'decimal', value: amountToInput(d.budget), placeholder: 'Sin presupuesto' });
  const colors = h('div', { class: 'colors' });
  const paintColors = () => colors.replaceChildren(...COLORS.map((c) => h('button', { type: 'button', class: `swatch ${d.color === c ? 'on' : ''}`, style: { background: c }, 'aria-label': `Color ${c}`, onClick: () => { d.color = c; paintColors(); } })));
  paintColors();
  formSheet(cat ? 'Editar categoría' : 'Nueva categoría', [
    field('Nombre', name),
    emojiPicker(CATEGORY_EMOJIS, d.emoji, (e) => { d.emoji = e; }),
    colors,
    field('Presupuesto mensual', budget, 'Opcional. Te aviso al llegar al 80% y si lo superas.'),
  ], {
    onSave: () => {
      if (!name.value.trim()) return 'Ponle un nombre.';
      ctx.saveFinance(saveCategory(ctx.store.get().finance, { ...d, name: name.value, budget: parseAmount(budget.value) }), cat ? 'Categoría guardada' : 'Categoría creada');
      return null;
    },
    onDelete: cat ? () => ctx.saveFinance(deleteCategory(ctx.store.get().finance, cat.id), 'Categoría eliminada') : null,
    deleteDisabled: cat && categoryInUse(fin, cat.id) ? 'Tiene gastos: no se puede eliminar sin perder historial.' : null,
  });
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Crear/editar un gasto fijo: nombre, importe, categoría, cuenta y cuándo vence (mensual o anual). */
export function fixedCostSheet(ctx, cost = null) {
  const fin = ctx.store.get().finance;
  if (!fin.accounts.length) { ctx.go('#/finanzas'); return; }
  const d = { frequency: 'monthly', month: Number(ctx.today().slice(5, 7)), ...(cost || {}) };
  const name = h('input', { value: d.name || '', placeholder: 'Ej.: Alquiler, Netflix, gimnasio' });
  const amount = h('input', { inputmode: 'decimal', value: amountToInput(d.amount), placeholder: '0,00' });
  const day = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 31, value: d.day ?? '', placeholder: 'Ej.: 1' });
  const guessCat = fin.categories.find((c) => c.id === 'cat-home') || fin.categories[0];
  const category = h('select', {}, fin.categories.map((c) => h('option', { value: c.id, selected: (d.categoryId || guessCat?.id) === c.id }, `${c.emoji} ${c.name}`)));
  const account = h('select', {}, fin.accounts.map((a) => h('option', { value: a.id, selected: (d.accountId || fin.accounts[0].id) === a.id }, `${a.emoji} ${a.name}`)));
  const month = h('select', {}, MONTHS.map((m, i) => h('option', { value: i + 1, selected: d.month === i + 1 }, m)));
  const monthField = field('Mes', month);
  const freq = h('div', { class: 'seg' });
  const paintFreq = () => {
    freq.replaceChildren(...[['monthly', 'Cada mes'], ['yearly', 'Cada año']].map(([v, label]) => h('button', {
      type: 'button', class: d.frequency === v ? 'on' : '', onClick: () => { d.frequency = v; paintFreq(); },
    }, label)));
    monthField.style.display = d.frequency === 'yearly' ? '' : 'none';
  };
  paintFreq();
  // Al escribir el nombre, sugerir la categoría (suscripciones, vivienda…)
  name.addEventListener('input', () => {
    if (cost) return;
    const n = name.value.toLowerCase();
    const guess = /netflix|spotify|hbo|disney|prime|youtube|icloud|suscrip|app/.test(n) ? 'cat-subs'
      : /alquiler|hipoteca|comunidad|renta/.test(n) ? 'cat-home'
        : /luz|agua|gas|internet|fibra|m[oó]vil|tel[eé]fono|seguro/.test(n) ? 'cat-bills'
          : /gimnasio|gym/.test(n) ? 'cat-health' : null;
    if (guess && fin.categories.some((c) => c.id === guess)) category.value = guess;
  });

  formSheet(cost ? 'Editar gasto fijo' : 'Nuevo gasto fijo', [
    field('Nombre', name),
    field('Importe', amount),
    freq,
    h('div', { class: 'row' }, field('Día del mes', day, 'Si el mes es más corto, el último día.'), monthField),
    field('Categoría', category),
    field('Se paga desde', account),
  ], {
    focus: cost ? null : name,
    onSave: () => {
      if (!name.value.trim()) return 'Ponle un nombre.';
      const c = parseAmount(amount.value);
      if (!c) return 'Escribe el importe.';
      const n = Math.round(Number(day.value));
      if (!(n >= 1 && n <= 31)) return 'Indica un día entre 1 y 31.';
      ctx.saveFinance(saveFixedCost(ctx.store.get().finance, {
        ...d, name: name.value, amount: c, day: n, month: Number(month.value), categoryId: category.value, accountId: account.value,
      }, ctx.today()), cost ? 'Gasto fijo guardado' : `${name.value.trim()} añadido a tus gastos fijos`);
      return null;
    },
    onDelete: cost ? () => ctx.saveFinance(deleteFixedCost(ctx.store.get().finance, cost.id), 'Gasto fijo eliminado (sus pagos se conservan)') : null,
  });
}

/** Crear/editar una transferencia periódica: importe, de qué cuenta a cuál y qué días del mes. */
export function transferSheet(ctx, rt = null) {
  const fin = ctx.store.get().finance;
  const accountOpts = (selected) => fin.accounts.map((a) => h('option', { value: a.id, selected: selected === a.id }, `${a.emoji} ${a.name}`));
  // Por defecto: de la primera cuenta a la de efectivo (si hay), los días 1 y 15
  const cash = fin.accounts.find((a) => a.emoji === '💵' || /efectivo|cash/i.test(a.name));
  const from = rt?.fromAccountId || fin.accounts.find((a) => a.id !== cash?.id)?.id || fin.accounts[0].id;
  const to = rt?.toAccountId || cash?.id || fin.accounts.find((a) => a.id !== from)?.id;
  const name = h('input', { value: rt?.name || '', placeholder: 'Ej.: Efectivo de la quincena (opcional)' });
  const amount = h('input', { inputmode: 'decimal', value: amountToInput(rt?.amount), placeholder: '0,00' });
  const fromSel = h('select', {}, accountOpts(from));
  const toSel = h('select', {}, accountOpts(to));
  const day1 = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 31, value: rt?.days?.[0] ?? 1 });
  const day2 = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 31, value: rt ? (rt.days[1] ?? '') : 15, placeholder: 'Opcional' });
  formSheet(rt ? 'Editar transferencia periódica' : 'Nueva transferencia periódica', [
    field('Importe', amount),
    h('div', { class: 'row' }, field('Desde', fromSel), field('Hacia', toSel)),
    h('div', { class: 'row' }, field('Día del mes', day1), field('Y también el día', day2, 'Cada 15 días: 1 y 15.')),
    field('Nombre', name),
  ], {
    focus: rt ? null : amount,
    onSave: () => {
      const c = parseAmount(amount.value);
      if (!c) return 'Escribe el importe.';
      if (fromSel.value === toSel.value) return 'Elige dos cuentas distintas.';
      const days = [day1.value, day2.value].map((d) => Math.round(Number(d))).filter((d) => d >= 1 && d <= 31);
      if (!days.length) return 'Indica al menos un día del mes (1–31).';
      ctx.saveFinance(saveRecurringTransfer(ctx.store.get().finance, {
        ...(rt || {}), name: name.value, amount: c, fromAccountId: fromSel.value, toAccountId: toSel.value, days,
      }, ctx.today()), rt ? 'Transferencia guardada' : 'Transferencia periódica creada');
      return null;
    },
    onDelete: rt ? () => ctx.saveFinance(deleteRecurringTransfer(ctx.store.get().finance, rt.id), 'Transferencia periódica eliminada (las hechas se conservan)') : null,
  });
}

function paydaySheet(ctx, pay = null) {
  const fin = ctx.store.get().finance;
  const day = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 31, value: pay?.day ?? '', placeholder: 'Ej.: 15' });
  const amount = h('input', { inputmode: 'decimal', value: amountToInput(pay?.amount), placeholder: 'Variable' });
  const account = h('select', {}, fin.accounts.map((a) => h('option', { value: a.id, selected: (pay?.accountId || fin.accounts[0]?.id) === a.id }, `${a.emoji} ${a.name}`)));
  formSheet(pay ? `Cobro del día ${pay.day}` : 'Nuevo cobro fijo', [
    field('Día del mes', day, 'Si el mes es más corto, cuenta el último día.'),
    field('Importe habitual', amount, 'Opcional: con importe, registrarlo es un toque.'),
    field('Cuenta', account),
  ], {
    onSave: () => {
      const n = Math.round(Number(day.value));
      if (!(n >= 1 && n <= 31)) return 'Indica un día entre 1 y 31.';
      const current = ctx.store.get().finance;
      const list = pay
        ? current.paydays.map((p) => (p.id === pay.id ? { ...p, day: n, amount: parseAmount(amount.value), accountId: account.value } : p))
        : [...current.paydays, { day: n, amount: parseAmount(amount.value), accountId: account.value }];
      ctx.saveFinance(savePaydays(current, list), 'Cobro guardado');
      return null;
    },
    onDelete: pay ? () => {
      const current = ctx.store.get().finance;
      ctx.saveFinance(savePaydays(current, current.paydays.filter((p) => p.id !== pay.id)), 'Cobro eliminado');
    } : null,
  });
}
