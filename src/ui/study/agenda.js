import { addDays, diffDays, formatDate, weekStart } from '../../domain/dates.js';
import { agendaItems, examCoverage, pagesRead } from '../../domain/study.js';
import { exportCount, studyToICS } from '../../domain/ics.js';
import { saveFile } from '../../backup.js';
import { h, toast } from '../dom.js';
import { dueLabel, KIND, subjectTag, taskRow } from './parts.js';
import { openImportSheet, openItemSheet } from './sheets.js';

const FILTERS = [['all', 'Todo'], ['task', 'Tareas'], ['exam', 'Exámenes'], ['reading', 'Lecturas']];

/** Grupo de una fecha: vencidas, esta semana, la próxima, semana del…, sin fecha. */
function groupOf(date, today) {
  if (!date) return ['~', 'Sin fecha'];
  if (date < today) return ['0', 'Vencidas'];
  const ws = weekStart(today);
  const w = weekStart(date);
  if (w === ws) return [`1${w}`, 'Esta semana'];
  if (w === addDays(ws, 7)) return [`1${w}`, 'La semana que viene'];
  return [`1${w}`, `Semana del ${formatDate(w, { day: 'numeric', month: 'short' })}`];
}

/** Estudios → Agenda: todo lo que viene, por semanas, y el calendario (.ics). */
export function agendaView(state, ctx) {
  const st = state.study;
  const today = ctx.today();
  const kind = ctx.ui.studyFilter || 'all';
  const items = agendaItems(st, today, { kind });
  const groups = new Map();
  for (const it of items) {
    const [key, label] = groupOf(it.date, today);
    if (!groups.has(key)) groups.set(key, { label, items: [] });
    groups.get(key).items.push(it);
  }
  const done = st.tasks.filter((t) => t.doneAt && diffDays(t.doneAt, today) <= 14).sort((a, b) => b.doneAt.localeCompare(a.doneAt));

  return h('section', { class: 'view study' },
    h('div', { class: 'card-head' },
      h('h1', {}, 'Agenda'),
      h('button', { class: 'btn ghost small', onClick: () => openItemSheet(ctx, { type: kind === 'all' ? 'task' : kind }) }, '＋ Añadir'),
    ),
    h('div', { class: 'seg' }, FILTERS.map(([k, label]) => h('button', { type: 'button', class: kind === k ? 'on' : '', onClick: () => { ctx.ui.studyFilter = k; ctx.rerender(); } }, label))),

    groups.size ? [...groups].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, g]) => h('div', { class: 'card' },
      h('h2', { class: key === '0' ? 'neg' : '' }, g.label, h('span', { class: 'muted count' }, ` · ${g.items.length}`)),
      h('div', { class: 'study-list' }, g.items.map((it) => agendaRow(st, it, ctx))),
    )) : h('div', { class: 'card empty-note' },
      h('p', { class: 'muted' }, kind === 'all' ? 'No tienes nada pendiente.' : `No hay ${FILTERS.find(([k]) => k === kind)[1].toLowerCase()} pendientes.`),
      h('button', { class: 'btn primary', onClick: () => openItemSheet(ctx, { type: kind === 'all' ? 'task' : kind }) }, '＋ Añadir'),
    ),

    done.length && (kind === 'all' || kind === 'task') ? h('details', { class: 'card' },
      h('summary', {}, `Hechas en las últimas 2 semanas (${done.length})`),
      h('div', { class: 'study-list' }, done.map((t) => taskRow(st, t, ctx, { onEdit: (x) => openItemSheet(ctx, { type: 'task', item: x }) }))),
    ) : null,

    calendarCard(ctx),
  );
}

function agendaRow(st, it, ctx) {
  const today = ctx.today();
  if (it.kind === 'task') return taskRow(st, it.item, ctx, { onEdit: (t) => openItemSheet(ctx, { type: 'task', item: t }) });
  const x = it.item;
  const sub = it.kind === 'exam'
    ? [dueLabel(x.date, today, { time: x.time }), x.topics.length ? `${Math.round(examCoverage(x) * 100)} % preparado` : 'sin temas'].join(' · ')
    : [`${pagesRead(x)} de ${x.pages} págs`, x.deadline ? dueLabel(x.deadline, today, { prefix: 'plazo ' }) : null].filter(Boolean).join(' · ');
  return h('div', { class: `study-row kind-${it.kind}` },
    h('span', { class: 'kind-icon', 'aria-hidden': 'true' }, KIND[it.kind].emoji),
    h('button', { class: 'study-text', onClick: () => openItemSheet(ctx, { type: it.kind, item: x }) },
      h('span', { class: 'study-title' }, x.title),
      h('span', { class: 'study-sub' }, sub),
    ),
    subjectTag(st, x.subjectId),
  );
}

/** Apple Calendar: exportar (.ics a la hoja de Compartir) e importar un .ics. */
export function calendarCard(ctx) {
  const st = ctx.store.get().study;
  const today = ctx.today();
  const n = exportCount(st, today);
  const file = h('input', {
    type: 'file', accept: '.ics,text/calendar', hidden: true,
    onChange: async (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) openImportSheet(ctx, await f.text());
    },
  });
  return h('div', { class: 'card calendar-card' },
    h('h2', {}, '📅 Apple Calendar'),
    h('p', { class: 'muted small' }, n
      ? `Exporta ${n} ${n === 1 ? 'evento' : 'eventos'} (exámenes con aviso el día antes, entregas y plazos de lectura). En el iPhone se abre la hoja de Compartir: elige Calendario (o Guardar en Archivos y ábrelo desde ahí) y pulsa «Añadir todo». Cada evento lleva un identificador fijo, así que al volver a exportar tras cambiar una fecha el calendario debería actualizarlo en vez de duplicarlo.`
      : 'Cuando tengas exámenes o entregas con fecha podrás añadirlos a tu calendario.'),
    h('div', { class: 'actions' },
      h('button', {
        class: 'btn primary', disabled: !n,
        onClick: async () => {
          const res = await saveFile(studyToICS(ctx.store.get().study, today), `estudios-${today}.ics`, { type: 'text/calendar', title: 'Estudios' });
          if (res === 'downloaded') toast('Archivo .ics descargado: ábrelo para añadirlo al Calendario.', { timeout: 5000 });
        },
      }, 'Exportar al calendario'),
      h('button', { class: 'btn', onClick: () => file.click() }, 'Importar .ics'),
      file,
    ),
    h('details', { class: 'guide' },
      h('summary', { class: 'small' }, '¿De dónde saco un .ics?'),
      h('ul', { class: 'small' },
        h('li', {}, 'Moodle: Calendario → Exportar calendario → «Todos los eventos» → Exportar. Canvas y Blackboard tienen una opción parecida.'),
        h('li', {}, 'Calendario del Mac: Archivo → Exportar → Exportar… sobre el calendario que quieras.'),
        h('li', {}, 'Lo que ya importaste se actualiza al importar de nuevo, sin duplicar.'),
      ),
    ),
  );
}
