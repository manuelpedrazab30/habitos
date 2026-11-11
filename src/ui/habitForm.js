import { COLORS, createHabit, durationWeeks, KINDS, TEMPLATES, validateHabit } from '../domain/habits.js';
import { addDays, formatDate, WEEKDAYS_SHORT } from '../domain/dates.js';
import { DURATION_SUCCESS } from '../domain/stats.js';
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
