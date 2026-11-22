import { diffDays, formatDate } from '../../domain/dates.js';
import { advanceTopic, setTopicStatus, subjectOf, TOPIC_STATUS, toggleTask } from '../../domain/study.js';
import { h, toast } from '../dom.js';

// Piezas compartidas por las vistas de Estudios.

export const KIND = {
  task: { emoji: '📝', label: 'Tarea' },
  exam: { emoji: '🎓', label: 'Examen' },
  reading: { emoji: '📖', label: 'Lectura' },
};

/** "hoy", "mañana", "vencida hace 2 días", "vie 28 nov · en 6 días". */
export function dueLabel(date, today, { time = null, prefix = '' } = {}) {
  if (!date) return 'Sin fecha';
  const d = diffDays(today, date);
  const at = time ? ` · ${time}` : '';
  if (d < 0) return `${prefix}vencida hace ${-d} ${d === -1 ? 'día' : 'días'}`;
  if (d === 0) return `${prefix}hoy${at}`;
  if (d === 1) return `${prefix}mañana${at}`;
  return `${prefix}${formatDate(date, { weekday: 'short', day: 'numeric', month: 'short' })}${at} · en ${d} días`;
}

export function subjectTag(st, id) {
  const s = subjectOf(st, id);
  return s ? h('span', { class: 'tag subj-tag', style: { '--c': s.color } }, `${s.emoji} ${s.name}`) : null;
}

/** Fila de tarea: casilla (un toque la marca) + texto (abre la edición). */
export function taskRow(st, t, ctx, { onEdit } = {}) {
  const today = ctx.today();
  const late = t.due && t.due < today && !t.doneAt;
  const sub = subjectOf(st, t.subjectId);
  return h('div', { class: `study-row ${t.doneAt ? 'done' : ''}`, style: sub ? { '--c': sub.color } : null },
    h('button', {
      class: `task-check ${t.doneAt ? 'on' : ''}`, 'aria-label': t.doneAt ? `Desmarcar ${t.title}` : `Marcar hecha ${t.title}`, 'aria-pressed': String(Boolean(t.doneAt)),
      // Desmarcar también avisa con "Deshacer": un toque de más no debe perder lo hecho
      onClick: () => ctx.saveStudy(toggleTask(ctx.store.get().study, t.id, today), t.doneAt ? `«${t.title}» vuelve a pendiente` : `Hecho: ${t.title}`, { tone: t.doneAt ? '' : 'good' }),
    }, t.doneAt ? '✓' : ''),
    h('button', { class: 'study-text', onClick: () => onEdit?.(t) },
      h('span', { class: 'study-title' }, t.priority === 'alta' ? h('span', { class: 'prio', title: 'Importante' }, '!') : null, t.title),
      h('span', { class: `study-sub ${late ? 'neg' : ''}` }, [
        sub ? `${sub.emoji} ${sub.name}` : null,
        t.doneAt ? `hecha ${t.doneAt === today ? 'hoy' : formatDate(t.doneAt)}` : dueLabel(t.due, today, { time: t.time }),
        t.minutes && !t.doneAt ? `~${t.minutes >= 60 ? `${Math.round((t.minutes / 60) * 10) / 10} h`.replace('.', ',') : `${t.minutes} min`}` : null,
      ].filter(Boolean).join(' · ')),
    ),
  );
}

/**
 * Tema de examen: un toque avanza sin empezar → estudiado → repasado, con aviso y "Deshacer".
 * En repasado un toque no cambia nada: ofrece volver a empezar como acción explícita.
 */
export function topicChip(exam, topic, ctx) {
  const today = ctx.today();
  return h('button', {
    type: 'button', class: `topic s${topic.status}`, title: TOPIC_STATUS[topic.status],
    'aria-label': `${topic.name}: ${TOPIC_STATUS[topic.status].toLowerCase()}${topic.status < 2 ? `; tocar marca ${TOPIC_STATUS[topic.status + 1].toLowerCase()}` : ''}`,
    onClick: () => {
      const st = ctx.store.get().study;
      if (topic.status >= 2) {
        toast(`«${topic.name}» ya está repasado`, {
          action: 'Volver a sin empezar',
          onAction: () => ctx.saveStudy(setTopicStatus(ctx.store.get().study, exam.id, topic.id, 0, today), `«${topic.name}»: sin empezar`, { tone: '' }),
        });
        return;
      }
      ctx.saveStudy(advanceTopic(st, exam.id, topic, today), `«${topic.name}»: ${TOPIC_STATUS[topic.status + 1].toLowerCase()}`);
    },
  }, h('span', { class: 'topic-mark', 'aria-hidden': 'true' }, ['○', '◐', '●'][topic.status]), topic.name);
}

export const topicLegend = () => h('p', { class: 'legend small muted' },
  h('span', { class: 'legend-item' }, h('span', { class: 'topic-mark s0' }, '○'), ' sin empezar'),
  h('span', { class: 'legend-item' }, h('span', { class: 'topic-mark s1' }, '◐'), ' estudiado'),
  h('span', { class: 'legend-item' }, h('span', { class: 'topic-mark s2' }, '●'), ' repasado'),
  h('span', {}, '· un toque avanza'));

/** Barra de cobertura de un examen (estudiado = media barra; repasado = entera). */
export function coverageBar(exam) {
  const n = exam.topics.length || 1;
  const studied = exam.topics.filter((t) => t.status === 1).length;
  const reviewed = exam.topics.filter((t) => t.status === 2).length;
  return h('div', { class: 'coverage', role: 'img', 'aria-label': `${reviewed} repasados y ${studied} estudiados de ${exam.topics.length}` },
    h('span', { class: 'cov-reviewed', style: { width: `${(reviewed / n) * 100}%` } }),
    h('span', { class: 'cov-studied', style: { width: `${(studied / n) * 100}%` } }),
  );
}
