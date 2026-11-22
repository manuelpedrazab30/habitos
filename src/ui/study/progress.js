import { addDays, formatDate } from '../../domain/dates.js';
import {
  examCoverage, formatMinutes, gradeSummary, minutesByDay, minutesBySubject, onTimeRate, saveDailyGoal, studyStreak, upcomingExams, weeklyMinutes,
} from '../../domain/study.js';
import { escapeHtml, h } from '../dom.js';
import { barChart, heatmap } from '../charts.js';
import { openSubjectSheet } from './sheets.js';

const hours = (m) => String(Math.round((m / 60) * 10) / 10).replace('.', ',');

/** Estudios → Progreso: horas, racha, entregas a tiempo, notas y en qué se va el tiempo. */
export function studyProgressView(state, ctx) {
  const st = state.study;
  const today = ctx.today();
  const weeks = weeklyMinutes(st, today, 8);
  const thisWeek = weeks[weeks.length - 1].minutes;
  const streak = studyStreak(st, today);
  const onTime = onTimeRate(st, today);
  const grades = gradeSummary(st);
  const bySubject = minutesBySubject(st, addDays(today, -27), today);
  const maxSub = Math.max(1, ...bySubject.map((x) => x.minutes));
  const byDay = minutesByDay(st);
  const goalWeek = st.dailyGoal * 7;
  const exams = upcomingExams(st, today).filter((e) => e.topics.length);

  return h('section', { class: 'view study' },
    h('h1', {}, 'Progreso'),
    h('div', { class: 'kpis' },
      h('div', { class: 'card kpi' }, h('small', { class: 'muted' }, 'Esta semana'), h('b', {}, formatMinutes(thisWeek)), h('small', { class: 'muted' }, `objetivo ${formatMinutes(goalWeek)}`)),
      h('div', { class: 'card kpi' }, h('small', { class: 'muted' }, 'Racha'), h('b', {}, `${streak.current} ${streak.current === 1 ? 'día' : 'días'}`), h('small', { class: 'muted' }, `récord ${streak.best}`)),
      h('div', { class: 'card kpi' }, h('small', { class: 'muted' }, 'Entregas a tiempo'), h('b', {}, onTime.rate === null ? '–' : `${Math.round(onTime.rate * 100)} %`), h('small', { class: 'muted' }, onTime.total ? `${onTime.onTime} de ${onTime.total}` : 'sin entregas aún')),
      h('div', { class: 'card kpi' }, h('small', { class: 'muted' }, 'Nota media'), h('b', {}, grades.average === null ? '–' : String(Math.round(grades.average * 100) / 100).replace('.', ',')), h('small', { class: 'muted' }, grades.count ? `${grades.count} ${grades.count === 1 ? 'examen' : 'exámenes'}` : 'pon notas en Exámenes')),
    ),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Horas por semana'), h('span', { class: 'muted small' }, `línea: objetivo de ${hours(goalWeek)} h`)),
      barChart({
        bars: weeks.map((w, i) => ({
          label: i === weeks.length - 1 ? 'Esta' : formatDate(w.from, { day: 'numeric', month: 'short' }),
          value: w.minutes / 60,
          tip: `Semana del ${escapeHtml(formatDate(w.from, { day: 'numeric', month: 'short' }))}: ${escapeHtml(formatMinutes(w.minutes))}`,
        })),
        color: 'var(--accent)', goal: goalWeek / 60, format: (v) => hours(v * 60),
      }),
    ),

    h('div', { class: 'card' },
      h('h2', {}, 'Días de estudio'),
      heatmap({
        from: addDays(today, -7 * 26 + 1), to: today, today,
        value: (k) => (k > today ? null : byDay[k] ? Math.min(1, byDay[k] / Math.max(1, st.dailyGoal)) : 0),
        label: (k) => `${escapeHtml(formatDate(k, { weekday: 'short', day: 'numeric', month: 'short' }))}: ${byDay[k] ? escapeHtml(formatMinutes(byDay[k])) : 'sin estudio registrado'}`,
        color: 'var(--accent)',
      }),
      h('p', { class: 'muted small' }, 'Más intenso cuanto más cerca del objetivo diario.'),
    ),

    bySubject.length ? h('div', { class: 'card' },
      h('h2', {}, 'Por asignatura (últimos 28 días)'),
      h('ul', { class: 'plain cat-list' }, bySubject.map((x) => h('li', {},
        h('div', { class: 'cat-row static subj-row', style: { '--c': x.subject?.color || 'var(--muted)' } },
          h('span', { class: 'emoji' }, x.subject?.emoji || '•'),
          h('span', { class: 'cat-name' }, x.subject?.name || 'Sin asignatura'),
          h('span', { class: 'cat-amount' }, formatMinutes(x.minutes)),
          // El color va como --c (no background directo) para que los temas puedan reasignarlo
          h('span', { class: 'bar cat-bar' }, h('span', { style: { width: `${(x.minutes / maxSub) * 100}%` } })),
        ),
      ))),
    ) : null,

    exams.length ? h('div', { class: 'card' },
      h('h2', {}, 'Preparación de exámenes'),
      h('ul', { class: 'plain cat-list' }, exams.map((e) => h('li', {},
        h('a', { class: 'cat-row static', href: '#/estudio/examenes' },
          h('span', { class: 'emoji' }, '🎓'),
          h('span', { class: 'cat-name' }, e.title, h('small', { class: 'muted block' }, formatDate(e.date, { weekday: 'short', day: 'numeric', month: 'short' }))),
          h('span', { class: 'cat-amount' }, `${Math.round(examCoverage(e) * 100)} %`),
          h('span', { class: 'bar cat-bar' }, h('span', { style: { width: `${examCoverage(e) * 100}%` } })),
        ),
      ))),
    ) : null,

    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Asignaturas'), h('button', { class: 'btn ghost small', onClick: () => openSubjectSheet(ctx) }, '＋ Asignatura')),
      st.subjects.length ? h('ul', { class: 'plain settings-list' }, st.subjects.map((s) => h('li', {},
        h('button', { class: 'settings-row', style: { '--c': s.color }, onClick: () => openSubjectSheet(ctx, s) },
          h('span', { class: 'emoji' }, s.emoji), h('span', { class: 'grow' }, s.name), h('span', { class: 'dot-c' })),
      ))) : h('p', { class: 'muted small' }, 'Añade tus asignaturas para ver en qué se te va el tiempo.'),
    ),

    h('div', { class: 'card' },
      h('h2', {}, 'Objetivo diario'),
      h('div', { class: 'chips' }, [30, 60, 90, 120, 180, 240].map((m) => h('button', {
        type: 'button', class: `chip ${st.dailyGoal === m ? 'on' : ''}`,
        onClick: () => ctx.saveStudy(saveDailyGoal(ctx.store.get().study, m), `Objetivo: ${formatMinutes(m)} al día`),
      }, formatMinutes(m)))),
    ),

    h('button', { class: 'linklike', onClick: () => ctx.clearStudy() }, 'Borrar todos los datos de estudios'),
  );
}
