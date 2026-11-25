import { formatDate, relativeDay } from '../domain/dates.js';
import { isDone } from '../domain/habits.js';
import { fmt } from '../domain/messages.js';
import { exerciseStats, normUnit, parseNumber, prefillSession, rawHistory, repsText, sessionFor, setLabel, weightStep, weightText } from '../domain/workouts.js';
import { h } from './dom.js';
import { openSheet } from './sheet.js';

/**
 * Registrar (o editar) la sesión de un día para un hábito con rutina.
 * Abre la plantilla que toca ese día (sessionFor) y se puede cambiar con las pestañas.
 * Cada ejercicio se precarga con la última vez que lo hiciste: repetir es un toque en "Guardar".
 */
export function openWorkoutSheet(habit, key, ctx) {
  const state = ctx.store.get();
  const workouts = state.workouts[habit.id] || {};
  const before = Object.fromEntries(Object.entries(workouts).filter(([k]) => k < key)); // solo lo anterior a ese día
  const alreadyDone = isDone(habit, state.entries[habit.id]?.[key]);
  const today = ctx.today();
  const suggested = sessionFor(habit, workouts, key);
  let session = suggested;
  let rows = [];

  openSheet((close) => {
    const tabs = h('div', { class: 'session-tabs', role: 'tablist' });
    const hint = h('p', { class: 'muted small' });
    const body = h('div', { class: 'ex-list', style: { '--c': habit.color } });

    function exCard(row, ex) {
      const st = exerciseStats(ex, before, key);
      const last = rawHistory(before, ex).pop();
      const card = h('div', { class: `ex-card ${row.done ? '' : 'skipped'}` });

      row.unit = normUnit(row.unit);
      // Texto con teclado decimal (no type=number): acepta "62,5" y "62.5" en cualquier idioma
      const weightInput = h('input', {
        type: 'text', inputmode: 'decimal', autocomplete: 'off', value: weightText(row.weight), placeholder: 'corporal', 'aria-label': `Peso de ${ex.name} en ${row.unit}`,
        onInput: (e) => { const v = parseNumber(e.target.value); row.weight = v === null ? null : Math.max(0, v); },
      });
      const step = () => weightStep(row.unit);
      const bump = (dir) => {
        row.weight = Math.max(0, Math.round(((row.weight ?? 0) + dir * step()) * 100) / 100);
        weightInput.value = weightText(row.weight);
      };
      const unitBtn = h('button', {
        type: 'button', class: 'unit-toggle', 'aria-label': `Unidad de ${ex.name}: ${row.unit}. Cambiar`,
        onClick: (e) => {
          row.unit = row.unit === 'kg' ? 'lb' : 'kg';
          e.currentTarget.textContent = row.unit;
          e.currentTarget.setAttribute('aria-label', `Unidad de ${ex.name}: ${row.unit}. Cambiar`);
          weightInput.setAttribute('aria-label', `Peso de ${ex.name} en ${row.unit}`);
          card.querySelector('.suggest')?.remove(); // la sugerencia estaba en la otra unidad
        },
      }, row.unit);
      const numField = (label, prop) => h('label', {}, label, h('input', {
        type: 'number', inputmode: 'numeric', min: 1, value: row[prop] ?? '', 'aria-label': `${label} de ${ex.name}`,
        onInput: (e) => { row[prop] = e.target.value === '' ? null : Number(e.target.value); },
      }));

      card.append(...[ // append() no ignora null como h()
        h('div', { class: 'ex-top' },
          h('label', {},
            h('input', { type: 'checkbox', checked: row.done, onChange: (e) => { row.done = e.target.checked; card.classList.toggle('skipped', !row.done); } }),
            h('span', {}, ex.name),
          ),
        ),
        h('div', { class: 'ex-last' },
          last ? `Última (${relativeDay(last.key, today)}): ${setLabel(last, fmt)}` : 'Primera vez',
          st.count ? ` · récord ${fmt(st.best)} ${st.unit}` : '',
          ex.reps ? ` · objetivo ${repsText(ex)} reps` : '',
        ),
        h('div', { class: 'ex-fields' },
          numField('Series', 'sets'),
          numField('Reps', 'reps'),
          h('div', { class: 'ex-weight' },
            h('span', { class: 'ex-weight-head' }, 'Peso', unitBtn),
            h('div', { class: 'mini-stepper' },
              h('button', { type: 'button', 'aria-label': 'Bajar peso', onClick: () => bump(-1) }, '−'),
              weightInput,
              h('button', { type: 'button', 'aria-label': 'Subir peso', onClick: () => bump(1) }, '+'),
            )),
        ),
        st.suggestion !== null && st.suggestion !== undefined && row.weight !== st.suggestion && row.unit === st.unit
          ? h('button', { type: 'button', class: 'suggest', onClick: (e) => { row.weight = st.suggestion; weightInput.value = weightText(st.suggestion); e.currentTarget.remove(); } },
            `↑ Completaste ${st.last.reps} reps: sube a ${fmt(st.suggestion)} ${st.unit}`)
          : null,
      ].filter(Boolean));
      return card;
    }

    function show(s) {
      session = s;
      rows = prefillSession(s.exercises, workouts, key, s.id);
      tabs.replaceChildren(...habit.sessions.map((x) => h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(x === s), class: `session-tab ${x === s ? 'on' : ''}`,
        onClick: () => show(x),
      }, x.name, x === suggested ? h('small', {}, key === today ? 'hoy' : 'toca') : null)));
      hint.textContent = s === suggested
        ? (key === today ? 'Te toca esta sesión. Ajusta lo que cambió respecto a la última vez y guarda.' : `Editando el ${formatDate(key, { weekday: 'long', day: 'numeric', month: 'long' })}.`)
        : `Has cambiado de sesión; la que tocaba era ${suggested.name}.`;
      body.replaceChildren(...(s.exercises.length
        ? rows.map((r, i) => exCard(r, s.exercises[i]))
        : [h('p', { class: 'muted' }, 'Esta sesión aún no tiene ejercicios. ', h('a', { href: `#/editar/${habit.id}` }, 'Añádelos en la rutina'), '.')]));
    }
    show(session);

    return h('div', { style: { display: 'contents' } },
      h('div', { class: 'sheet-head' },
        h('span', { class: 'emoji' }, habit.emoji),
        h('h2', {}, `${habit.name} · ${relativeDay(key, today)}`),
        h('button', { class: 'icon-btn small', 'aria-label': 'Cerrar', onClick: close }, '✕'),
      ),
      habit.sessions.length > 1 ? tabs : null,
      hint,
      body,
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn primary', onClick: () => {
          close();
          ctx.logWorkout(habit, key, rows.filter((r) => r.done), session.id);
        } }, 'Guardar sesión'),
        alreadyDone
          ? h('button', { class: 'btn danger', onClick: () => { close(); ctx.logEntry(habit, key, null); } }, 'Desmarcar día')
          : h('button', { class: 'btn ghost', onClick: () => { close(); ctx.logEntry(habit, key, 1); } }, 'Solo marcar hecho'),
      ),
    );
  }, { label: `Sesión de ${habit.name}` });
}
