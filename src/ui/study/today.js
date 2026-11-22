import { formatDate } from '../../domain/dates.js';
import { dayPlan, examCoverage, formatMinutes, hasStudyData, logPages, minutesOn, studyStreak } from '../../domain/study.js';
import { h } from '../dom.js';
import { ring } from '../charts.js';
import { coverageBar, dueLabel, subjectTag, taskRow, topicChip } from './parts.js';
import { openItemSheet, openSessionSheet } from './sheets.js';
import { calendarCard } from './agenda.js';

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;

/**
 * Estudios → Hoy. Arriba, el tiempo estudiado; después "Ahora": lo que toca hoy (entregas,
 * los temas del examen más cercano, las páginas del día), cada cosa a un toque. Lo demás
 * (otros exámenes, lecturas, próximos días) va debajo y plegado. Sin mensajes sueltos: cada
 * cifra vive en su fila, para no decir lo mismo dos veces.
 */
export function studyTodayView(state, ctx) {
  const st = state.study;
  const today = ctx.today();
  if (!hasStudyData(st) && !st.subjects.length) return emptyView(ctx);

  const plan = dayPlan(st, today);
  const mins = minutesOn(st, today);
  const streak = studyStreak(st, today);
  const edit = (t) => openItemSheet(ctx, { type: 'task', item: t });

  // "Ahora": entregas de hoy (y vencidas), el examen más cercano con trabajo hoy, lecturas con páginas hoy
  const tasksNow = [...plan.overdue, ...plan.dueToday];
  const examNow = plan.exams.find((x) => x.pace.today > 0 || x.pace.doneToday > 0) || null;
  const readingsNow = plan.readings.filter(({ pace }) => pace.perDay !== null && pace.left > 0 && (pace.today > 0 || pace.readToday > 0));
  const otherExams = plan.exams.filter((x) => x !== examNow);
  const otherReadings = plan.readings.filter((x) => !readingsNow.includes(x));
  const pendingNow = tasksNow.length + (examNow?.pace.today ? 1 : 0) + readingsNow.filter(({ pace }) => pace.today > 0).length;
  const hadWork = plan.doneToday.length || examNow || readingsNow.length;
  const upcoming = [...plan.tomorrow, ...plan.soon];

  return h('section', { class: 'view study' },
    h('header', { class: 'home-head' },
      h('h1', {}, 'Hoy'),
      h('p', { class: 'muted' }, cap(formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' }))),
    ),

    h('div', { class: 'card summary study-summary' },
      ring(mins / st.dailyGoal, { size: 56, stroke: 6, label: mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? String(mins % 60).padStart(2, '0') : ''}` : `${mins}′` }),
      h('div', {},
        h('b', {}, `${formatMinutes(mins)} de ${formatMinutes(st.dailyGoal)}`),
        h('p', { class: 'muted small' }, [
          mins >= st.dailyGoal ? 'objetivo cumplido' : `faltan ${formatMinutes(st.dailyGoal - mins)}`,
          streak.current >= 2 ? `racha de ${streak.current} días` : null,
        ].filter(Boolean).join(' · ')),
      ),
      h('button', { class: 'btn primary', onClick: () => openSessionSheet(ctx) }, '＋ Estudio'),
    ),

    h('div', { class: 'card now-card' },
      h('div', { class: 'card-head' },
        h('h2', {}, 'Ahora'),
        h('button', { class: 'btn ghost small', onClick: () => openItemSheet(ctx, { type: 'task', date: today }) }, '＋ Tarea'),
      ),
      !pendingNow && hadWork ? h('p', { class: 'now-done' }, 'Todo lo de hoy, hecho.') : null,
      tasksNow.length || plan.doneToday.length
        ? h('div', { class: 'study-list' }, [...tasksNow, ...plan.doneToday].map((t) => taskRow(st, t, ctx, { onEdit: edit })))
        : null,
      examNow ? examBlock(st, examNow, ctx, { compact: true }) : null,
      readingsNow.map((x) => readingRow(x, ctx)),
      !tasksNow.length && !plan.doneToday.length && !examNow && !readingsNow.length
        ? h('p', { class: 'muted small' }, nextUp(plan, today))
        : null,
    ),

    otherExams.length ? h('div', { class: 'card' },
      h('h2', {}, 'Otros exámenes'),
      h('div', { class: 'exam-lines' }, otherExams.map((x) => h('details', { class: 'exam-line' },
        h('summary', {},
          h('span', { class: 'study-text' },
            h('span', { class: 'study-title' }, x.exam.title),
            h('span', { class: 'study-sub' }, [
              dueLabel(x.exam.date, today),
              x.exam.topics.length ? `${Math.round(examCoverage(x.exam) * 100)} % preparado` : 'sin temas',
            ].join(' · ')),
          ),
          x.pace.today ? h('span', { class: 'tag' }, `hoy ${n(x.pace.today, 'tema', 'temas')}`) : null,
        ),
        examBlock(st, x, ctx),
      ))),
    ) : null,

    otherReadings.length ? h('div', { class: 'card' },
      h('h2', {}, 'Lecturas'),
      h('div', { class: 'study-list' }, otherReadings.map((x) => readingRow(x, ctx))),
    ) : null,

    upcoming.length ? h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Próximos días'), h('a', { class: 'small', href: '#/estudio/agenda' }, 'Agenda')),
      h('div', { class: 'study-list' }, upcoming.map((t) => taskRow(st, t, ctx, { onEdit: edit }))),
    ) : null,

    plan.undated.length ? h('details', { class: 'card undated' },
      h('summary', {}, `Sin fecha (${plan.undated.length})`),
      h('div', { class: 'study-list' }, plan.undated.map((t) => taskRow(st, t, ctx, { onEdit: edit }))),
    ) : null,
  );
}

/** Lo siguiente cuando hoy no hay nada: la primera entrega o examen que viene. */
function nextUp(plan, today) {
  const next = plan.tomorrow[0] || plan.soon[0];
  const exam = plan.exams[0];
  if (next && (!exam || next.due <= exam.exam.date)) return `Nada para hoy. Lo siguiente: «${next.title}», ${dueLabel(next.due, today)}.`;
  if (exam) return `Nada para hoy. Lo siguiente: ${exam.exam.title}, ${dueLabel(exam.exam.date, today)}.`;
  return 'Nada para hoy.';
}

/** Un examen: ritmo, temas de hoy y acciones. compact = dentro de "Ahora" (con título). */
function examBlock(st, { exam, pace, topics }, ctx, { compact = false } = {}) {
  const today = ctx.today();
  return h('div', { class: `exam-block ${compact ? 'compact' : ''}` },
    compact ? h('div', { class: 'exam-block-head' },
      h('div', { class: 'study-text' },
        h('span', { class: 'study-title' }, exam.title),
        h('span', { class: 'study-sub' }, dueLabel(exam.date, today, { time: exam.time })),
      ),
      subjectTag(st, exam.subjectId),
    ) : null,
    exam.topics.length ? coverageBar(exam) : null,
    h('p', { class: 'small pace-line' }, paceText(pace)),
    topics.length ? h('div', { class: 'topics' }, topics.map((t) => topicChip(exam, t, ctx))) : null,
    compact ? null : h('div', { class: 'actions' },
      h('button', { class: 'btn ghost small', onClick: () => openSessionSheet(ctx, { examId: exam.id }) }, '⏱ Registrar estudio'),
      exam.topics.length
        ? h('a', { class: 'small', href: '#/estudio/examenes' }, 'Ver todos los temas')
        : h('button', { class: 'btn ghost small', onClick: () => openItemSheet(ctx, { type: 'exam', item: exam }) }, '＋ Temas'),
    ),
  );
}

/** Lectura: páginas de hoy y botones rápidos (+5, +10; − para corregir lo de hoy). */
function readingRow({ reading: r, pace }, ctx) {
  const today = ctx.today();
  const behind = pace.perDay && pace.recent > 0 && pace.recent < pace.perDay;
  return h('div', { class: 'reading-row' },
    h('button', { class: 'study-text', onClick: () => openItemSheet(ctx, { type: 'reading', item: r }) },
      h('span', { class: 'study-title' }, `📖 ${r.title}`),
      h('span', { class: 'study-sub' }, [
        pace.left <= 0 ? 'terminada' : pace.perDay !== null ? (pace.today ? `hoy ${pace.today} págs` : 'lo de hoy, hecho') : null,
        pace.left > 0 ? `quedan ${pace.left} de ${r.pages}` : null,
        r.deadline ? dueLabel(r.deadline, today, { prefix: 'plazo ' }) : null,
        behind ? `vas a ${String(Math.round(pace.recent * 10) / 10).replace('.', ',')}/día` : null,
      ].filter(Boolean).join(' · ')),
      h('span', { class: 'bar thin' }, h('span', { style: { width: `${(pace.read / r.pages) * 100}%` } })),
    ),
    h('div', { class: 'page-steps' },
      pace.readToday ? h('button', {
        class: 'step', 'aria-label': `Quitar ${Math.min(5, pace.readToday)} páginas de hoy`,
        onClick: () => ctx.saveStudy(logPages(ctx.store.get().study, r.id, today, -Math.min(5, pace.readToday)), `−${Math.min(5, pace.readToday)} págs · ${r.title}`, { tone: '' }),
      }, '−') : null,
      [5, 10].map((k) => h('button', { class: 'chip', disabled: pace.left <= 0, 'aria-label': `Sumar ${k} páginas`, onClick: () => ctx.saveStudy(logPages(ctx.store.get().study, r.id, today, k), `+${k} págs · ${r.title}`) }, `+${k}`)),
    ),
  );
}

/** Ritmo de un examen en una línea: "Hoy: 1 tema · quedan 5 de 8". */
export function paceText(p) {
  if (p.action === 'none') return 'Sin temas: añádelos para calcular cuántos tocan cada día.';
  if (p.action === 'ready') return `Los ${p.total} temas, repasados.`;
  if (p.action === 'study' && !p.unstudied) return `Todos estudiados · quedan ${n(p.unreviewed, 'repaso', 'repasos')}`;
  const review = p.action === 'review';
  const left = review ? p.unreviewed : p.unstudied;
  const what = review ? 'por repasar' : 'por estudiar';
  if (!p.today) return `Lo de hoy, hecho · quedan ${left} ${what}`;
  return `Hoy: ${review ? 'repasar ' : ''}${n(p.today, 'tema', 'temas')}${p.doneToday ? ` más (llevas ${p.doneToday})` : ''} · quedan ${left} de ${p.total} ${what}`;
}

function emptyView(ctx) {
  return h('section', { class: 'view study' },
    h('div', { class: 'card invite-hero' },
      h('h1', {}, 'Tu panel de estudio'),
      h('p', {}, 'Apunta tareas, exámenes y lecturas, y cada día te digo qué toca: qué entregar, cuántos temas estudiar para llegar al examen con un día de repaso y cuántas páginas leer.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => openItemSheet(ctx, { type: 'exam' }) }, '＋ Añadir un examen'),
        h('button', { class: 'btn', onClick: () => openItemSheet(ctx, { type: 'task' }) }, '＋ Añadir una tarea'),
      ),
      h('button', { class: 'linklike', onClick: () => ctx.loadStudyDemo() }, 'Ver con datos de ejemplo'),
    ),
    calendarCard(ctx),
  );
}
