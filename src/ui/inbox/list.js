import { currentDigest, isConnected } from '../../inbox/state.js';
import { h } from '../dom.js';
import { mailRow } from './overview.js';

const FILTERS = [
  ['attention', 'Atención', (d) => d.attention],
  ['reply', 'Responder', (d) => d.needsReply],
  ['bills', 'Facturas', (d) => d.bills],
  ['dates', 'Fechas', (d) => d.deadlines],
  ['personal', 'Personales', (d) => d.personal],
  ['bulk', 'Boletines', (d) => d.bulk],
  ['all', 'Todo', (d) => [...d.analyzed].sort((a, b) => (a.date < b.date ? 1 : -1))],
];

/** Bandeja analizada, filtrable por grupo. */
export function inboxListView(state, ctx) {
  if (!isConnected()) { setTimeout(() => ctx.go('#/correo'), 0); return h('section', { class: 'view' }); }
  const d = currentDigest(state.finance);
  const current = FILTERS.find((f) => f[0] === ctx.ui.inboxFilter) || FILTERS[0];
  const list = d ? current[2](d) : [];
  return h('section', { class: 'view inbox' },
    h('h1', {}, 'Bandeja'),
    h('div', { class: 'chips' }, FILTERS.map(([id, label, pick]) => h('button', {
      class: `chip ${id === current[0] ? 'on' : ''}`, onClick: () => { ctx.ui.inboxFilter = id; ctx.rerender(); },
    }, label, d ? h('small', { class: 'chip-count' }, ` ${pick(d).length}`) : null))),
    d ? (list.length ? h('div', { class: 'card mail-list' }, list.map((m) => mailRow(m))) : h('p', { class: 'muted' }, 'Nada en este grupo.'))
      : h('p', { class: 'muted' }, 'Aún no hay correos leídos. Pulsa Actualizar.'),
    d ? h('p', { class: 'muted small center' }, `${d.total} correos de los últimos días · solo cabeceras y extractos`) : null,
  );
}
