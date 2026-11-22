import { addDays, formatDate } from '../../domain/dates.js';
import {
  addSession, deleteExam, deleteReading, deleteSubject, deleteTask, pagesRead, saveExam, saveReading, saveSubject, saveTask,
  parseTopics, subjectInUse, SUBJECT_COLORS, SUBJECT_EMOJIS, upcomingExams,
} from '../../domain/study.js';
import { applyImport, importPreview, parseICS } from '../../domain/ics.js';
import { h, toast } from '../dom.js';
import { openSheet } from '../sheet.js';
import { KIND } from './parts.js';

// Hojas de Estudios: alta/edición de tarea, examen o lectura; registrar estudio; asignatura;
// e importar un calendario (.ics).

const head = (title, close) => h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn small', 'aria-label': 'Cerrar', onClick: close }, '✕'));
const label = (text) => h('span', { class: 'entry-label' }, text);

function subjectPicker(ctx, selected, onPick, repaint) {
  const st = ctx.store.get().study;
  return h('div', { class: 'entry-block' },
    label('Asignatura'),
    h('div', { class: 'chips' },
      st.subjects.map((s) => h('button', {
        type: 'button', class: `chip pick ${s.id === selected ? 'on' : ''}`, style: { '--c': s.color }, 'aria-pressed': String(s.id === selected),
        onClick: () => { onPick(s.id === selected ? null : s.id); repaint(); },
      }, `${s.emoji} ${s.name}`)),
      h('button', { type: 'button', class: 'chip dashed', onClick: () => openSubjectSheet(ctx, null, (id) => { onPick(id); repaint(); }) }, '＋ Asignatura'),
    ),
  );
}

/**
 * Alta o edición de una tarea, un examen o una lectura.
 * opts: { type: 'task'|'exam'|'reading', item, date }
 */
export function openItemSheet(ctx, { type = 'task', item = null, date = null } = {}) {
  const today = ctx.today();
  const editing = Boolean(item?.id);
  const d = {
    type,
    title: item?.title || '',
    subjectId: item?.subjectId ?? null,
    date: item?.due ?? item?.date ?? item?.deadline ?? date ?? (type === 'task' ? today : null),
    time: item?.time || '',
    minutes: item?.minutes ?? null,
    priority: item?.priority || 'normal',
    notes: item?.notes || '',
    topics: item?.topics ? item.topics.map((t) => t.name).join('\n') : '',
    pages: item?.pages ?? '',
  };
  let error = '';

  openSheet((close) => {
    const root = h('div', { class: 'sheet-form' });
    const titleInput = h('input', {
      type: 'text', class: 'title-input', value: d.title, maxlength: 160, enterkeyhint: 'done', 'aria-label': 'Título',
      onInput: (e) => { d.title = e.target.value; },
      onKeydown: (e) => { if (e.key === 'Enter' && d.type !== 'exam') { e.preventDefault(); save(); } },
    });

    function save() {
      const st = ctx.store.get().study;
      const base = { id: item?.id, title: d.title, subjectId: d.subjectId, notes: d.notes };
      try {
        let next;
        if (d.type === 'task') next = saveTask(st, { ...base, due: d.date || null, time: d.date ? d.time || null : null, minutes: d.minutes, priority: d.priority }, today);
        else if (d.type === 'exam') next = saveExam(st, { ...base, date: d.date, time: d.time || null, topics: parseTopics(d.topics) }, today);
        else next = saveReading(st, { id: item?.id, title: d.title, subjectId: d.subjectId, pages: d.pages, deadline: d.date || null }, today);
        ctx.saveStudy(next, editing ? 'Guardado' : `${KIND[d.type].label} añadida`.replace('Examen añadida', 'Examen añadido'));
        close();
      } catch (e) {
        error = e.message;
        paint();
      }
    }
    function remove() {
      const st = ctx.store.get().study;
      const next = d.type === 'task' ? deleteTask(st, item.id) : d.type === 'exam' ? deleteExam(st, item.id) : deleteReading(st, item.id);
      ctx.saveStudy(next, `Borrado: ${item.title}`);
      close();
    }

    const dateChips = (opts) => h('div', { class: 'chips' }, opts.map(([k, text]) => h('button', {
      type: 'button', class: `chip ${d.date === k ? 'on' : ''}`, onClick: () => { d.date = k; paint(); },
    }, text)));

    function paint() {
      const ph = { task: 'Qué hay que hacer', exam: 'Nombre del examen', reading: 'Título del libro o artículo' }[d.type];
      titleInput.placeholder = ph;
      const reading = d.type === 'reading' && item ? pagesRead(item) : 0;
      root.replaceChildren(...[
        head(editing ? `Editar ${KIND[d.type].label.toLowerCase()}` : 'Añadir', close),
        editing ? null : h('div', { class: 'seg' }, Object.entries(KIND).map(([k, v]) => h('button', {
          type: 'button', class: d.type === k ? 'on' : '',
          onClick: () => { d.type = k; if (k !== 'task' && d.date === today) d.date = null; if (k === 'task' && !d.date) d.date = today; error = ''; paint(); },
        }, `${v.emoji} ${v.label}`))),
        titleInput,
        subjectPicker(ctx, d.subjectId, (id) => { d.subjectId = id; }, paint),

        d.type === 'task' ? h('div', { class: 'entry-block' },
          label('Entrega'),
          h('div', { class: 'row-inline' },
            dateChips([[today, 'Hoy'], [addDays(today, 1), 'Mañana'], [addDays(today, 7), 'En una semana'], [null, 'Sin fecha']]),
            h('input', { type: 'date', class: 'date-input', value: d.date || '', 'aria-label': 'Fecha de entrega', onChange: (e) => { d.date = e.target.value || null; paint(); } }),
          ),
          d.date ? h('label', { class: 'inline-label' }, 'Hora (opcional) ', h('input', { type: 'time', value: d.time, onChange: (e) => { d.time = e.target.value; } })) : null,
        ) : null,

        d.type === 'task' ? h('div', { class: 'entry-block' },
          label('Tiempo estimado'),
          h('div', { class: 'chips' },
            [[30, '30 min'], [60, '1 h'], [120, '2 h'], [240, '4 h']].map(([m, text]) => h('button', {
              type: 'button', class: `chip ${d.minutes === m ? 'on' : ''}`, onClick: () => { d.minutes = d.minutes === m ? null : m; paint(); },
            }, text)),
            h('button', { type: 'button', class: `chip ${d.priority === 'alta' ? 'on' : ''}`, 'aria-pressed': String(d.priority === 'alta'), onClick: () => { d.priority = d.priority === 'alta' ? 'normal' : 'alta'; paint(); } }, '! Importante'),
          ),
        ) : null,

        d.type === 'exam' ? h('div', { class: 'entry-block' },
          label('Fecha del examen'),
          h('div', { class: 'row-inline' },
            h('input', { type: 'date', class: 'date-input', value: d.date || '', min: editing ? null : today, 'aria-label': 'Fecha del examen', onChange: (e) => { d.date = e.target.value || null; error = ''; paint(); } }),
            h('label', { class: 'inline-label' }, 'Hora ', h('input', { type: 'time', value: d.time, onChange: (e) => { d.time = e.target.value; } })),
          ),
        ) : null,
        d.type === 'exam' ? h('div', { class: 'entry-block' },
          label('Temas (uno por línea)'),
          h('textarea', { rows: 5, placeholder: 'Límites\nDerivadas\nIntegrales', 'aria-label': 'Temas', onInput: (e) => { d.topics = e.target.value; } }, d.topics),
          h('small', { class: 'muted' }, 'Con los temas calculo cuántos tocan cada día, dejando la víspera para repasar.'),
        ) : null,

        d.type === 'reading' ? h('div', { class: 'entry-block row-inline' },
          h('label', { class: 'field' }, 'Páginas', h('input', { type: 'number', inputmode: 'numeric', min: 1, value: d.pages, onInput: (e) => { d.pages = e.target.value; } })),
          h('label', { class: 'field' }, 'Plazo (opcional)', h('input', { type: 'date', value: d.date || '', onChange: (e) => { d.date = e.target.value || null; } })),
        ) : null,
        d.type === 'reading' && editing ? h('small', { class: 'muted' }, `Llevas ${reading} de ${item.pages} páginas. Las páginas se apuntan desde Hoy.`) : null,

        d.type !== 'reading' ? h('textarea', { rows: 2, class: 'note-area', placeholder: 'Notas (opcional)', 'aria-label': 'Notas', onInput: (e) => { d.notes = e.target.value; } }, d.notes) : null,
        error ? h('small', { class: 'error' }, error) : null,
        h('div', { class: 'sheet-actions' },
          editing ? h('button', { class: 'btn danger ghost', onClick: remove }, 'Borrar') : null,
          h('button', { class: 'btn primary grow', onClick: save }, editing ? 'Guardar' : `Añadir ${KIND[d.type].label.toLowerCase()}`),
        ),
      ].filter(Boolean));
    }
    paint();
    if (!editing) setTimeout(() => titleInput.focus(), 50);
    return root;
  }, { label: editing ? 'Editar' : 'Añadir' });
}

/** Registrar tiempo de estudio: minutos → (asignatura) → Guardar. */
export function openSessionSheet(ctx, { subjectId = null, examId = null } = {}) {
  const today = ctx.today();
  const st0 = ctx.store.get().study;
  const exams = upcomingExams(st0, today).slice(0, 6);
  const d = { minutes: null, subjectId: subjectId ?? exams.find((e) => e.id === examId)?.subjectId ?? null, examId, date: today };
  let error = '';
  openSheet((close) => {
    const root = h('div', { class: 'sheet-form' });
    const custom = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 900, placeholder: 'Otro', class: 'mini-num', 'aria-label': 'Minutos', onInput: (e) => { d.minutes = Number(e.target.value) || null; paint(false); } });
    function save() {
      try {
        ctx.saveStudy(addSession(ctx.store.get().study, d, today), `+${d.minutes} min de estudio`);
        close();
      } catch (e) { error = e.message; paint(); }
    }
    function paint(full = true) {
      if (!full) return;
      root.replaceChildren(...[
        head('Registrar estudio', close),
        h('div', { class: 'entry-block' },
          label('Minutos'),
          h('div', { class: 'chips' },
            [25, 45, 60, 90, 120].map((m) => h('button', { type: 'button', class: `chip ${d.minutes === m ? 'on' : ''}`, onClick: () => { d.minutes = m; custom.value = ''; error = ''; paint(); } }, m >= 60 ? `${m / 60} h`.replace('1.5', '1,5') : `${m} min`)),
            custom,
          ),
        ),
        subjectPicker(ctx, d.subjectId, (id) => { d.subjectId = id; if (id && d.examId && exams.find((e) => e.id === d.examId)?.subjectId !== id) d.examId = null; }, paint),
        exams.length ? h('div', { class: 'entry-block' },
          label('Para el examen (opcional)'),
          h('div', { class: 'chips' }, exams.map((e) => h('button', {
            type: 'button', class: `chip ${d.examId === e.id ? 'on' : ''}`,
            onClick: () => { d.examId = d.examId === e.id ? null : e.id; if (d.examId && e.subjectId) d.subjectId = e.subjectId; paint(); },
          }, `${e.title} · ${formatDate(e.date)}`))),
        ) : null,
        h('div', { class: 'chips' }, [[today, 'Hoy'], [addDays(today, -1), 'Ayer']].map(([k, text]) => h('button', { type: 'button', class: `chip ${d.date === k ? 'on' : ''}`, onClick: () => { d.date = k; paint(); } }, text))),
        error ? h('small', { class: 'error' }, error) : null,
        h('div', { class: 'sheet-actions' }, h('button', { class: 'btn primary grow', onClick: save }, 'Guardar')),
      ].filter(Boolean));
    }
    paint();
    return root;
  }, { label: 'Registrar estudio' });
}

/** Alta o edición de una asignatura. onSaved(id) al guardar. */
export function openSubjectSheet(ctx, subject = null, onSaved = null) {
  const st0 = ctx.store.get().study;
  const d = { name: subject?.name || '', emoji: subject?.emoji || SUBJECT_EMOJIS[st0.subjects.length % SUBJECT_EMOJIS.length], color: subject?.color || SUBJECT_COLORS[st0.subjects.length % SUBJECT_COLORS.length] };
  let error = '';
  openSheet((close) => {
    const root = h('div', { class: 'sheet-form' });
    const input = h('input', { type: 'text', value: d.name, maxlength: 60, placeholder: 'Cálculo, Historia…', 'aria-label': 'Nombre', enterkeyhint: 'done', onInput: (e) => { d.name = e.target.value; }, onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } } });
    function save() {
      try {
        const id = subject?.id || `sub-${Date.now().toString(36)}`;
        ctx.saveStudy(saveSubject(ctx.store.get().study, { ...d, id }), subject ? 'Asignatura guardada' : null);
        close();
        onSaved?.(id);
      } catch (e) { error = e.message; paint(); }
    }
    function paint() {
      const st = ctx.store.get().study;
      root.replaceChildren(...[
        head(subject ? 'Editar asignatura' : 'Nueva asignatura', close),
        input,
        h('div', { class: 'emoji-row' }, SUBJECT_EMOJIS.map((e) => h('button', { type: 'button', class: `emoji-pick ${d.emoji === e ? 'on' : ''}`, onClick: () => { d.emoji = e; paint(); } }, e))),
        h('div', { class: 'colors' }, SUBJECT_COLORS.map((c) => h('button', { type: 'button', class: `swatch ${d.color === c ? 'on' : ''}`, style: { background: c }, 'aria-label': `Color ${c}`, onClick: () => { d.color = c; paint(); } }))),
        error ? h('small', { class: 'error' }, error) : null,
        h('div', { class: 'sheet-actions' },
          subject ? h('button', {
            class: 'btn danger ghost',
            onClick: () => {
              const inUse = subjectInUse(st, subject.id);
              ctx.saveStudy(deleteSubject(st, subject.id), inUse ? `${subject.name} borrada; sus tareas siguen, sin asignatura` : `${subject.name} borrada`);
              close();
            },
          }, 'Borrar') : null,
          h('button', { class: 'btn primary grow', onClick: save }, 'Guardar'),
        ),
      ].filter(Boolean));
    }
    paint();
    if (!subject) setTimeout(() => input.focus(), 50);
    return root;
  }, { label: 'Asignatura' });
}

const STATUS_TEXT = { new: 'Nuevo', update: 'Ya importado: se actualiza', own: 'Exportado desde aquí', past: 'Ya pasó' };

/** Importar un .ics: vista previa con cada evento (tarea o examen, asignatura) antes de guardar. */
export function openImportSheet(ctx, text) {
  const today = ctx.today();
  let events;
  try {
    events = parseICS(text);
  } catch {
    events = [];
  }
  if (!events.length) {
    toast('El archivo no tiene eventos de calendario (.ics).', { tone: 'bad' });
    return;
  }
  const rows = importPreview(ctx.store.get().study, events, today);
  openSheet((close) => {
    const root = h('div', { class: 'sheet-form' });
    function paint() {
      const st = ctx.store.get().study;
      const n = rows.filter((r) => r.selected && r.status !== 'own').length;
      root.replaceChildren(...[
        head('Importar calendario', close),
        h('p', { class: 'muted small' }, `${events.length} eventos. Elige cuáles importar y si son tareas o exámenes. Los que ya importaste se actualizan, no se duplican.`),
        h('ul', { class: 'plain import-list' }, rows.map((r) => h('li', { class: `import-row ${r.selected ? '' : 'off'}` },
          h('label', { class: 'import-main' },
            h('input', { type: 'checkbox', checked: r.selected, disabled: r.status === 'own', onChange: (e) => { r.selected = e.target.checked; paint(); } }),
            h('span', { class: 'import-text' },
              h('b', {}, r.ev.title),
              h('small', { class: 'muted' }, `${formatDate(r.ev.date, { weekday: 'short', day: 'numeric', month: 'short', year: r.ev.date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' })}${r.ev.time ? ` · ${r.ev.time}` : ''} · ${STATUS_TEXT[r.status]}`),
            ),
          ),
          r.selected && r.status !== 'own' ? h('div', { class: 'import-opts' },
            h('div', { class: 'seg small' }, [['task', 'Tarea'], ['exam', 'Examen']].map(([k, t]) => h('button', { type: 'button', class: r.kind === k ? 'on' : '', onClick: () => { r.kind = k; paint(); } }, t))),
            st.subjects.length ? h('select', { 'aria-label': 'Asignatura', onChange: (e) => { r.subjectId = e.target.value || null; } },
              h('option', { value: '' }, 'Sin asignatura'),
              st.subjects.map((s) => h('option', { value: s.id, selected: s.id === r.subjectId }, s.name))) : null,
          ) : null,
        ))),
        h('div', { class: 'sheet-actions' },
          h('button', {
            class: 'btn primary grow', disabled: !n,
            onClick: () => {
              const res = applyImport(ctx.store.get().study, rows, today);
              ctx.saveStudy(res.study, [res.created ? `${res.created} añadidos` : null, res.updated ? `${res.updated} actualizados` : null].filter(Boolean).join(' · ') || 'Nada que importar');
              close();
            },
          }, n ? `Importar ${n}` : 'Nada seleccionado'),
        ),
      ]);
    }
    paint();
    return root;
  }, { label: 'Importar calendario' });
}
