import { examPace, gradeSummary, minutesBetween, pastExams, setGrade, subjectOf, upcomingExams, formatMinutes } from '../../domain/study.js';
import { formatDate } from '../../domain/dates.js';
import { h } from '../dom.js';
import { coverageBar, dueLabel, subjectTag, topicChip, topicLegend } from './parts.js';
import { openItemSheet, openSessionSheet } from './sheets.js';
import { paceText } from './today.js';

const fmtGrade = (g) => (g === null ? '–' : String(Math.round(g * 100) / 100).replace('.', ','));

/** Estudios → Exámenes: cada examen con todos sus temas (marcables) y, abajo, las notas. */
export function examsView(state, ctx) {
  const st = state.study;
  const today = ctx.today();
  const upcoming = upcomingExams(st, today);
  const past = pastExams(st, today);
  const grades = gradeSummary(st);

  return h('section', { class: 'view study' },
    h('div', { class: 'card-head' },
      h('h1', {}, 'Exámenes'),
      h('button', { class: 'btn ghost small', onClick: () => openItemSheet(ctx, { type: 'exam' }) }, '＋ Examen'),
    ),

    upcoming.length ? [
      topicLegend(),
      ...upcoming.map((e) => {
        const pace = examPace(e, today);
        const studied = minutesBetween(st, e.createdAt < today ? e.createdAt : today, today, (s) => s.examId === e.id);
        return h('div', { class: 'card exam-card' },
          h('div', { class: 'card-head' },
            h('div', {},
              h('h2', {}, e.title),
              h('p', { class: 'muted small' }, [dueLabel(e.date, today, { time: e.time }), studied ? `${formatMinutes(studied)} estudiados` : null].filter(Boolean).join(' · ')),
            ),
            h('div', { class: 'head-actions' },
              subjectTag(st, e.subjectId),
              h('button', { class: 'icon-btn small', 'aria-label': `Editar ${e.title}`, onClick: () => openItemSheet(ctx, { type: 'exam', item: e }) }, '✎'),
            ),
          ),
          e.topics.length ? coverageBar(e) : null,
          h('p', { class: 'small pace-line' }, paceText(pace)),
          e.topics.length ? h('div', { class: 'topics' }, e.topics.map((t) => topicChip(e, t, ctx))) : null,
          h('div', { class: 'actions' },
            h('button', { class: 'btn ghost small', onClick: () => openSessionSheet(ctx, { examId: e.id }) }, '⏱ Registrar estudio'),
            !e.topics.length ? h('button', { class: 'btn ghost small', onClick: () => openItemSheet(ctx, { type: 'exam', item: e }) }, '＋ Temas') : null,
          ),
        );
      }),
    ] : h('div', { class: 'card empty-note' },
      h('p', { class: 'muted' }, 'No tienes exámenes próximos. Añade uno con sus temas y te diré cuántos estudiar cada día.'),
      h('button', { class: 'btn primary', onClick: () => openItemSheet(ctx, { type: 'exam' }) }, '＋ Añadir examen'),
    ),

    past.length ? h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', {}, 'Notas'),
        grades.average !== null ? h('span', { class: 'muted small' }, `Media ${fmtGrade(grades.average)} (${grades.count})`) : null,
      ),
      h('ul', { class: 'plain grade-list' }, past.slice(0, 20).map((e) => h('li', { class: 'grade-row' },
        h('button', { class: 'study-text', onClick: () => openItemSheet(ctx, { type: 'exam', item: e }) },
          h('span', { class: 'study-title' }, e.title),
          h('span', { class: 'study-sub' }, [subjectOf(st, e.subjectId)?.name, formatDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })].filter(Boolean).join(' · ')),
        ),
        h('input', {
          class: 'grade-input', type: 'text', inputmode: 'decimal', placeholder: 'Nota', 'aria-label': `Nota de ${e.title}`,
          value: e.grade === null ? '' : fmtGrade(e.grade),
          onChange: (ev) => {
            const v = ev.target.value.trim().replace(',', '.');
            ctx.saveStudy(setGrade(ctx.store.get().study, e.id, v === '' ? null : v), v === '' ? null : `Nota guardada: ${e.title}`);
          },
        }),
      ))),
      grades.bySubject.length > 1 ? h('p', { class: 'muted small' }, grades.bySubject.map((x) => `${x.subject.name} ${fmtGrade(x.average)}`).join(' · ')) : null,
    ) : null,
  );
}
