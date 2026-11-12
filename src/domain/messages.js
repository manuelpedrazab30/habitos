import { addDays, diffDays, formatDate, WEEKDAYS } from './dates.js';
import { isDone, isScheduled } from './habits.js';
import { computeStreak, streakLabel } from './streaks.js';
import { levelInfo, totalXp, XP } from './gamification.js';
import { allExercises, exerciseStats, hasRoutine, setLabel, WEIGHT_STEP } from './workouts.js';
import { DURATION_SUCCESS, durationProgress, improvementAreas, targetProjection, totalProjection, weekdayRates, weekStatus } from './stats.js';

// Mensajes de motivación basados en datos: cada uno dice una distancia concreta
// (tiempo, cantidad, días de racha) en lugar de frases genéricas.
// Cada mensaje: { id, habitId?, kind: 'goal'|'streak'|'today'|'risk'|'level'|'insight', priority, text }

const nf = new Intl.NumberFormat('es', { maximumFractionDigits: 1 });
export const fmt = (n) => nf.format(n);
export const fmtSigned = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + nf.format(Math.abs(n));
export const pct = (r) => `${Math.round(r * 100)}%`;
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;
const days = (n) => plural(n, 'día', 'días');
const withUnit = (n, unit) => (unit ? `${fmt(n)} ${unit}` : fmt(n));

const STREAK_MILESTONES = [7, 14, 21, 30, 50, 75, 100, 150, 200, 365];

export function targetMessage(habit, p, today) {
  const u = habit.unit;
  if (p.reached) {
    return `Objetivo alcanzado: ${withUnit(p.goal, u)}. Puedes fijar el siguiente desde el hábito.`;
  }
  const head = `Te faltan ${withUnit(Math.abs(p.remaining), u)} para llegar a ${withUnit(p.goal, u)}.`;
  const pace = p.perDay !== null ? `${fmtSigned(p.perDay * 7)} ${u}/sem`.trim() : null;
  const need = p.requiredPerDay !== null ? `${fmtSigned(p.requiredPerDay * 7)} ${u}/sem`.trim() : null;
  const deadline = habit.goal.deadline;

  if (p.etaKey && deadline) {
    const gap = diffDays(p.etaKey, deadline);
    if (gap >= 0) return `${head} A tu ritmo (${pace}) llegas el ${formatDate(p.etaKey)}, ${days(gap)} antes del plazo.`;
    return `${head} A tu ritmo (${pace}) llegarías el ${formatDate(p.etaKey)}, ${days(-gap)} tarde: necesitas ${need}.`;
  }
  if (p.etaKey) return `${head} A tu ritmo actual (${pace}) llegas hacia el ${formatDate(p.etaKey)}.`;
  if (pace && p.perDay !== 0) {
    return `${head} La tendencia reciente va en sentido contrario (${pace})${need ? `; para llegar el ${formatDate(deadline)} necesitas ${need}` : ''}.`;
  }
  if (need) return `${head} Para llegar el ${formatDate(deadline)} necesitas ${need}.`;
  return `${head} ${p.measurements.length ? 'Con una medición más, otro día,' : 'Con dos mediciones en días distintos'} calculo cuándo llegarás.`;
}

export function totalMessage(habit, p) {
  const unit = habit.kind === 'count' ? habit.unit : p.total === 1 ? 'vez' : 'veces';
  if (p.reached) return `Meta cumplida: ${withUnit(p.total, unit)}.`;
  const head = `Llevas ${fmt(p.done)} de ${withUnit(p.total, unit)} (${pct(p.progress)}).`;
  const rate = (r) => (habit.kind === 'count' ? `${fmt(r)} ${habit.unit}/día` : `${fmt(r * 7)} por semana`);
  const deadline = habit.goal.deadline;
  if (p.etaKey && deadline) {
    const gap = diffDays(p.etaKey, deadline);
    if (gap >= 0) return `${head} A tu ritmo (${rate(p.perDay)}) terminas el ${formatDate(p.etaKey)}, ${days(gap)} antes del plazo.`;
    return `${head} A tu ritmo terminarías ${days(-gap)} tarde: necesitas ${rate(p.requiredPerDay)} y vas a ${rate(p.perDay)}.`;
  }
  if (p.etaKey) return `${head} A tu ritmo (${rate(p.perDay)}) terminas hacia el ${formatDate(p.etaKey)}.`;
  if (p.requiredPerDay) return `${head} Para el ${formatDate(deadline)} necesitas ${rate(p.requiredPerDay)}.`;
  return head;
}

export function durationMessage(habit, p) {
  const u = (n) => plural(n, p.unit, `${p.unit}s`);
  const unitPl = `${p.unit}s`;
  const goalPct = pct(DURATION_SUCCESS);
  const fem = p.unit === 'semana'; // concordancia: semanas cumplidas / días cumplidos
  const cumplidas = fem ? 'cumplidas' : 'cumplidos';
  const endTxt = formatDate(p.end);
  if (!p.started) return `Tu meta empieza el ${formatDate(p.from)}: ${u(p.total)} hasta el ${endTxt}.`;
  if (p.ended) {
    return p.reached
      ? `Meta completada: cumpliste ${p.met} de ${u(p.total)} (${pct(p.progress)}).`
      : `La meta terminó el ${endTxt} con ${p.met} de ${u(p.total)} ${cumplidas} (${pct(p.progress)}); el objetivo era el ${goalPct}.`;
  }
  const head = `Llevas ${p.met} de ${u(p.total)} ${cumplidas}`;
  if (p.reached) {
    return `Meta asegurada: ${head.charAt(0).toLowerCase()}${head.slice(1)} (${pct(p.progress)}).${p.remaining ? ` Quedan ${u(p.remaining)} hasta el ${endTxt} para cerrarla al ${pct((p.met + p.remaining) / p.total)}.` : ''}`;
  }
  if (p.failed) {
    return `${head} y quedan ${p.remaining}: ya no llegas al ${goalPct}, pero aún puedes terminar en ${p.met + p.remaining}/${p.total} (${pct((p.met + p.remaining) / p.total)}).`;
  }
  const margin = p.remaining - p.needed;
  const marginTxt = margin === 0 ? `necesitas ${fem ? 'todas las' : 'todos los'} ${unitPl} que quedan` : `puedes fallar ${margin === 1 ? `1 ${p.unit}` : `${margin} ${unitPl}`} más como mucho`;
  return `${head}; quedan ${u(p.remaining)} hasta el ${endTxt}. Para el ${goalPct} te faltan ${p.needed}: ${marginTxt}.`;
}

/**
 * Sobrecarga progresiva: qué ejercicios toca subir, cuáles están estancados y cuánto
 * has progresado. Todo en kg concretos.
 */
export function overloadMessages(habit, workouts = {}, today) {
  if (!hasRoutine(habit)) return [];
  const out = [];
  const name = `${habit.emoji} ${habit.name}`;
  const stats = allExercises(habit).map((ex) => exerciseStats(ex, workouts, today)).filter((st) => st.count);

  const ready = stats.filter((st) => st.suggestion !== null);
  if (ready.length) {
    const list = ready.map((st) => `${st.exercise.name} → ${fmt(st.suggestion)} kg`).join(', ');
    const lead = ready.length === 1
      ? `${ready[0].exercise.name}: completaste ${setLabel(ready[0].last, fmt)}. Prueba ${fmt(ready[0].suggestion)} kg en la próxima sesión.`
      : `toca subir peso en ${ready.length} ejercicios: ${list}.`;
    out.push({ kind: 'today', priority: 72, text: `${name}: ${lead}` });
  }

  stats.filter((st) => st.stalled && st.suggestion === null).slice(0, 2).forEach((st) => {
    out.push({
      kind: 'risk', priority: 60,
      text: `${name}: ${st.exercise.name} lleva ${st.atWeight} sesiones en ${fmt(st.last.weight)} kg sin subir. Prueba ${fmt(st.last.weight + WEIGHT_STEP)} kg aunque hagas menos reps, o añade una serie.`,
    });
  });

  const recentPR = stats.filter((st) => st.isPR && st.last.key >= addDays(today, -3));
  if (recentPR.length) {
    out.push({ kind: 'streak', priority: 45, text: `${name}: récord reciente en ${recentPR.map((st) => `${st.exercise.name} (${fmt(st.best)} kg)`).join(', ')}.` });
  }

  const gains = stats.filter((st) => st.change4w > 0).sort((a, b) => b.change4w / b.last.weight - a.change4w / a.last.weight);
  if (gains.length) {
    const g = gains[0];
    out.push({ kind: 'insight', priority: 34, text: `${name}: ${g.exercise.name} subió ${fmt(g.change4w)} kg en las últimas 4 semanas (ahora ${fmt(g.last.weight)} kg).` });
  }
  return out.map((m, i) => ({ id: `${habit.id}:overload:${i}`, habitId: habit.id, ...m }));
}

export function habitMessages(habit, log = {}, today, workouts = {}) {
  const out = [];
  const name = `${habit.emoji} ${habit.name}`;
  // topic: 'week' = estado de la semana en hábitos N/semana (Hoy no lo muestra: ya lo dice la tira de días)
  const push = (kind, priority, text, topic = null) => out.push({ id: `${habit.id}:${kind}:${out.length}`, habitId: habit.id, kind, priority, text, topic });

  // Meta con plazo
  if (habit.kind === 'target' && habit.goal.value !== null && habit.goal.start !== null) {
    const p = targetProjection(habit, log, today);
    push('goal', p.onTrack === false ? 80 : 60, `${name}: ${targetMessage(habit, p, today)}`);
    const last = p.measurements[p.measurements.length - 1];
    const expectedGap = habit.schedule.type === 'weekly' ? Math.ceil(7 / habit.schedule.times) : 1;
    if (last && !p.reached) {
      const since = diffDays(last.key, today);
      if (since > expectedGap + 1) push('risk', 70, `${name}: tu última medición fue hace ${days(since)}; sin datos nuevos la proyección se queda desfasada.`);
    }
  } else if (habit.kind === 'check' && habit.goal.deadline) {
    const p = durationProgress(habit, log, today);
    const tight = !p.reached && !p.failed && p.remaining - p.needed <= 1;
    push('goal', tight ? 80 : 55, `${name}: ${durationMessage(habit, p)}`);
  } else if (habit.kind === 'count' && habit.goal.total) {
    const p = totalProjection(habit, log, today);
    push('goal', p.onTrack === false ? 80 : 55, `${name}: ${totalMessage(habit, p)}`);
  }

  // Lo que falta hoy en hábitos de cantidad
  const todayVal = log[today];
  if (habit.kind === 'count' && isScheduled(habit, today) && todayVal > 0 && !isDone(habit, todayVal)) {
    push('today', 75, `${name}: te faltan ${withUnit(habit.dailyGoal - todayVal, habit.unit)} para la meta de hoy.`);
  }

  // Rachas
  const s = computeStreak(habit, log, today);
  if (habit.schedule.type === 'weekly') {
    const w = weekStatus(habit, log, today);
    if (!w.met) {
      const need = w.times - w.done;
      if (need > w.daysLeft) {
        if (s.current > 0) push('risk', 50, `${name}: ${w.done} de ${w.times} esta semana; ya no da tiempo, la racha de ${streakLabel(s.current, 'semana')} vuelve a empezar el lunes.`, 'week');
      } else if (need === w.daysLeft) {
        push('risk', 85, `${name}: ${w.done} de ${w.times} esta semana y quedan ${days(w.daysLeft)}: necesitas todos para cumplir.`, 'week');
      } else if (w.daysLeft <= 3 || s.current > 0) {
        push('streak', 45, `${name}: ${w.done} de ${w.times} esta semana, quedan ${days(w.daysLeft)}${s.current ? ` para mantener ${streakLabel(s.current, 'semana')} seguidas` : ''}.`, 'week');
      }
    }
  } else if (s.pending) {
    const next = s.current + 1;
    const milestone = STREAK_MILESTONES.find((m) => m >= next);
    if (s.best > 1 && next === s.best) push('streak', 90, `${name}: si lo completas hoy igualas tu mejor racha (${streakLabel(s.best, 'día')}).`);
    else if (s.best > 1 && next === s.best + 1) push('streak', 95, `${name}: hoy puedes batir tu récord y llegar a ${streakLabel(next, 'día')} seguidos.`);
    else if (milestone && milestone - next <= 2 && s.current >= 3) push('streak', 65, `${name}: ${milestone === next ? 'hoy llegas' : `a ${days(milestone - next + 1)} de llegar`} a ${milestone} días seguidos.`);
    else if (s.current >= 3) push('streak', 40, `${name}: racha de ${streakLabel(s.current, 'día')} en juego hoy.`);
  }

  return out.concat(overloadMessages(habit, workouts, today));
}

export function globalMessages(state, today) {
  const habits = state.habits.filter((h) => !h.archived);
  const out = habits.flatMap((h) => habitMessages(h, state.entries[h.id], today, state.workouts?.[h.id]));

  // Nivel: traducir la XP que falta a acciones concretas
  const lv = levelInfo(totalXp(state, today));
  const actions = Math.ceil(lv.toNext / (XP.base + XP.streakStep * 2));
  out.push({ id: 'level', kind: 'level', priority: lv.toNext <= 30 ? 70 : 20, text: `Te faltan ${lv.toNext} XP para el nivel ${lv.level + 1}: unos ${plural(actions, 'registro cumplido', 'registros cumplidos')}.` });

  // Día de la semana más débil (con al menos ~3 semanas de datos)
  const wr = weekdayRates(habits, state.entries, addDays(today, -55), today, today);
  const withData = wr.map((r, i) => ({ ...r, i })).filter((r) => r.expected >= 3);
  if (withData.length >= 5) {
    const worst = withData.reduce((a, b) => (b.rate < a.rate ? b : a));
    const others = withData.filter((r) => r.i !== worst.i);
    const avg = others.reduce((a, r) => a + r.done, 0) / Math.max(1, others.reduce((a, r) => a + r.expected, 0));
    if (avg - worst.rate >= 0.2) {
      out.push({ id: 'weekday', kind: 'insight', priority: 35, text: `Los ${WEEKDAYS[worst.i]}${worst.i >= 5 ? 's' : ''} cumples el ${pct(worst.rate)} de lo programado; el resto de días, el ${pct(avg)}. Es tu punto más flojo de la semana.` });
    }
  }

  // Hábito que más ha caído
  const falling = improvementAreas(habits, state.entries, today).filter((r) => r.delta !== null && r.delta <= -0.2);
  if (falling.length) {
    const r = falling.reduce((a, b) => (b.delta < a.delta ? b : a));
    out.push({ id: `drop:${r.habit.id}`, habitId: r.habit.id, kind: 'insight', priority: 38, text: `${r.habit.emoji} ${r.habit.name} bajó del ${pct(r.prev)} al ${pct(r.rate)} de cumplimiento en las últimas 4 semanas.` });
  }

  return out.sort((a, b) => b.priority - a.priority);
}
