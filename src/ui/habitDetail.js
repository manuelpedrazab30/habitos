import { addDays, diffDays, formatDate, maxKey, minKey } from '../domain/dates.js';
import { accumulated, isDone, isScheduled, scheduleLabel } from '../domain/habits.js';
import { computeStreak, habitStart, streakLabel } from '../domain/streaks.js';
import { habitXp } from '../domain/gamification.js';
import { completionRate, durationProgress, targetProjection, totalProjection, weeklyTotals } from '../domain/stats.js';
import { durationMessage, fmt, habitMessages, pct, targetMessage, totalMessage } from '../domain/messages.js';
import { h } from './dom.js';
import { barChart, heatmap, lineChart } from './charts.js';
import { allExercises, entryItems, exerciseStats, hasRoutine, setLabel } from '../domain/workouts.js';
import { openWorkoutSheet } from './workoutSheet.js';

const LINE_RANGES = [['1m', '1 mes', 30], ['3m', '3 meses', 91], ['all', 'Todo', null]];

export function habitDetailView(state, ctx, id) {
  const habit = state.habits.find((x) => x.id === id);
  if (!habit) return h('section', { class: 'view' }, h('p', {}, 'Ese hábito no existe.'), h('a', { href: '#/' }, 'Volver'));

  const today = ctx.today();
  const log = state.entries[habit.id] || {};
  const streak = computeStreak(habit, log, today);
  const rate30 = completionRate(habit, log, addDays(today, -29), today, today);
  const unitLabel = habit.kind === 'count' ? habit.unit : 'días hechos';

  const workouts = state.workouts?.[habit.id] || {};
  const extras = habitMessages(habit, log, today, workouts).filter((m) => m.kind !== 'goal');

  return h('section', { class: 'view detail', style: { '--c': habit.color } },
    h('header', { class: 'detail-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Volver', onClick: () => history.back() }, '‹'),
      h('span', { class: 'emoji big' }, habit.emoji),
      h('div', {}, h('h1', {}, habit.name), h('p', { class: 'muted' }, `${scheduleLabel(habit.schedule)}${habit.kind === 'count' ? ` · ${fmt(habit.dailyGoal)} ${habit.unit} por sesión` : ''}${habit.archived ? ' · archivado' : ''}`)),
      h('a', { class: 'btn ghost', href: `#/editar/${habit.id}` }, 'Editar'),
    ),

    h('div', { class: 'kpis' },
      kpi('Racha actual', streakLabel(streak.current, streak.unit)),
      kpi('Mejor racha', streakLabel(streak.best, streak.unit)),
      kpi('Cumplimiento 30 días', rate30 === null ? '—' : pct(rate30)),
      habit.kind === 'target' ? kpi('Mediciones', Object.keys(log).length) : kpi(`Total ${unitLabel}`, fmt(accumulated(habit, log))),
      kpi('XP ganada', habitXp(habit, log, today)),
    ),

    goalCard(habit, log, today),
    extras.length ? h('ul', { class: 'messages' }, extras.map((m) => h('li', { class: `msg ${m.kind}` }, m.text))) : null,
    hasRoutine(habit) ? liftsCard(habit, workouts, today, ctx) : null,
    habit.kind === 'target' ? targetChart(habit, log, today, ctx) : null,
    habit.kind === 'count' ? weeklyChart(habit, log, today) : null,
    habit.kind === 'check' && habit.schedule.type === 'weekly' ? weeklyDaysChart(habit, log, today) : null,
    historyCard(habit, log, today, ctx),
  );
}

function goalCard(habit, log, today) {
  if (habit.kind === 'target' && habit.goal.value !== null && habit.goal.start !== null) {
    const p = targetProjection(habit, log, today);
    return h('div', { class: 'card goal-card' },
      h('div', { class: 'goal-row' },
        h('span', {}, `${fmt(p.start)} ${habit.unit}`),
        h('strong', {}, `${fmt(p.current)} ${habit.unit}`),
        h('span', {}, `${fmt(p.goal)} ${habit.unit}`),
      ),
      h('div', { class: 'bar big' }, h('span', { style: { width: pct(p.progress) } })),
      h('p', {}, targetMessage(habit, p, today)),
      habit.goal.deadline ? h('p', { class: 'muted small' }, `Plazo: ${formatDate(habit.goal.deadline, { day: 'numeric', month: 'long', year: 'numeric' })}${p.daysLeft !== null && p.daysLeft >= 0 ? ` · quedan ${p.daysLeft} días` : ''}`) : null,
    );
  }
  const d = durationProgress(habit, log, today);
  if (d) {
    const plural = (n) => `${n} ${d.unit}${n === 1 ? '' : 's'}`;
    return h('div', { class: 'card goal-card' },
      h('div', { class: 'goal-row' },
        h('span', {}, formatDate(d.from)),
        h('strong', {}, `${d.met} / ${plural(d.total)}`),
        h('span', {}, formatDate(d.end)),
      ),
      // Segmentos: cumplidas · falladas · restantes, con marca del 80 % necesario
      h('div', { class: 'duration-bar', title: `Cumplidas ${d.met} · falladas ${d.missed} · quedan ${d.remaining}` },
        h('span', { class: 'seg-met', style: { flex: d.met } }),
        h('span', { class: 'seg-missed', style: { flex: d.missed } }),
        h('span', { class: 'seg-left', style: { flex: d.remaining } }),
        h('i', { class: 'mark', style: { left: pct(d.required / d.total) } }),
      ),
      h('p', { class: 'muted small legend' },
        h('span', { class: 'dot met' }), `Cumplidas ${d.met}`, h('span', { class: 'dot missed' }), `Falladas ${d.missed}`, h('span', { class: 'dot left' }), `Quedan ${d.remaining}`,
        ` · Meta: ${d.required} de ${d.total}`),
      h('p', {}, durationMessage(habit, d)),
      !d.ended && d.daysLeft >= 0 ? h('p', { class: 'muted small' }, `Termina el ${formatDate(d.end, { day: 'numeric', month: 'long', year: 'numeric' })} · quedan ${d.daysLeft + 1} días`) : null,
    );
  }
  const p = totalProjection(habit, log, today);
  if (!p) return null;
  return h('div', { class: 'card goal-card' },
    h('div', { class: 'goal-row' }, h('span', {}, '0'), h('strong', {}, fmt(p.done)), h('span', {}, `${fmt(p.total)} ${habit.kind === 'count' ? habit.unit : ''}`)),
    h('div', { class: 'bar big' }, h('span', { style: { width: pct(p.progress) } })),
    h('p', {}, totalMessage(habit, p)),
    habit.goal.deadline ? h('p', { class: 'muted small' }, `Plazo: ${formatDate(habit.goal.deadline, { day: 'numeric', month: 'long', year: 'numeric' })}${p.daysLeft !== null && p.daysLeft >= 0 ? ` · quedan ${p.daysLeft} días` : ''}`) : null,
  );
}

function targetChart(habit, log, today, ctx) {
  const range = LINE_RANGES.find((r) => r[0] === ctx.ui.lineRange) || LINE_RANGES[1];
  const p = targetProjection(habit, log, today);
  const start = habitStart(habit, log);
  let from = range[2] ? addDays(today, -range[2] + 1) : start;
  if (!range[2]) from = minKey(from, addDays(today, -13));
  let to = today;

  // Proyección: desde la tendencia de hoy hasta la llegada estimada o el plazo
  let projection = null;
  if (p.trend && !p.reached) {
    const end = p.etaKey ? minKey(p.etaKey, addDays(today, 365)) : habit.goal.deadline;
    if (end && end > today) {
      projection = { fromKey: today, fromValue: p.trend.intercept, toKey: end, toValue: p.trend.intercept + p.trend.slope * diffDays(today, end) };
      to = maxKey(to, end);
    }
  }
  if (habit.goal.deadline && habit.goal.deadline > today) to = maxKey(to, minKey(habit.goal.deadline, addDays(today, 365)));

  const points = p.measurements.filter((m) => m.key >= from);
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'Evolución'),
      h('div', { class: 'seg small' }, LINE_RANGES.map(([id, label]) => h('button', { class: id === range[0] ? 'on' : '', onClick: () => { ctx.ui.lineRange = id; ctx.rerender(); } }, label))),
    ),
    points.length
      ? lineChart({ points, goal: habit.goal.value, projection, deadline: habit.goal.deadline, unit: habit.unit, color: habit.color, from, to })
      : h('p', { class: 'muted' }, 'Sin mediciones en este periodo.'),
    projection ? h('p', { class: 'muted small' }, 'La línea discontinua proyecta tu tendencia reciente.') : null,
  );
}

function weeklyChart(habit, log, today) {
  const weeks = weeklyTotals(habit, log, 12, today);
  const perWeekGoal = habit.dailyGoal * (habit.schedule.type === 'weekly' ? habit.schedule.times : habit.schedule.type === 'days' ? habit.schedule.days.length : 7);
  return h('div', { class: 'card' },
    h('h2', {}, habit.unit ? `${habit.unit.charAt(0).toUpperCase()}${habit.unit.slice(1)} por semana` : 'Total por semana'),
    h('p', { class: 'muted small' }, `Línea: lo esperado por semana (${fmt(perWeekGoal)} ${habit.unit}).`),
    barChart({
      bars: weeks.map((w) => ({ label: formatDate(w.week, { day: 'numeric', month: 'numeric' }), value: w.value, tip: `<b>Semana del ${formatDate(w.week)}</b><br>${fmt(w.value)} ${habit.unit} · ${pct(w.value / perWeekGoal)} de lo esperado` })),
      color: habit.color, goal: perWeekGoal,
    }),
  );
}

/**
 * Sobrecarga progresiva: tabla por ejercicio (peso actual, cambio en 4 semanas, récord,
 * estado) + gráfica del peso por sesión del ejercicio elegido + últimas sesiones.
 */
function liftsCard(habit, workouts, today, ctx) {
  const stats = allExercises(habit).map((ex) => exerciseStats(ex, workouts, today));
  const withData = stats.filter((st) => st.count);
  const register = h('button', { class: 'btn primary small', onClick: () => openWorkoutSheet(habit, today, ctx) }, '+ Sesión de hoy');
  if (!withData.length) {
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Progresión de cargas'), register),
      h('p', { class: 'muted' }, 'Registra tu primera sesión con pesos para ver tu progresión.'));
  }
  const sel = withData.find((st) => st.exercise.id === ctx.ui.exercise) || withData[0];
  const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '=');
  const status = (st) => {
    if (st.suggestion !== null) return h('span', { class: 'tag up' }, `↑ ${fmt(st.suggestion)} kg`);
    if (st.stalled) return h('span', { class: 'tag stall' }, `${st.atWeight} sesiones igual`);
    if (st.isPR) return h('span', { class: 'tag up' }, 'Récord');
    return h('span', { class: 'tag' }, `${st.atWeight} ${st.atWeight === 1 ? 'sesión' : 'sesiones'}`);
  };

  const from = minKey(sel.first.key, addDays(today, -13));
  const recentSessions = Object.keys(workouts).sort().reverse().slice(0, 6);

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Progresión de cargas'), register),
    h('table', { class: 'lift-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Ejercicio'), h('th', {}, 'Actual'), h('th', {}, '4 sem'), h('th', { class: 'hide-sm' }, 'Récord'), h('th', {}, 'Siguiente'))),
      h('tbody', {}, withData.map((st) => h('tr', {
        class: st === sel ? 'sel' : '', tabindex: 0, 'aria-label': `Ver gráfica de ${st.exercise.name}`,
        onClick: () => { ctx.ui.exercise = st.exercise.id; ctx.rerender(); },
        onKeydown: (e) => { if (e.key === 'Enter') { ctx.ui.exercise = st.exercise.id; ctx.rerender(); } },
      },
        h('td', {}, st.exercise.name),
        h('td', {}, h('b', {}, `${fmt(st.last.weight)} kg`)),
        h('td', { class: st.change4w > 0 ? 'delta up' : st.change4w < 0 ? 'delta down' : 'muted' }, st.change4w === null ? '—' : signed(st.change4w)),
        h('td', { class: 'hide-sm' }, `${fmt(st.best)}`),
        h('td', {}, status(st)),
      ))),
    ),
    h('h3', { class: 'lift-title' }, `${sel.exercise.name}: peso por sesión`),
    lineChart({ points: sel.history.map((x) => ({ key: x.key, value: x.weight })), unit: 'kg', color: habit.color, from, to: today }),
    h('p', { class: 'muted small' },
      sel.count > 1
        ? `De ${fmt(sel.first.weight)} a ${fmt(sel.last.weight)} kg desde el ${formatDate(sel.first.key)} (${signed(sel.change)} kg${sel.changePct !== null ? `, ${sel.changePct >= 0 ? '+' : '−'}${Math.round(Math.abs(sel.changePct) * 100)}%` : ''}). Toca otro ejercicio de la tabla para cambiar.`
        : 'Con más sesiones verás aquí la tendencia.'),
    h('h3', { class: 'lift-title' }, 'Últimas sesiones'),
    h('ul', { class: 'sessions' }, recentSessions.map((k) => h('li', {},
      h('span', { class: 'when' }, formatDate(k)),
      h('span', { class: 'what' },
        h('b', {}, habit.sessions.find((x) => x.id === workouts[k].sessionId)?.name || 'Sesión'), h('br'),
        entryItems(workouts[k]).map((i) => `${i.name || '?'} ${setLabel(i, fmt)}`).join(' · ') || 'Sin ejercicios anotados'),
      h('button', { class: 'btn ghost small', onClick: () => openWorkoutSheet(habit, k, ctx) }, 'Editar'),
    ))),
  );
}

/** Días hechos por semana frente a los N comprometidos (hábitos sí/no semanales). */
function weeklyDaysChart(habit, log, today) {
  const times = habit.schedule.times;
  const weeks = weeklyTotals(habit, log, 12, today);
  return h('div', { class: 'card' },
    h('h2', {}, 'Días por semana'),
    h('p', { class: 'muted small' }, `Cada registro es un día. Línea: tu compromiso de ${times} ${times === 1 ? 'día' : 'días'} por semana.`),
    barChart({
      bars: weeks.map((w) => ({
        label: formatDate(w.week, { day: 'numeric', month: 'numeric' }), value: w.value, highlight: w.value < times && w.week < addDays(today, -6),
        tip: `<b>Semana del ${formatDate(w.week)}</b><br>${w.value} de ${times} días${w.value >= times ? ' · cumplida' : ''}`,
      })),
      color: habit.color, goal: times, max: 7, format: (v) => String(v),
    }),
  );
}

function historyCard(habit, log, today, ctx) {
  // Hasta 26 semanas, sin mostrar meses vacíos antes del inicio (mínimo 12 semanas)
  const from = minKey(addDays(today, -83), maxKey(addDays(today, -26 * 7 + 1), habitStart(habit, log)));
  const editor = h('div', { class: 'day-editor' });

  function openEditor(key) {
    ctx.ui.editKey = `${habit.id}:${key}`; // sobrevive al re-render tras guardar
    const v = log[key];
    const label = formatDate(key, { weekday: 'long', day: 'numeric', month: 'long' });
    let control;
    if (hasRoutine(habit)) {
      control = h('button', { class: 'btn primary', onClick: () => openWorkoutSheet(habit, key, ctx) }, isDone(habit, v) ? 'Ver / editar sesión' : 'Registrar sesión');
    } else if (habit.kind === 'check') {
      const done = isDone(habit, v);
      control = h('button', { class: `btn ${done ? 'ghost' : 'primary'}`, onClick: () => ctx.logEntry(habit, key, done ? null : 1) }, done ? 'Desmarcar' : 'Marcar como hecho');
    } else {
      const input = h('input', { type: 'number', inputmode: 'decimal', step: 'any', value: v ?? '', placeholder: habit.unit });
      control = h('form', { class: 'inline', onSubmit: (e) => {
        e.preventDefault();
        const n = parseFloat(String(input.value).replace(',', '.'));
        ctx.logEntry(habit, key, Number.isNaN(n) ? null : n);
      } }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Guardar'), v !== undefined ? h('button', { class: 'btn ghost', type: 'button', onClick: () => ctx.logEntry(habit, key, null) }, 'Borrar') : null);
      setTimeout(() => input.focus(), 0);
    }
    editor.replaceChildren(h('strong', {}, label), control);
  }

  const [editHabit, editKey] = (ctx.ui.editKey || '').split(':');
  if (editHabit === habit.id && editKey) openEditor(editKey);

  return h('div', { class: 'card' },
    h('h2', {}, 'Historial'),
    heatmap({
      from, to: today, today, color: habit.color,
      value: (k) => {
        const v = log[k];
        if (habit.kind === 'count' && v) return Math.min(1, v / habit.dailyGoal);
        if (isDone(habit, v)) return 1;
        return isScheduled(habit, k) && k >= habitStart(habit, log) && k < today && habit.schedule.type !== 'weekly' ? 0 : null;
      },
      label: (k) => {
        const v = log[k];
        const val = v === undefined ? 'Sin registro' : habit.kind === 'check' ? 'Hecho' : `${fmt(v)} ${habit.unit}`;
        return `<b>${formatDate(k, { weekday: 'short', day: 'numeric', month: 'short' })}</b><br>${val}`;
      },
      onSelect: openEditor,
    }),
    h('p', { class: 'muted small' }, 'Toca un día para registrarlo o corregirlo.'),
    editor,
  );
}

const kpi = (label, value) => h('div', { class: 'kpi card' }, h('small', { class: 'muted' }, label), h('b', {}, value));
