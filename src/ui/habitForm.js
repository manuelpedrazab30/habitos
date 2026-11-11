import { COLORS, createHabit, durationWeeks, KINDS, TEMPLATES, validateHabit } from '../domain/habits.js';
import { addDays, formatDate, WEEKDAYS_SHORT } from '../domain/dates.js';
import { DURATION_SUCCESS } from '../domain/stats.js';
import { defaultSessionName, isDefaultSessionName, sessionCount } from '../domain/workouts.js';
import { h, toast } from './dom.js';

const EMOJIS = ['✨', '🧘', '📚', '🏋️', '💧', '⚖️', '🏃', '🥗', '😴', '✍️', '🎸', '💻', '🚭', '🧠', '🚴', '💰'];

/** Crear (id = null) o editar un hábito. Con ?t=N precarga una plantilla. */
export function habitFormView(state, ctx, id, params) {
  const existing = id ? state.habits.find((x) => x.id === id) : null;
  if (id && !existing) return h('section', { class: 'view' }, h('p', {}, 'Ese hábito no existe.'));

  const tpl = params.get('t') !== null ? TEMPLATES[Number(params.get('t'))] : null;
  const draft = structuredClone(existing || createHabit({ color: COLORS[state.habits.length % COLORS.length], ...(tpl || {}) }));
  if (!draft.goal) draft.goal = {};

  const form = h('form', { class: 'view habit-form', novalidate: true });

  function field(label, input, { hint, error } = {}) {
    return h('label', { class: 'field' }, h('span', { class: 'label' }, label), input,
      hint ? h('small', { class: 'muted' }, hint) : null,
      error ? h('small', { class: 'error' }, error) : null);
  }

  function seg(options, current, onPick) {
    return h('div', { class: 'seg', role: 'radiogroup' }, options.map(([val, label]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(val === current), class: val === current ? 'on' : '',
      onClick: () => { onPick(val); paint(); },
    }, label)));
  }

  const numInput = (val, onInput, attrs = {}) => h('input', {
    type: 'number', inputmode: 'decimal', step: 'any', value: val ?? '', ...attrs,
    onInput: (e) => onInput(e.target.value === '' ? null : Number(e.target.value)),
  });

  let errors = {};

  // Rutina (sí/no) dividida en sesiones: una plantilla por entrenamiento de la semana.
  // Editar campos no repinta (conserva el foco); añadir/quitar sí.
  let activeSession = 0;
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

  /** Ajusta el nº de plantillas a las veces por semana sin tocar los ejercicios (las filas vacías se conservan mientras editas). */
  function fitSessions() {
    if (draft.kind !== 'check' || !draft.sessions?.length) return;
    const n = sessionCount(draft.schedule);
    while (draft.sessions.length < n) draft.sessions.push({ id: newId(), name: '', exercises: [] });
    draft.sessions.length = n;
    draft.sessions.forEach((x, i) => { if (isDefaultSessionName(x.name)) x.name = defaultSessionName(draft.schedule, i); });
    if (activeSession >= n) activeSession = 0;
  }

  function sessionsFieldset() {
    if (!draft.sessions?.length) {
      return h('fieldset', {}, h('legend', {}, 'Rutina de ejercicios (opcional)'),
        h('p', { class: 'muted' }, `Crea una plantilla por día de entrenamiento (${sessionCount(draft.schedule)} con tu calendario actual). Al marcar una sesión anotarás series, reps y peso, y se seguirá tu progresión de peso.`),
        h('button', { type: 'button', class: 'btn ghost', onClick: () => {
          draft.sessions = [{ id: newId(), name: '', exercises: [{ id: newId(), name: '', sets: 3, reps: 8, weight: null }] }];
          fitSessions();
          paint();
          form.querySelector('[name="ex-0-0-name"]')?.focus();
        } }, '+ Crear rutina por sesiones'),
      );
    }
    const idx = activeSession;
    const session = draft.sessions[idx];
    const rows = session.exercises;
    const cell = (i, key, attrs) => h('label', { class: `cell cell-${key}` },
      h('span', { class: 'cell-label' }, attrs['aria-label']),
      h('input', {
        name: `ex-${idx}-${i}-${key}`, value: rows[i][key] ?? '', ...attrs,
        onInput: (e) => { rows[i][key] = key === 'name' ? e.target.value : (e.target.value === '' ? null : Number(e.target.value)); },
      }));
    const others = draft.sessions.filter((x, i) => i !== idx && x.exercises.some((e) => e.name.trim()));

    return h('fieldset', {}, h('legend', {}, `Rutina: ${draft.sessions.length} ${draft.sessions.length === 1 ? 'sesión' : 'sesiones'}`),
      h('p', { class: 'muted small' }, draft.schedule.type === 'weekly'
        ? `Una plantilla por entrenamiento de la semana. Se alternan en orden (${draft.sessions.map((x) => x.name.split(' · ')[0]).join(' → ')} → …).`
        : 'Una plantilla por cada día de entrenamiento.'),
      h('div', { class: 'session-tabs', role: 'tablist' }, draft.sessions.map((x, i) => h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(i === idx), class: `session-tab ${i === idx ? 'on' : ''}`,
        onClick: () => { activeSession = i; paint(); },
      }, x.name || defaultSessionName(draft.schedule, i), h('small', {}, `${x.exercises.filter((e) => e.name.trim()).length}`)))),
      field('Nombre de la sesión', h('input', { name: `s-${idx}-name`, value: session.name, placeholder: defaultSessionName(draft.schedule, idx), onInput: (e) => { session.name = e.target.value; } }), { hint: 'Ej.: Día A · Empuje, Pierna, Torso…' }),
      rows.length ? h('div', { class: 'routine-head muted small' }, h('span', {}, 'Ejercicio'), h('span', {}, 'Series'), h('span', {}, 'Reps'), h('span', {}, 'Peso (kg)'), h('span', {})) : null,
      rows.map((ex, i) => h('div', { class: 'routine-row' },
        cell(i, 'name', { placeholder: 'Ej.: Sentadilla', 'aria-label': 'Ejercicio' }),
        cell(i, 'sets', { type: 'number', inputmode: 'numeric', min: 1, placeholder: '3', 'aria-label': 'Series' }),
        cell(i, 'reps', { type: 'number', inputmode: 'numeric', min: 1, placeholder: '8', 'aria-label': 'Reps' }),
        cell(i, 'weight', { type: 'number', inputmode: 'decimal', step: 'any', min: 0, placeholder: '—', 'aria-label': 'Peso (kg)' }),
        h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Quitar ${ex.name || 'ejercicio'}`, onClick: () => { rows.splice(i, 1); paint(); } }, '✕'),
      )),
      !rows.length && others.length ? h('div', { class: 'chips' }, h('span', { class: 'muted small' }, 'Copiar de:'), others.map((o) => h('button', {
        type: 'button', class: 'chip', onClick: () => { session.exercises = o.exercises.filter((e) => e.name.trim()).map((e) => ({ ...e, id: newId() })); paint(); },
      }, o.name))) : null,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn ghost', onClick: () => {
          rows.push({ id: newId(), name: '', sets: rows.at(-1)?.sets ?? 3, reps: rows.at(-1)?.reps ?? 8, weight: null });
          paint();
          form.querySelector(`[name="ex-${idx}-${rows.length - 1}-name"]`)?.focus();
        } }, '+ Añadir ejercicio'),
        h('button', { type: 'button', class: 'btn ghost small', onClick: () => { if (confirm('¿Quitar la rutina completa?')) { draft.sessions = []; paint(); } } }, 'Quitar rutina'),
      ),
      h('small', { class: 'muted' }, 'Reps = objetivo por serie: al completarlo con un peso te diré que subas 2,5 kg. Un ejercicio repetido en varias sesiones comparte su progresión. Si reduces las veces por semana se quitan las últimas sesiones.'),
    );
  }

  // Meta de duración (sí/no): "durante N semanas" ⇄ fecha de fin, sincronizados sin repintar
  function durationFieldset() {
    const g = draft.goal;
    const weekly = draft.schedule.type === 'weekly';
    const summary = h('p', { class: 'muted small' });
    const weeksInput = numInput(durationWeeks(g), (n) => { setWeeks(n); dateInput.value = g.deadline || ''; refresh(); }, { name: 'weeks', min: 1, step: 1, placeholder: 'Ej.: 12' });
    const dateInput = h('input', { type: 'date', name: 'deadline', value: g.deadline || '', onInput: (e) => {
      g.deadline = e.target.value || null;
      if (g.deadline && !g.from) g.from = ctx.today();
      weeksInput.value = durationWeeks(g) ?? '';
      refresh();
    } });
    function setWeeks(n) {
      if (!n || n < 1) { g.deadline = null; return; }
      if (!g.from) g.from = ctx.today();
      g.deadline = addDays(g.from, Math.round(n) * 7 - 1);
    }
    function refresh() {
      if (!g.deadline) { summary.textContent = 'Déjalo vacío si solo quieres mantener el hábito, sin fecha de fin.'; return; }
      const per = weekly ? `una semana cuenta si llegas a ${draft.schedule.times} ${draft.schedule.times === 1 ? 'día' : 'días distintos'}` : 'cada día programado cuenta por separado';
      summary.textContent = `Del ${formatDate(g.from)} al ${formatDate(g.deadline, { day: 'numeric', month: 'short', year: 'numeric' })}. La meta se logra cumpliendo el ${Math.round(DURATION_SUCCESS * 100)}% ${weekly ? 'de las semanas' : 'de los días'}; ${per}.`;
    }
    refresh();
    return h('fieldset', {}, h('legend', {}, 'Meta de duración (opcional)'),
      h('p', { class: 'muted' }, '¿Durante cuánto tiempo quieres mantenerlo?'),
      h('div', { class: 'chips' }, [4, 8, 12, 26].map((n) => h('button', {
        type: 'button', class: `chip ${durationWeeks(g) === n ? 'on' : ''}`,
        onClick: () => { setWeeks(n); paint(); },
      }, `${n} semanas`))),
      h('div', { class: 'row' },
        field('Durante (semanas)', weeksInput),
        field('Hasta', dateInput, { error: errors.deadline }),
      ),
      summary,
    );
  }

  function paint() {
    fitSessions();
    const focusedName = document.activeElement?.name;
    form.replaceChildren(...[ // replaceChildren no ignora null como h()
      h('header', { class: 'form-head' },
        h('h1', {}, existing ? 'Editar hábito' : 'Nuevo hábito'),
        !existing ? h('div', { class: 'chips' }, TEMPLATES.map((t) => h('button', {
          type: 'button', class: 'chip', onClick: () => {
            Object.assign(draft, structuredClone(createHabit({ ...t, color: draft.color })), { id: draft.id });
            paint();
          },
        }, `${t.emoji} ${t.name}`))) : null,
      ),

      h('div', { class: 'row' },
        field('Icono', h('input', { name: 'emoji', class: 'emoji-input', value: draft.emoji, maxlength: 4, list: 'emoji-list', onInput: (e) => { draft.emoji = e.target.value; } })),
        field('Nombre', h('input', { name: 'name', value: draft.name, placeholder: 'Ej.: Leer antes de dormir', required: true, onInput: (e) => { draft.name = e.target.value; } }), { error: errors.name }),
      ),
      h('div', { class: 'emoji-row' }, EMOJIS.map((e) => h('button', { type: 'button', class: `emoji-pick ${draft.emoji === e ? 'on' : ''}`, onClick: () => { draft.emoji = e; paint(); } }, e))),
      h('div', { class: 'colors' }, COLORS.map((c) => h('button', {
        type: 'button', class: `swatch ${draft.color === c ? 'on' : ''}`, style: { background: c }, 'aria-label': `Color ${c}`,
        onClick: () => { draft.color = c; paint(); },
      }))),

      h('fieldset', {}, h('legend', {}, 'Cómo se mide'),
        seg(Object.entries(KINDS).map(([k, v]) => [k, v.label]), draft.kind, (k) => { draft.kind = k; }),
        h('p', { class: 'muted' }, KINDS[draft.kind].hint),
        draft.kind !== 'check' ? h('div', { class: 'row' },
          field('Unidad', h('input', { name: 'unit', value: draft.unit, placeholder: draft.kind === 'target' ? 'kg, min…' : 'páginas, vasos…', onInput: (e) => { draft.unit = e.target.value; } })),
          draft.kind === 'count' ? field('Meta diaria', numInput(draft.dailyGoal, (v) => { draft.dailyGoal = v; }, { name: 'dailyGoal', min: 0 }), { error: errors.dailyGoal }) : null,
          draft.kind === 'count' ? field('Botón +', numInput(draft.step, (v) => { draft.step = v; }, { name: 'step', min: 0 }), { hint: 'Cuánto suma cada toque.' }) : null,
        ) : null,
      ),

      h('fieldset', {}, h('legend', {}, 'Cuándo'),
        seg([['daily', 'Cada día'], ['days', 'Días concretos'], ['weekly', 'Veces por semana']], draft.schedule.type, (t) => {
          draft.schedule = t === 'days' ? { type: 'days', days: [0, 1, 2, 3, 4] } : t === 'weekly' ? { type: 'weekly', times: 3 } : { type: 'daily' };
        }),
        draft.schedule.type === 'days' ? h('div', { class: 'day-chips' }, WEEKDAYS_SHORT.map((d, i) => {
          const on = draft.schedule.days.includes(i);
          return h('button', {
            type: 'button', class: `chip ${on ? 'on' : ''}`, 'aria-pressed': String(on),
            onClick: () => {
              const set = new Set(draft.schedule.days);
              on ? set.delete(i) : set.add(i);
              if (set.size) draft.schedule.days = [...set].sort();
              paint();
            },
          }, d);
        })) : null,
        draft.schedule.type === 'weekly' ? h('div', { class: 'stepper' },
          h('button', { type: 'button', class: 'step', onClick: () => { draft.schedule.times = Math.max(1, draft.schedule.times - 1); paint(); } }, '−'),
          h('span', {}, `${draft.schedule.times} ${draft.schedule.times === 1 ? 'vez' : 'veces'} por semana`),
          h('button', { type: 'button', class: 'step', onClick: () => { draft.schedule.times = Math.min(7, draft.schedule.times + 1); paint(); } }, '+'),
        ) : null,
      ),

      draft.kind === 'check' ? sessionsFieldset() : null,

      draft.kind === 'check' ? durationFieldset() : h('fieldset', {}, h('legend', {}, draft.kind === 'target' ? 'Objetivo' : 'Meta con plazo (opcional)'),
        draft.kind === 'target'
          ? h('div', { class: 'row' },
            field(`Valor actual${draft.unit ? ` (${draft.unit})` : ''}`, numInput(draft.goal.start, (v) => { draft.goal.start = v; }, { name: 'start' }), { error: errors.goalStart }),
            field(`Quiero llegar a${draft.unit ? ` (${draft.unit})` : ''}`, numInput(draft.goal.value, (v) => { draft.goal.value = v; }, { name: 'goalValue' }), { error: errors.goalValue }),
          )
          : field(`Total a acumular${draft.unit ? ` (${draft.unit})` : ''}`,
            numInput(draft.goal.total, (v) => { draft.goal.total = v; }, { name: 'total', min: 0, placeholder: 'Ej.: 1000' }),
            { hint: 'Déjalo vacío si solo quieres mantener el hábito.' }),
        field('Fecha límite', h('input', { type: 'date', name: 'deadline', value: draft.goal.deadline || '', onInput: (e) => { draft.goal.deadline = e.target.value || null; } }), { error: errors.deadline, hint: 'Con plazo, te diré si vas a tiempo y qué ritmo necesitas.' }),
      ),

      h('datalist', { id: 'emoji-list' }, EMOJIS.map((e) => h('option', { value: e }))),

      h('footer', { class: 'form-actions' },
        h('button', { type: 'submit', class: 'btn primary' }, existing ? 'Guardar cambios' : 'Crear hábito'),
        h('button', { type: 'button', class: 'btn ghost', onClick: () => history.back() }, 'Cancelar'),
      ),

      existing ? h('div', { class: 'danger-zone' },
        h('button', { type: 'button', class: 'btn ghost', onClick: () => {
          ctx.store.setArchived(existing.id, !existing.archived);
          toast(existing.archived ? 'Hábito restaurado' : 'Hábito archivado: sus datos se conservan');
          ctx.go('#/');
        } }, existing.archived ? 'Restaurar' : 'Archivar'),
        h('button', { type: 'button', class: 'btn danger', onClick: () => {
          if (!confirm(`¿Eliminar "${existing.name}" y todo su historial?`)) return;
          ctx.store.deleteHabit(existing.id);
          toast('Hábito eliminado', { action: 'Deshacer', onAction: () => ctx.store.undo(), timeout: 6000 });
          ctx.go('#/');
        } }, 'Eliminar'),
      ) : null,
    ].filter(Boolean));
    if (focusedName) form.querySelector(`[name="${focusedName}"]`)?.focus();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const habit = createHabit(draft);
    errors = validateHabit(habit);
    if (Object.keys(errors).length) { paint(); return; }
    if (existing) {
      ctx.store.updateHabit(existing.id, habit);
      toast('Cambios guardados');
      ctx.go(`#/habito/${existing.id}`);
    } else {
      const created = ctx.store.addHabit(habit);
      // El valor actual de un objetivo de medida es su primera medición
      if (created.kind === 'target' && created.goal.start !== null) ctx.store.setEntry(created.id, ctx.today(), created.goal.start);
      toast(`${created.emoji} ${created.name} creado`);
      ctx.go('#/');
    }
  });

  paint();
  return form;
}
