import { formatDate } from '../domain/dates.js';
import { isDone, isScheduled } from '../domain/habits.js';
import { globalMessages } from '../domain/messages.js';
import { weekStatus } from '../domain/stats.js';
import { financeMessages, formatMoney, headline, pendingFixedCosts, pendingPaydays, periodSummary } from '../domain/finance.js';
import { headlineText } from './finance/overview.js';
import { dayPlan, formatMinutes, hasStudyData, minutesOn, studyMessages } from '../domain/study.js';
import { backupOverdue, daysSinceBackup } from '../backup.js';
import { h } from './dom.js';
import { ring } from './charts.js';

// Inicio: el "cerebro" del panel. Un vistazo a los tres módulos (hábitos, finanzas, estudios) y lo más importante de
// todos ellos, ordenado por prioridad. Solo lee: cada tarjeta lleva a su sección.

const SOURCES = { habits: ['Hábitos', '#/'], finance: ['Finanzas', '#/finanzas'], study: ['Estudios', '#/estudio'] };

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
  const study = state.study;
  const hasStudy = hasStudyData(study);
  const plan = hasStudy ? dayPlan(study, today) : null;

  // Lo más importante de los tres módulos, sin repetir lo que ya dicen las tarjetas
  const top = [
    ...globalMessages(state, today).filter((m) => m.kind !== 'level' && m.topic !== 'week').slice(0, 3).map((m) => ({ ...m, source: 'habits' })),
    ...(hasFinance ? financeMessages(fin, today).filter((m) => m.priority < 80).slice(0, 2).map((m) => ({ ...m, source: 'finance' })) : []),
    ...(hasStudy ? studyMessages(study, today, { hour: new Date().getHours() }).filter((m) => m.priority >= 45).slice(0, 2).map((m) => ({ ...m, source: 'study' })) : []),
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

      // Estudios
      h('a', { class: 'card home-tile', href: '#/estudio' },
        h('div', { class: 'tile-head' }, h('h2', {}, 'Estudios'), h('span', { class: 'tile-go', 'aria-hidden': 'true' }, '›')),
        hasStudy ? h('div', { class: 'tile-stack' }, ...((() => {
          const due = plan.overdue.length + plan.dueToday.length;
          const exam = plan.exams[0];
          const mins = minutesOn(study, today);
          return [
            h('b', { class: 'tile-big' }, due ? `${due} para entregar hoy` : exam ? `Examen ${exam.pace.daysLeft === 0 ? 'hoy' : exam.pace.daysLeft === 1 ? 'mañana' : `en ${exam.pace.daysLeft} días`}` : 'Nada urgente'),
            h('p', { class: 'muted small' }, [
              plan.overdue.length ? `${plan.overdue.length} vencida${plan.overdue.length === 1 ? '' : 's'}` : null,
              exam ? `${exam.exam.title}${exam.pace.today ? `: ${exam.pace.today} tema${exam.pace.today === 1 ? '' : 's'} hoy` : ''}` : null,
              `${mins ? formatMinutes(mins) : '0 min'} de ${formatMinutes(study.dailyGoal)} estudiados`,
            ].filter(Boolean).join(' · ')),
          ];
        })())) : h('p', { class: 'muted small' }, 'Apunta tus exámenes y tareas y te digo qué toca cada día.'),
      ),
    ),

    backupOverdue(state) ? h('a', { class: 'home-backup', href: '#/ajustes' },
      daysSinceBackup() === null ? 'Aún no tienes copia de seguridad: hazla en Ajustes (1 min).' : `Tu última copia es de hace ${daysSinceBackup()} días: haz una nueva en Ajustes.`) : null,
  );
}
