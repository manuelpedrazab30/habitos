import { formatDate } from '../domain/dates.js';
import { isDone, isScheduled } from '../domain/habits.js';
import { hasRoutine } from '../domain/workouts.js';
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
  ].sort((a, b) => b.priority - a.priority).slice(0, 2);

  const dueFixed = hasFinance ? pendingFixedCosts(fin, today) : [];
  const duePay = hasFinance ? pendingPaydays(fin, today) : [];

  // Foco del día: una sola cosa a la vez. Progreso = hábitos de hoy + entregas de estudio (hechas hoy y pendientes).
  const studyDue = plan ? plan.overdue.length + plan.dueToday.length : 0;
  const studyDone = hasStudy ? study.tasks.filter((x) => x.doneAt === today).length : 0;
  const total = hb.due.length + studyDue + studyDone;
  const done = hb.done.length + studyDone;
  const left = total - done;
  const next = hb.pending[0] ? { text: `${hb.pending[0].emoji} ${hb.pending[0].name}`, href: '#/' }
    : studyDue ? { text: `${studyDue} entrega${studyDue === 1 ? '' : 's'} de estudio`, href: '#/estudio' }
    : duePay.length || dueFixed.length ? { text: duePay.length ? 'Registrar tu cobro' : 'Pagar un gasto fijo', href: '#/finanzas' } : null;
  const focusTitle = !total ? 'Un día en blanco' : left <= 0 ? 'Todo al día' : done === 0 ? `${left} cosa${left === 1 ? '' : 's'} para hoy` : `Te ${left === 1 ? 'queda' : 'quedan'} ${left}`;
  const focusSub = !total ? 'Crea un hábito o apunta una tarea y aquí verás tu avance.' : left <= 0 ? 'Lo demás puede esperar.' : done === 0 ? (next ? 'Empieza por una.' : 'Cuando quieras.') : (next ? 'Buen ritmo. Sigue con:' : 'Buen ritmo.');

  const days = (n) => `${n} ${n === 1 ? 'día' : 'días'}`;
  // Hábitos de un toque: los de tipo "check" sin rutina se marcan aquí mismo; el resto abre Hoy.
  const quick = (x) => x.kind === 'check' && !hasRoutine(x);
  const chips = [...hb.pending, ...hb.done].slice(0, 6);
  const more = hb.due.length - chips.length;

  return h('section', { class: 'view home' },
    h('header', { class: 'home-head' },
      h('h1', {}, greeting()),
      h('p', { class: 'home-date' }, ((t) => t.charAt(0).toUpperCase() + t.slice(1))(formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' }))),
    ),

    h('div', { class: `card home-focus ${total && left <= 0 ? 'is-done' : ''}` },
      ring(total ? done / total : 0, { size: 88, stroke: 9, label: total ? `${done}/${total}` : '–' }),
      h('div', { class: 'focus-text' },
        h('h2', {}, focusTitle),
        h('p', { class: 'muted' }, focusSub),
        next ? h('a', { class: 'focus-next', href: next.href }, next.text) : null,
      ),
    ),

    h('div', { class: 'home-grid' },
      // Hábitos: marcar sin salir de Inicio
      h('div', { class: 'card home-tile t-habits' },
        h('a', { class: 'tile-head', href: '#/' }, h('h2', {}, 'Hábitos'), h('span', { class: 'tile-go', 'aria-hidden': 'true' }, '›')),
        hb.total ? (chips.length ? h('div', { class: 'quick-habits' },
          chips.map((x) => {
            const on = isDone(x, state.entries[x.id]?.[today]);
            return quick(x)
              ? h('button', { class: `quick-habit ${on ? 'on' : ''}`, 'aria-pressed': String(on), onClick: () => ctx.logEntry(x, today, on ? null : 1) }, `${x.emoji} ${x.name}`)
              : h('a', { class: `quick-habit ${on ? 'on' : ''}`, href: '#/' }, `${x.emoji} ${x.name}`);
          }),
          more > 0 ? h('a', { class: 'quick-habit more', href: '#/' }, `+${more}`) : null,
        ) : h('p', { class: 'tile-note' }, 'Nada programado hoy.')) : h('a', { class: 'tile-cta', href: '#/nuevo' }, 'Crear un hábito'),
      ),

      // Finanzas: la cifra y el registro de un gasto a un toque
      h('div', { class: 'card home-tile t-finance' },
        h('a', { class: 'tile-head', href: '#/finanzas' }, h('h2', {}, 'Finanzas'), h('span', { class: 'tile-go', 'aria-hidden': 'true' }, '›')),
        hasFinance ? [
          ...((hl) => hl.mode === 'period' ? [
            h('b', { class: `tile-big ${p.funds && p.free < 0 ? 'neg' : ''}` }, money(hl.value)),
            h('p', { class: 'tile-note' }, p.funds ? `${money(p.perDay)} al día` : 'gastado este periodo'),
            p.funds ? h('p', { class: 'tile-note' }, `Cobro en ${days(p.daysLeft)}`) : null,
          ] : [
            h('b', { class: `tile-big ${hl.value < 0 ? 'neg' : ''}` }, money(hl.value)),
            h('p', { class: 'tile-note' }, headlineText(hl, p, money)),
          ])(headline(fin, today, p)),
          dueFixed.length || duePay.length ? h('a', { class: 'tile-alert', href: '#/finanzas' }, [
            duePay.length ? `${duePay.length} cobro${duePay.length === 1 ? '' : 's'} por registrar` : null,
            dueFixed.length ? `${dueFixed.length} gasto${dueFixed.length === 1 ? '' : 's'} por pagar` : null,
          ].filter(Boolean).join(', ')) : null,
          h('button', { class: 'tile-add', onClick: () => ctx.openEntry() }, '+ Gasto'),
        ] : h('a', { class: 'tile-cta', href: '#/finanzas' }, 'Configurar cuentas'),
      ),

      // Estudios
      h('div', { class: 'card home-tile t-study' },
        h('a', { class: 'tile-head', href: '#/estudio' }, h('h2', {}, 'Estudios'), h('span', { class: 'tile-go', 'aria-hidden': 'true' }, '›')),
        hasStudy ? (() => {
          const due = plan.overdue.length + plan.dueToday.length;
          const exam = plan.exams[0];
          const mins = minutesOn(study, today);
          return [
            h('b', { class: 'tile-big' }, due ? `${due} para hoy` : exam ? `Examen ${exam.pace.daysLeft === 0 ? 'hoy' : exam.pace.daysLeft === 1 ? 'mañana' : `en ${exam.pace.daysLeft} días`}` : 'Sin urgencias'),
            exam && due ? h('p', { class: 'tile-note' }, `${exam.exam.title}: ${exam.pace.daysLeft === 0 ? 'hoy' : exam.pace.daysLeft === 1 ? 'mañana' : `en ${exam.pace.daysLeft} días`}`) : null,
            h('p', { class: 'tile-note' }, `${mins ? formatMinutes(mins) : '0 min'} de ${formatMinutes(study.dailyGoal)}`),
            h('button', { class: 'tile-add', onClick: () => ctx.openStudy() }, '+ Añadir'),
          ];
        })() : [h('p', { class: 'tile-note' }, 'Apunta un examen o una tarea.'), h('button', { class: 'tile-add', onClick: () => ctx.openStudy() }, '+ Añadir')],
      ),
    ),

    top.length ? h('ul', { class: 'plain home-list' }, top.map((m) => h('li', {},
      h('a', { href: SOURCES[m.source][1], class: `src-tag src-${m.source}` }, SOURCES[m.source][0]),
      h('span', {}, m.short || m.text),
    ))) : null,

    backupOverdue(state) ? h('a', { class: 'home-backup', href: '#/ajustes' },
      daysSinceBackup() === null ? 'Haz tu primera copia de seguridad en Ajustes.' : `Última copia hace ${daysSinceBackup()} días. Haz una nueva en Ajustes.`) : null,
  );
}
