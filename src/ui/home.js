import { formatDate } from '../domain/dates.js';
import { isDone, isScheduled } from '../domain/habits.js';
import { globalMessages } from '../domain/messages.js';
import { weekStatus } from '../domain/stats.js';
import { financeMessages, formatMoney, headline, pendingFixedCosts, pendingPaydays, periodSummary } from '../domain/finance.js';
import { headlineText } from './finance/overview.js';
import { inboxMessages } from '../domain/inbox.js';
import { currentDigest, inboxCache, isConnected } from '../inbox/state.js';
import { backupOverdue, daysSinceBackup } from '../backup.js';
import { h } from './dom.js';
import { ring } from './charts.js';
import { mailRow } from './inbox/overview.js';

// Inicio: el "cerebro" del panel. Un vistazo a los tres módulos y lo más importante de
// todos ellos, ordenado por prioridad. Solo lee: cada tarjeta lleva a su sección.

const SOURCES = { habits: ['Hábitos', '#/'], finance: ['Finanzas', '#/finanzas'], inbox: ['Correo', '#/correo'] };

function greeting(now = new Date()) {
  const hour = now.getHours();
  return hour < 6 ? 'Buenas noches' : hour < 13 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';
}

/** Hábitos de hoy (misma regla que la vista Hoy: los semanales ya cumplidos no cuentan como pendientes). */
function habitsToday(state, today) {
  const habits = state.habits.filter((x) => !x.archived);
  const due = habits.filter((x) => isScheduled(x, today))
    .filter((x) => x.schedule.type !== 'weekly' || isDone(x, state.entries[x.id]?.[today]) || !weekStatus(x, state.entries[x.id], today)?.met);
  const done = due.filter((x) => isDone(x, state.entries[x.id]?.[today]));
  return { total: habits.length, due, done, pending: due.filter((x) => !done.includes(x)) };
}

export function homeView(state, ctx) {
  const today = ctx.today();
  const fin = state.finance;
  const money = (c) => formatMoney(c, fin.currency);
  const hb = habitsToday(state, today);
  const hasFinance = fin.accounts.length > 0;
  const p = hasFinance ? periodSummary(fin, today) : null;
  const digest = isConnected() ? currentDigest(fin) : null;

  // Lo más importante de los tres módulos, sin repetir lo que ya dicen las tarjetas
  const top = [
    ...globalMessages(state, today).filter((m) => m.kind !== 'level' && m.topic !== 'week').slice(0, 3).map((m) => ({ ...m, source: 'habits' })),
    ...(hasFinance ? financeMessages(fin, today).filter((m) => m.priority < 80).slice(0, 2).map((m) => ({ ...m, source: 'finance' })) : []),
    ...(digest ? inboxMessages(digest, { today, currency: fin.currency }).slice(0, 2) : []),
  ].sort((a, b) => b.priority - a.priority).slice(0, 4);

  const dueFixed = hasFinance ? pendingFixedCosts(fin, today) : [];
  const duePay = hasFinance ? pendingPaydays(fin, today) : [];

  return h('section', { class: 'view home' },
    h('header', { class: 'home-head' },
      h('h1', {}, greeting()),
      h('p', { class: 'muted' }, ((t) => t.charAt(0).toUpperCase() + t.slice(1))(formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' }))),
    ),

    top.length ? h('div', { class: 'card home-top' },
      h('h2', {}, 'Lo importante ahora'),
      h('ul', { class: 'plain home-list' }, top.map((m) => h('li', {},
        h('a', { href: SOURCES[m.source][1], class: `src-tag src-${m.source}` }, SOURCES[m.source][0]),
        h('span', {}, m.short || m.text), // versión corta: el detalle está en cada sección
      ))),
    ) : null,

    h('div', { class: 'home-grid' },
      // Hábitos
      h('a', { class: 'card home-tile', href: '#/' },
        h('div', { class: 'tile-head' }, h('h2', {}, 'Hábitos'), h('span', { class: 'tile-go', 'aria-hidden': 'true' }, '›')),
        hb.total ? h('div', { class: 'tile-body' },
          ring(hb.due.length ? hb.done.length / hb.due.length : 1, { size: 58, stroke: 6, label: `${hb.done.length}/${hb.due.length}` }),
          h('div', {},
            h('b', {}, hb.pending.length ? `${hb.pending.length} pendiente${hb.pending.length === 1 ? '' : 's'}` : 'Todo hecho hoy'),
            h('p', { class: 'muted small' }, hb.pending.length ? hb.pending.slice(0, 3).map((x) => `${x.emoji} ${x.name}`).join(' · ') : 'Buen trabajo.'),
          ),
        ) : h('p', { class: 'muted small' }, 'Crea tu primer hábito.'),
      ),

      // Finanzas
      h('a', { class: 'card home-tile', href: '#/finanzas' },
        h('div', { class: 'tile-head' }, h('h2', {}, 'Finanzas'), h('span', { class: 'tile-go', 'aria-hidden': 'true' }, '›')),
        hasFinance ? h('div', { class: 'tile-stack' },
          ...((hl) => hl.mode === 'period' ? [
            h('b', { class: `tile-big ${p.funds && p.free < 0 ? 'neg' : ''}` }, money(hl.value)),
            h('p', { class: 'muted small' }, p.funds ? `para gastar · ${money(p.perDay)} al día · cobro en ${p.daysLeft} ${p.daysLeft === 1 ? 'día' : 'días'}${p.expected ? ` · incluye ${money(p.expected)} pendientes` : ''}` : 'gastado este periodo'),
          ] : [ // la misma cifra que eligió en el resumen de Finanzas (una cuenta o el total)
            h('b', { class: `tile-big ${hl.value < 0 ? 'neg' : ''}` }, money(hl.value)),
            h('p', { class: 'muted small' }, headlineText(hl, p, money)),
          ])(headline(fin, today, p)),
          dueFixed.length || duePay.length ? h('p', { class: 'small warn' }, [
            duePay.length ? `${duePay.length} cobro${duePay.length === 1 ? '' : 's'} por registrar` : null,
            dueFixed.length ? `${dueFixed.length} gasto${dueFixed.length === 1 ? '' : 's'} fijo${dueFixed.length === 1 ? '' : 's'} por pagar` : null,
          ].filter(Boolean).join(' · ')) : null,
        ) : h('p', { class: 'muted small' }, 'Configura tus cuentas en 30 segundos.'),
      ),

      // Correo
      h('a', { class: 'card home-tile', href: '#/correo' },
        h('div', { class: 'tile-head' }, h('h2', {}, 'Correo'), h('span', { class: 'tile-go', 'aria-hidden': 'true' }, '›')),
        digest ? h('div', { class: 'tile-stack' },
          h('b', { class: 'tile-big' }, digest.needsReply.length ? `${digest.needsReply.length} por responder` : 'Al día'),
          h('p', { class: 'muted small' }, (() => {
            const nb = digest.bills.filter((m) => !m.bill.recorded).length;
            const nd = digest.deadlines.length;
            return `${digest.unread} sin leer · ${nb} factura${nb === 1 ? ' nueva' : 's nuevas'} · ${nd} fecha${nd === 1 ? '' : 's'}`;
          })()),
          inboxCache()?.ai?.result?.resumen ? h('p', { class: 'small tile-ai' }, inboxCache().ai.result.resumen) : null,
        ) : h('p', { class: 'muted small' }, isConnected() ? 'Pulsa para leer tu bandeja.' : 'Conecta Gmail para ver tu bandeja resumida.'),
      ),
    ),

    digest?.attention?.length ? h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Correos que requieren atención'), h('a', { href: '#/correo', class: 'small' }, 'Ver')),
      h('div', { class: 'mail-list' }, digest.attention.slice(0, 3).map((m) => mailRow(m, { compactRow: true }))),
    ) : null,

    backupOverdue(state) ? h('a', { class: 'home-backup', href: '#/ajustes' },
      daysSinceBackup() === null ? 'Aún no tienes copia de seguridad: hazla en Ajustes (1 min).' : `Tu última copia es de hace ${daysSinceBackup()} días: haz una nueva en Ajustes.`) : null,
  );
}
