import { formatDate } from '../../domain/dates.js';
import { formatMoney } from '../../domain/finance.js';
import { inboxMessages } from '../../domain/inbox.js';
import { connectDemo, currentDigest, inboxBusy, inboxCache, inboxConfig, isConnected } from '../../inbox/state.js';
import { h } from '../dom.js';

/** Hace cuánto: "hace 5 min", "hace 3 h", "ayer"… */
export function ago(iso, now = new Date()) {
  const min = Math.round((now - new Date(iso)) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'ayer' : `hace ${days} días`;
}

/** Fila de un correo (compartida con la Bandeja y el Inicio). */
export function mailRow(m, { compactRow = false } = {}) {
  const initial = (m.from.name || m.from.email).trim().charAt(0).toUpperCase();
  const body = [
    h('span', { class: 'mail-avatar', 'aria-hidden': 'true' }, initial),
    h('span', { class: 'mail-text' },
      h('span', { class: 'mail-top' }, h('b', { class: m.unread ? '' : 'read' }, m.from.name), h('small', { class: 'muted' }, ago(m.date))),
      h('span', { class: 'mail-subject' }, m.subject),
      !compactRow ? h('span', { class: 'mail-snippet muted' }, m.snippet) : null,
      m.reasons?.length ? h('span', { class: 'mail-tags' }, m.reasons.slice(0, 3).map((r) => h('span', { class: 'tag' }, r))) : null,
    ),
  ];
  return m.link
    ? h('a', { class: `mail-row ${m.unread ? 'unread' : ''}`, href: m.link, target: '_blank', rel: 'noopener', title: 'Abrir en Gmail' }, body)
    : h('div', { class: `mail-row ${m.unread ? 'unread' : ''}` }, body);
}

/** Resumen del correo: briefing con IA (si hay clave), cifras, lo que requiere atención, facturas y fechas. */
export function inboxOverviewView(state, ctx) {
  if (!isConnected()) return connectLanding(ctx);
  const cfg = inboxConfig();
  const cache = inboxCache();
  const busy = inboxBusy();
  const d = currentDigest(state.finance);
  const today = ctx.today();
  const money = (c) => formatMoney(c, state.finance.currency);

  const status = h('div', { class: 'inbox-status' },
    h('span', { class: 'muted small' },
      cfg.mode === 'demo' ? 'Correos de ejemplo' : cfg.account || 'Gmail',
      cache?.fetchedAt ? ` · actualizado ${ago(cache.fetchedAt)}` : ''),
    h('button', { class: 'btn ghost small', disabled: Boolean(busy), onClick: () => ctx.refreshInbox() },
      busy === 'mail' ? 'Leyendo…' : busy === 'ai' ? 'Resumiendo…' : '↻ Actualizar'),
  );

  if (!d) {
    return h('section', { class: 'view inbox' }, h('h1', {}, 'Correo'), status,
      cache?.error ? h('div', { class: 'card error-card' }, h('p', {}, cache.error)) : null,
      h('div', { class: 'card empty-note' }, h('p', { class: 'muted' }, busy ? 'Leyendo tu bandeja de entrada…' : 'Pulsa Actualizar para leer tu bandeja de entrada.')));
  }

  const ai = cache?.ai?.forFetch === cache?.fetchedAt ? cache.ai.result : null;
  const byId = new Map(d.analyzed.map((m) => [m.id, m]));
  const rules = ai ? [] : inboxMessages(d, { today, currency: state.finance.currency }).slice(0, 3);

  return h('section', { class: 'view inbox' },
    h('h1', {}, 'Correo'),
    status,
    cache?.error ? h('div', { class: 'card error-card' }, h('p', {}, cache.error)) : null,

    // Briefing con IA
    cfg.aiKey ? h('div', { class: 'card briefing' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Resumen'), ai ? h('small', { class: 'muted' }, ago(cache.ai.at)) : null),
      busy === 'ai' ? h('p', { class: 'muted' }, 'Generando el resumen…')
        : cache?.aiError ? h('div', {}, h('p', { class: 'error' }, cache.aiError), h('button', { class: 'btn ghost small', onClick: () => ctx.runInboxAi() }, 'Reintentar'))
          : ai ? [
            h('p', { class: 'briefing-text' }, ai.resumen),
            h('ul', { class: 'briefing-points' }, ai.puntos.map((p) => h('li', { class: `prio-${p.prioridad}` }, p.texto))),
            ai.acciones.length ? h('div', { class: 'briefing-actions' }, h('h3', { class: 'lift-title' }, 'Para hacer'),
              h('ul', { class: 'plain' }, ai.acciones.map((a) => {
                const m = byId.get(a.id);
                return h('li', {}, h('span', { class: 'todo-dot', 'aria-hidden': 'true' }), h('span', {}, a.texto, m?.link ? [' · ', h('a', { href: m.link, target: '_blank', rel: 'noopener' }, 'abrir')] : null));
              }))) : null,
          ]
            : h('button', { class: 'btn ghost small', onClick: () => ctx.runInboxAi() }, 'Generar resumen'),
    ) : null,

    rules.length ? h('ul', { class: 'messages' }, rules.map((x) => h('li', { class: `msg ${x.kind}` }, x.text))) : null,

    h('div', { class: 'kpis inbox-kpis' },
      kpi('Sin leer', d.unread),
      kpi('Esperan respuesta', d.needsReply.length, d.needsReply.length ? 'warn' : ''),
      kpi('Facturas', d.bills.length),
      kpi('Fechas', d.deadlines.length),
    ),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Requiere tu atención'), h('a', { href: '#/correo/bandeja', class: 'small' }, 'Ver todo')),
      d.attention.length ? h('div', { class: 'mail-list' }, d.attention.map((m) => mailRow(m))) : h('p', { class: 'muted' }, 'Nada urgente. Bandeja tranquila.'),
    ),

    d.bills.length ? h('div', { class: 'card' },
      h('h2', {}, 'Facturas y pagos'),
      h('ul', { class: 'plain bill-list' }, d.bills.map((m) => h('li', {},
        h('span', { class: 'bill-text' }, h('b', {}, m.from.name), h('small', { class: 'muted' }, m.subject)),
        h('b', { class: 'bill-amount' }, money(m.bill.amount)),
        m.bill.recorded
          ? h('span', { class: 'tag up' }, '✓ En gastos')
          : h('button', { class: 'btn ghost small', onClick: () => ctx.openEntry({ tx: { type: 'expense', amount: m.bill.amount, note: m.from.name, date: m.mailKey <= today ? m.mailKey : today } }) }, 'Añadir a gastos'),
      ))),
      h('p', { class: 'muted small' }, 'Detectadas en el correo. “Añadir a gastos” abre el registro con el importe ya puesto; tú eliges la categoría.'),
    ) : null,

    d.deadlines.length ? h('div', { class: 'card' },
      h('h2', {}, 'Fechas mencionadas'),
      h('ul', { class: 'plain bill-list' }, d.deadlines.map((m) => h('li', {},
        h('span', { class: 'date-badge' }, m.deadline.inDays === 0 ? 'Hoy' : m.deadline.inDays === 1 ? 'Mañana' : formatDate(m.deadline.key, { weekday: 'short', day: 'numeric' })),
        h('span', { class: 'bill-text' }, h('b', {}, m.subject), h('small', { class: 'muted' }, m.from.name)),
      ))),
    ) : null,

    d.bulk.length ? h('p', { class: 'muted small center' },
      `${d.bulk.length} promociones y boletines${d.topSenders[0] ? ` · quien más envía: ${d.topSenders.map((s) => `${s.name} (${s.count})`).join(', ')}` : ''}${d.codes.length ? ` · ${d.codes.length} código${d.codes.length === 1 ? '' : 's'} de verificación` : ''}.`) : null,
  );
}

const kpi = (label, value, cls = '') => h('div', { class: 'kpi card' }, h('small', { class: 'muted' }, label), h('b', { class: cls }, value));

function connectLanding(ctx) {
  return h('section', { class: 'view inbox' },
    h('h1', {}, 'Correo'),
    h('div', { class: 'card invite-hero' },
      h('h2', {}, 'Tu bandeja, resumida'),
      h('p', { class: 'muted' }, 'Qué correos esperan respuesta, qué facturas han llegado (y si ya están en tus gastos), qué fechas se acercan. Con tu clave de Claude, además un resumen escrito.'),
      h('ul', { class: 'plain feature-list' },
        h('li', {}, '✓ Solo lectura: la app no puede enviar ni borrar correos.'),
        h('li', {}, '✓ Directo de tu móvil a Google: sin servidores intermedios.'),
        h('li', {}, '✓ Los correos no se incluyen en tus copias de seguridad.'),
      ),
      h('div', { class: 'actions' },
        h('a', { class: 'btn primary', href: '#/correo/conexion' }, 'Conectar Gmail'),
        h('button', { class: 'btn ghost', onClick: () => { connectDemo(); ctx.refreshInbox(); } }, 'Probar con correos de ejemplo'),
      ),
      h('p', { class: 'muted small' }, 'Outlook llegará después.'),
    ),
  );
}
