import { formatDate, relativeDay } from '../domain/dates.js';
import { isDone } from '../domain/habits.js';
import { fmt } from '../domain/messages.js';
import { exerciseHistory, exerciseStats, prefillSession, setLabel, WEIGHT_STEP } from '../domain/workouts.js';
import { h } from './dom.js';
import { openSheet } from './sheet.js';

/**
 * Registrar (o editar) la sesión de un día para un hábito con rutina.
 * Precargada con la última vez de cada ejercicio: si repites lo mismo, es un toque en "Guardar".
 */
export function openWorkoutSheet(habit, key, ctx) {
  const state = ctx.store.get();
  const sessions = state.workouts[habit.id] || {};
  const before = Object.fromEntries(Object.entries(sessions).filter(([k]) => k < key)); // solo lo anterior a ese día
  const alreadyDone = isDone(habit, state.entries[habit.id]?.[key]);
  const rows = prefillSession(habit.routine, sessions, key);
  const today = ctx.today();

  openSheet((close) => {
    const body = h('div', { class: 'ex-list', style: { '--c': habit.color } });

    function exCard(row, i) {
      const ex = habit.routine[i];
      const st = exerciseStats(ex, before, key);
      const last = exerciseHistory(before, ex.id).pop();
      const card = h('div', { class: `ex-card ${row.done ? '' : 'skipped'}` });

      const weightInput = h('input', {
        type: 'number', inputmode: 'decimal', step: 'any', min: 0, value: row.weight ?? '', placeholder: 'corporal', 'aria-label': `Peso de ${ex.name} en kg`,
        onInput: (e) => { row.weight = e.target.value === '' ? null : Number(e.target.value); },
      });
      const bump = (d) => {
        row.weight = Math.max(0, Math.round(((row.weight ?? 0) + d) * 100) / 100);
        weightInput.value = row.weight;
      };
      const numField = (label, key2) => h('label', {}, label, h('input', {
        type: 'number', inputmode: 'numeric', min: 1, value: row[key2] ?? '', 'aria-label': `${label} de ${ex.name}`,
        onInput: (e) => { row[key2] = e.target.value === '' ? null : Number(e.target.value); },
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
          st.count && st.best !== undefined ? ` · récord ${fmt(st.best)} kg` : '',
          ex.reps ? ` · objetivo ${ex.reps} reps` : '',
        ),
        h('div', { class: 'ex-fields' },
          numField('Series', 'sets'),
          numField('Reps', 'reps'),
          h('label', {}, 'Peso (kg)', h('div', { class: 'mini-stepper' },
            h('button', { type: 'button', 'aria-label': `Bajar ${WEIGHT_STEP} kg`, onClick: () => bump(-WEIGHT_STEP) }, '−'),
            weightInput,
            h('button', { type: 'button', 'aria-label': `Subir ${WEIGHT_STEP} kg`, onClick: () => bump(WEIGHT_STEP) }, '+'),
          )),
        ),
        st.suggestion !== null && st.suggestion !== undefined && row.weight !== st.suggestion
          ? h('button', { type: 'button', class: 'suggest', onClick: (e) => { row.weight = st.suggestion; weightInput.value = st.suggestion; e.currentTarget.remove(); } },
            `↑ Completaste ${st.last.reps} reps: sube a ${fmt(st.suggestion)} kg`)
          : null,
      ].filter(Boolean));
      return card;
    }

    body.append(...rows.map(exCard));

    return h('div', { style: { display: 'contents' } },
      h('div', { class: 'sheet-head' },
        h('span', { class: 'emoji' }, habit.emoji),
        h('h2', {}, `${habit.name} · ${relativeDay(key, today)}`),
        h('button', { class: 'icon-btn small', 'aria-label': 'Cerrar', onClick: close }, '✕'),
      ),
      h('p', { class: 'muted small' }, key === today ? 'Ajusta lo que cambió respecto a la última vez y guarda.' : `Editando el ${formatDate(key, { weekday: 'long', day: 'numeric', month: 'long' })}.`),
      body,
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn primary', onClick: () => {
          close();
          ctx.logWorkout(habit, key, rows.filter((r) => r.done));
        } }, 'Guardar sesión'),
        alreadyDone
          ? h('button', { class: 'btn danger', onClick: () => { close(); ctx.logEntry(habit, key, null); } }, 'Desmarcar día')
          : h('button', { class: 'btn ghost', onClick: () => { close(); ctx.logEntry(habit, key, 1); } }, 'Solo marcar hecho'),
      ),
    );
  }, { label: `Sesión de ${habit.name}` });
}
