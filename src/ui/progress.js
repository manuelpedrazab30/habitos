import { addDays, formatDate, WEEKDAYS, WEEKDAYS_SHORT } from '../domain/dates.js';
import { isDone } from '../domain/habits.js';
import { computeStreak, streakLabel } from '../domain/streaks.js';
import { levelInfo, totalXp } from '../domain/gamification.js';
import { completionRate, dayIntensity, improvementAreas, weekdayRates } from '../domain/stats.js';
import { globalMessages, pct } from '../domain/messages.js';
import { escapeHtml, h } from './dom.js';
import { barChart, heatmap } from './charts.js';

const RANGES = [['3m', 'Últimos 3 meses', 13], ['6m', '6 meses', 26], ['12m', '1 año', 52]];

/** Visión global: nivel, mapa de calor, días flojos y hábitos a mejorar. */
export function progressView(state, ctx) {
  const today = ctx.today();
  const habits = state.habits.filter((x) => !x.archived);
  if (!habits.length) return h('section', { class: 'view' }, h('h1', {}, 'Progreso'), h('p', { class: 'muted' }, 'Crea un hábito y registra unos días para ver tu progreso aquí.'));

  const lv = levelInfo(totalXp(state, today));
  const range = RANGES.find((r) => r[0] === ctx.ui.range) || RANGES[0];
  const from = addDays(today, -range[2] * 7 + 1);

  const rate30 = avg(habits.map((x) => completionRate(x, state.entries[x.id], addDays(today, -29), today, today)));
  const streaks = habits.map((x) => ({ habit: x, ...computeStreak(x, state.entries[x.id], today) }));
  const topStreak = streaks.reduce((a, b) => (b.current > (a?.current ?? -1) ? b : a), null);
  const totalLogs = habits.reduce((a, x) => a + Object.values(state.entries[x.id] || {}).filter((v) => isDone(x, v)).length, 0);

  const wr = weekdayRates(habits, state.entries, addDays(today, -55), today, today);
  const withData = wr.filter((r) => r.rate !== null);
  const worstIdx = withData.length >= 4 ? wr.indexOf(withData.reduce((a, b) => (b.rate < a.rate ? b : a))) : -1;

  const areas = improvementAreas(habits, state.entries, today);
  const insights = globalMessages(state, today).filter((m) => m.kind === 'insight' || m.kind === 'goal');

  return h('section', { class: 'view progress' },
    h('h1', {}, 'Progreso'),

    h('div', { class: 'card level-card' },
      h('div', { class: 'level-badge' }, h('small', {}, 'Nivel'), h('b', {}, lv.level)),
      h('div', { class: 'level-body' },
        h('div', { class: 'level-row' }, h('strong', {}, `${lv.xp} XP`), h('span', { class: 'muted' }, `${lv.toNext} XP para el nivel ${lv.level + 1}`)),
        h('div', { class: 'bar' }, h('span', { style: { width: `${(lv.into / lv.span) * 100}%` } })),
      ),
    ),

    h('div', { class: 'kpis' },
      kpi('Cumplimiento 30 días', rate30 === null ? '—' : pct(rate30)),
      kpi('Mejor racha activa', topStreak?.current ? `${topStreak.habit.emoji} ${streakLabel(topStreak.current, topStreak.unit)}` : '—'),
      kpi('Récord', bestOf(streaks)),
      kpi('Registros cumplidos', totalLogs),
    ),

    insights.length ? h('ul', { class: 'messages' }, insights.slice(0, 4).map((m) => h('li', { class: `msg ${m.kind}` }, m.text))) : null,

    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', {}, 'Constancia'),
        h('div', { class: 'seg small' }, RANGES.map(([id, label]) => h('button', { class: id === range[0] ? 'on' : '', onClick: () => { ctx.ui.range = id; ctx.rerender(); } }, label))),
      ),
      heatmap({
        from, to: today, today, color: 'var(--accent)',
        value: (k) => dayIntensity(habits, state.entries, k),
        label: (k, v) => {
          const done = habits.filter((x) => isDone(x, state.entries[x.id]?.[k])).map((x) => escapeHtml(`${x.emoji} ${x.name}`));
          return `<b>${formatDate(k, { weekday: 'long', day: 'numeric', month: 'short' })}</b><br>${v === null ? 'Nada programado' : `${pct(v)} cumplido`}${done.length ? `<br>${done.join('<br>')}` : ''}`;
        },
        onSelect: (k) => { ctx.ui.day = k; ctx.go('#/'); },
      }),
      h('p', { class: 'muted small' }, 'Toca un día para ver o corregir sus registros.'),
    ),

    withData.length ? h('div', { class: 'card' },
      h('h2', {}, 'Por día de la semana'),
      h('p', { class: 'muted small' }, 'Últimas 8 semanas, hábitos con días fijos.'),
      barChart({
        bars: wr.map((r, i) => ({
          label: WEEKDAYS_SHORT[i], value: r.rate === null ? 0 : Math.round(r.rate * 100), highlight: i === worstIdx,
          tip: r.rate === null ? `${WEEKDAYS[i]}: sin datos` : `<b>${WEEKDAYS[i]}</b><br>${r.done} de ${r.expected} cumplidos (${pct(r.rate)})`,
        })),
        max: 100, color: 'var(--accent)', format: (v) => `${v}%`,
      }),
    ) : null,

    areas.length ? h('div', { class: 'card' },
      h('h2', {}, 'Dónde mejorar'),
      h('p', { class: 'muted small' }, 'Últimas 4 semanas, de menor a mayor cumplimiento.'),
      h('ul', { class: 'areas' }, areas.map((r) => h('li', {},
        h('button', { class: 'area', onClick: () => ctx.go(`#/habito/${r.habit.id}`) },
          h('span', { class: 'emoji' }, r.habit.emoji),
          h('span', { class: 'area-name' }, r.habit.name),
          h('span', { class: 'bar', style: { '--c': r.habit.color } }, h('span', { style: { width: pct(r.rate) } })),
          h('span', { class: 'area-pct' }, pct(r.rate)),
          r.delta !== null && Math.abs(r.delta) >= 0.05 ? h('span', { class: `delta ${r.delta > 0 ? 'up' : 'down'}` }, `${r.delta > 0 ? '▲' : '▼'} ${Math.round(Math.abs(r.delta) * 100)}`) : h('span', { class: 'delta' }),
        )))),
    ) : null,
  );
}

const kpi = (label, value) => h('div', { class: 'kpi card' }, h('small', { class: 'muted' }, label), h('b', {}, value));

function avg(xs) {
  const v = xs.filter((x) => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function bestOf(streaks) {
  const b = streaks.reduce((a, x) => (x.best > (a?.best ?? 0) ? x : a), null);
  return b ? `${b.habit.emoji} ${streakLabel(b.best, b.unit)}` : '—';
}
