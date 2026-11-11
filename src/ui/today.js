import { addDays, formatDate, relativeDay, weekStart, WEEKDAYS_SHORT } from '../domain/dates.js';
import { isDone, isScheduled, TEMPLATES } from '../domain/habits.js';
import { computeStreak, streakLabel } from '../domain/streaks.js';
import { fmt, globalMessages } from '../domain/messages.js';
import { weekStatus, measurements } from '../domain/stats.js';
import { h } from './dom.js';
import { ring } from './charts.js';
import { installHint } from './install.js';
import { openWorkoutSheet } from './workoutSheet.js';

// Vista "Hoy": registrar es un toque. Todo lo demás (estadísticas, edición) está a un nivel más.

export function todayView(state, ctx) {
  const today = ctx.today();
  const day = ctx.ui.day && ctx.ui.day <= today ? ctx.ui.day : today;
  const habits = state.habits.filter((x) => !x.archived);

  if (!habits.length) return emptyState(ctx);

  const due = habits.filter((x) => isScheduled(x, day));
  const other = habits.filter((x) => !isScheduled(x, day));
  const countable = due.filter((x) => x.schedule.type !== 'weekly' || isDone(x, state.entries[x.id]?.[day]) || !weekStatus(x, state.entries[x.id], day)?.met);
  const doneCount = countable.filter((x) => isDone(x, state.entries[x.id]?.[day])).length;
  const isToday = day === today;

  const messages = isToday ? globalMessages(state, today).slice(0, 3) : [];

  return h('section', { class: 'view today' },
    h('header', { class: 'day-nav' },
      h('button', { class: 'icon-btn', 'aria-label': 'Día anterior', onClick: () => { ctx.ui.day = addDays(day, -1); ctx.rerender(); } }, '‹'),
      h('div', { class: 'day-title' },
        h('h1', {}, capitalize(relativeDay(day, today))),
        h('p', { class: 'muted' }, formatDate(day, { weekday: 'long', day: 'numeric', month: 'long' })),
      ),
      h('button', { class: 'icon-btn', 'aria-label': 'Día siguiente', disabled: isToday, onClick: () => { ctx.ui.day = addDays(day, 1); ctx.rerender(); } }, '›'),
    ),

    h('div', { class: 'summary card' },
      ring(countable.length ? doneCount / countable.length : 0, { size: 64, label: `${doneCount}/${countable.length}` }),
      h('div', {},
        h('strong', {}, doneCount === countable.length && countable.length ? 'Todo hecho por ' + (isToday ? 'hoy' : 'ese día') : `${countable.length - doneCount} pendiente${countable.length - doneCount === 1 ? '' : 's'}`),
        h('p', { class: 'muted' }, isToday ? 'Toca un hábito para registrarlo.' : 'Estás editando un día pasado.'),
      ),
      !isToday ? h('button', { class: 'btn ghost', onClick: () => { ctx.ui.day = today; ctx.rerender(); } }, 'Volver a hoy') : null,
    ),

    isToday ? installHint(ctx) : null,

    messages.length ? h('ul', { class: 'messages' }, messages.map((m) => h('li', { class: `msg ${m.kind}` }, m.text))) : null,

    h('div', { class: 'habit-list' }, due.map((x) => habitCard(x, state, day, ctx))),

    other.length ? h('details', { class: 'other' },
      h('summary', {}, `No programados ${isToday ? 'hoy' : 'ese día'} (${other.length})`),
      h('div', { class: 'habit-list' }, other.map((x) => habitCard(x, state, day, ctx))),
    ) : null,
  );
}

function habitCard(habit, state, day, ctx) {
  const log = state.entries[habit.id] || {};
  const value = log[day];
  const done = isDone(habit, value);
  const streak = computeStreak(habit, log, ctx.today());

  const sub = [];
  if (streak.current > 0) sub.push(`🔥 ${streakLabel(streak.current, streak.unit)}`);
  if (habit.routine?.length) sub.push(`${habit.routine.length} ejercicios`);
  if (habit.kind === 'target') {
    const ms = measurements(log);
    const last = ms[ms.length - 1];
    if (last) sub.push(`Último: ${fmt(last.value)} ${habit.unit}`);
    if (habit.goal.value !== null) sub.push(`Objetivo: ${fmt(habit.goal.value)} ${habit.unit}`);
  }

  const card = h('article', {
    class: `habit-card kind-${habit.kind} ${done ? 'done' : ''}`,
    style: { '--c': habit.color },
    'data-habit': habit.id,
  });

  const info = h('button', { class: 'habit-info', onClick: () => ctx.go(`#/habito/${habit.id}`), 'aria-label': `Ver detalle de ${habit.name}` },
    h('span', { class: 'emoji' }, habit.emoji),
    h('span', { class: 'texts' },
      h('span', { class: 'name' }, habit.name),
      h('span', { class: 'sub' }, sub.join(' · ') || ' '),
    ),
  );

  let control;
  if (habit.kind === 'check') {
    control = h('button', {
      class: 'check-btn', 'aria-pressed': String(done), 'aria-label': done ? 'Marcar como no hecho' : 'Marcar como hecho',
      // Con rutina, marcar abre la hoja de sesión (precargada con la última vez)
      onClick: () => (habit.routine?.length ? openWorkoutSheet(habit, day, ctx) : ctx.logEntry(habit, day, done ? null : 1)),
    }, done ? '✓' : '');
  } else if (habit.kind === 'count') {
    const v = Number(value) || 0;
    card.style.setProperty('--p', Math.min(1, v / habit.dailyGoal));
    control = h('div', { class: 'counter' },
      h('button', { class: 'step', 'aria-label': 'Restar', disabled: !v, onClick: () => ctx.logEntry(habit, day, v - habit.step > 0 ? v - habit.step : null) }, '−'),
      h('button', {
        class: 'count-val', 'aria-label': 'Escribir cantidad',
        // Tocar el número lo convierte en un campo (teclado numérico en el móvil)
        onClick: (e) => {
          const btn = e.currentTarget;
          const input = h('input', { type: 'number', inputmode: 'decimal', step: 'any', min: 0, class: 'count-input', value: v || '', 'aria-label': `Cantidad de ${habit.name}` });
          let done = false;
          const commit = () => {
            if (done) return;
            done = true;
            const n = parseFloat(String(input.value).replace(',', '.'));
            const next = n > 0 ? n : null;
            if (next !== (v || null)) ctx.logEntry(habit, day, next);
            else input.replaceWith(btn);
          };
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') commit();
            if (ev.key === 'Escape') { done = true; input.replaceWith(btn); }
          });
          input.addEventListener('blur', commit);
          btn.replaceWith(input);
          input.focus();
          input.select();
        },
      }, h('b', {}, fmt(v)), h('small', {}, `/${fmt(habit.dailyGoal)} ${habit.unit}`)),
      h('button', { class: 'step plus', 'aria-label': 'Sumar', onClick: () => ctx.logEntry(habit, day, v + habit.step) }, '+'),
    );
  } else {
    const input = h('input', {
      type: 'number', inputmode: 'decimal', step: 'any', class: 'measure',
      placeholder: habit.unit || 'valor', value: value ?? '', 'aria-label': `Medición de ${habit.name}`,
    });
    const save = () => {
      const n = parseFloat(String(input.value).replace(',', '.'));
      const next = Number.isNaN(n) ? null : n;
      if (next !== (value ?? null)) ctx.logEntry(habit, day, next);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    input.addEventListener('change', save);
    control = h('div', { class: 'measure-wrap' }, input, h('span', { class: 'unit' }, habit.unit));
  }

  card.append(info, control);
  if (habit.schedule.type === 'weekly') {
    card.classList.add('has-strip');
    card.append(weekStrip(habit, log, day, ctx));
  }
  return card;
}

/**
 * Semana del día mostrado, L→D. Cada registro es UN día: en "3 veces por semana" se
 * marcan los días concretos en que lo hiciste. En hábitos sí/no cada día se puede tocar.
 */
function weekStrip(habit, log, day, ctx) {
  const today = ctx.today();
  const w = weekStart(day);
  const status = weekStatus(habit, log, day);
  return h('div', { class: 'week-strip', role: 'group', 'aria-label': 'Días de la semana' },
    WEEKDAYS_SHORT.map((d, i) => {
      const k = addDays(w, i);
      const done = isDone(habit, log[k]);
      const cls = `wd ${done ? 'on' : ''} ${k === day ? 'sel' : ''} ${k > today ? 'future' : ''}`;
      const title = `${formatDate(k, { weekday: 'long', day: 'numeric', month: 'short' })}${done ? ' · hecho' : ''}`;
      if (habit.kind !== 'check' || k > today) return h('span', { class: cls, title }, d);
      return h('button', { class: cls, title, 'aria-pressed': String(done), 'aria-label': title, onClick: () => (habit.routine?.length ? openWorkoutSheet(habit, k, ctx) : ctx.logEntry(habit, k, done ? null : 1)) }, d);
    }),
    h('span', { class: `wk-count ${status.met ? 'met' : ''}` }, `${status.done}/${status.times} días${status.met ? ' ✓' : ''}`),
  );
}

function emptyState(ctx) {
  return h('section', { class: 'view empty' },
    installHint(ctx),
    h('h1', {}, 'Empieza con un hábito'),
    h('p', { class: 'muted' }, 'Elige uno para empezar en un toque, o crea el tuyo. Podrás ajustar metas y plazos cuando quieras.'),
    h('div', { class: 'templates' }, TEMPLATES.map((t, i) => h('button', { class: 'template card', onClick: () => ctx.go(`#/nuevo?t=${i}`) },
      h('span', { class: 'emoji' }, t.emoji), h('span', {}, t.name)))),
    h('div', { class: 'actions center' },
      h('button', { class: 'btn primary', onClick: () => ctx.go('#/nuevo') }, 'Crear desde cero'),
      h('button', { class: 'btn ghost', onClick: () => ctx.loadDemo() }, 'Explorar con datos de ejemplo'),
    ),
  );
}

const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);
