import { addDays, dateRange, diffDays, formatDate, weekStart } from './dates.js';

// Estudios: asignaturas, tareas, exámenes (con temas), lecturas y sesiones de estudio.
// Lógica pura, sin DOM. Igual que finanzas, cada cambio es una función que devuelve un
// `study` nuevo; la UI lo guarda con ctx.saveStudy(next, mensaje).
//
// study = {
//   subjects: [{ id, name, emoji, color }],
//   tasks:    [{ id, title, subjectId, due, time, minutes, priority: 'alta'|'normal', notes, doneAt, createdAt, uid }],
//   exams:    [{ id, title, subjectId, date, time, duration, topics: [{ id, name, status, studiedAt, reviewedAt }], grade, notes, createdAt, uid }],
//   readings: [{ id, title, subjectId, pages, deadline, log: { 'YYYY-MM-DD': páginas leídas ese día }, createdAt }],
//   sessions: [{ id, date, minutes, subjectId, examId, note }],
//   dailyGoal: minutos de estudio al día (objetivo del anillo de Hoy),
// }
// - due/date/deadline: claves 'YYYY-MM-DD'; time: 'HH:MM' o null (todo el día).
// - Tema: status 0 = sin empezar, 1 = estudiado, 2 = repasado.
// - uid: identificador del evento de calendario del que vino (importación .ics), para no duplicar.
// Todo lo derivado (plan del día, ritmos, rachas, mensajes) se calcula, nunca se guarda.

export const TOPIC_STATUS = ['Sin empezar', 'Estudiado', 'Repasado'];
export const SUBJECT_EMOJIS = ['📚', '📐', '🧪', '💻', '🌍', '🗣️', '🎨', '🏛️', '🧠', '📊', '⚖️', '🎵'];
export const SUBJECT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#8b5cf6', '#84cc16'];
export const DEFAULT_DAILY_GOAL = 60;
export const EXAM_HORIZON = 21; // días: los exámenes más lejanos no entran en el plan del día

const uid = (p) => (globalThis.crypto?.randomUUID ? `${p}-${crypto.randomUUID()}` : `${p}-${Date.now()}${Math.random().toString(36).slice(2)}`);
const isKey = (k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
const isTime = (t) => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t);
const posInt = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : null);
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

function normTopic(t) {
  const name = typeof t === 'string' ? t : t?.name;
  if (!str(name)) return null;
  const status = [0, 1, 2].includes(t?.status) ? t.status : 0;
  return {
    id: t?.id || uid('top'), name: str(name, 120), status,
    studiedAt: status >= 1 && isKey(t?.studiedAt) ? t.studiedAt : null,
    reviewedAt: status === 2 && isKey(t?.reviewedAt) ? t.reviewedAt : null,
  };
}

function normTask(t, today) {
  return {
    id: t.id || uid('task'), title: str(t.title, 160), subjectId: t.subjectId || null,
    due: isKey(t.due) ? t.due : null, time: isTime(t.time) ? t.time : null,
    minutes: posInt(t.minutes), priority: t.priority === 'alta' ? 'alta' : 'normal', notes: str(t.notes, 1000),
    doneAt: isKey(t.doneAt) ? t.doneAt : null, createdAt: isKey(t.createdAt) ? t.createdAt : today, uid: t.uid || null,
  };
}

function normExam(e, today) {
  const g = Number(e.grade);
  return {
    id: e.id || uid('exam'), title: str(e.title, 160), subjectId: e.subjectId || null,
    date: isKey(e.date) ? e.date : today, time: isTime(e.time) ? e.time : null, duration: posInt(e.duration) || 120,
    topics: (e.topics || []).map(normTopic).filter(Boolean),
    grade: e.grade !== null && e.grade !== '' && Number.isFinite(g) && g >= 0 && g <= 10 ? Math.round(g * 100) / 100 : null,
    notes: str(e.notes, 1000), createdAt: isKey(e.createdAt) ? e.createdAt : today, uid: e.uid || null,
  };
}

function normReading(r, today) {
  const log = {};
  for (const [k, v] of Object.entries(r.log || {})) if (isKey(k) && posInt(v)) log[k] = posInt(v);
  return {
    id: r.id || uid('read'), title: str(r.title, 160), subjectId: r.subjectId || null,
    pages: posInt(r.pages) || 1, deadline: isKey(r.deadline) ? r.deadline : null, log,
    createdAt: isKey(r.createdAt) ? r.createdAt : today,
  };
}

function normSession(s, today) {
  return { id: s.id || uid('ses'), date: isKey(s.date) ? s.date : today, minutes: posInt(s.minutes) || 1, subjectId: s.subjectId || null, examId: s.examId || null, note: str(s.note, 200) };
}

/** Normalizador único (store.migrate, importación, cada función de guardado). */
export function normalizeStudy(raw, today) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const subjects = (s.subjects || []).filter((x) => str(x?.name)).map((x, i) => ({
    id: x.id || uid('sub'), name: str(x.name, 60), emoji: x.emoji || SUBJECT_EMOJIS[0], color: x.color || SUBJECT_COLORS[i % SUBJECT_COLORS.length],
  }));
  const known = new Set(subjects.map((x) => x.id));
  const sub = (o) => ({ ...o, subjectId: known.has(o.subjectId) ? o.subjectId : null });
  const exams = (s.exams || []).filter((e) => str(e?.title)).map((e) => sub(normExam(e, today)));
  const examIds = new Set(exams.map((e) => e.id));
  return {
    subjects,
    tasks: (s.tasks || []).filter((t) => str(t?.title)).map((t) => sub(normTask(t, today))),
    exams,
    readings: (s.readings || []).filter((r) => str(r?.title)).map((r) => sub(normReading(r, today))),
    sessions: (s.sessions || []).filter(Boolean).map((x) => normSession(x, today)).map((x) => ({ ...sub(x), examId: examIds.has(x.examId) ? x.examId : null })),
    dailyGoal: posInt(s.dailyGoal) || DEFAULT_DAILY_GOAL,
  };
}

export const hasStudyData = (st) => Boolean(st && (st.tasks.length || st.exams.length || st.readings.length || st.sessions.length));
export const subjectOf = (st, id) => st.subjects.find((x) => x.id === id) || null;

// ── Cambios (puros: devuelven un study nuevo) ─────────────────────────────────────────

const upsert = (list, item) => (list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]);

export function saveSubject(st, input) {
  const subject = { id: input.id || uid('sub'), name: str(input.name, 60), emoji: input.emoji || SUBJECT_EMOJIS[0], color: input.color || SUBJECT_COLORS[st.subjects.length % SUBJECT_COLORS.length] };
  if (!subject.name) throw new Error('Pon un nombre a la asignatura.');
  return { ...st, subjects: upsert(st.subjects, subject) };
}
export const subjectInUse = (st, id) => [...st.tasks, ...st.exams, ...st.readings, ...st.sessions].some((x) => x.subjectId === id);
/** Borrar una asignatura deja sus tareas, exámenes y sesiones sin asignatura (no se pierden). */
export function deleteSubject(st, id) {
  const clear = (x) => (x.subjectId === id ? { ...x, subjectId: null } : x);
  return { ...st, subjects: st.subjects.filter((x) => x.id !== id), tasks: st.tasks.map(clear), exams: st.exams.map(clear), readings: st.readings.map(clear), sessions: st.sessions.map(clear) };
}

export function saveTask(st, input, today) {
  const prev = st.tasks.find((t) => t.id === input.id);
  if (!str({ ...prev, ...input }.title)) throw new Error('Escribe qué hay que hacer.');
  return { ...st, tasks: upsert(st.tasks, normTask({ ...prev, ...input }, today)) };
}
export function toggleTask(st, id, today) {
  return { ...st, tasks: st.tasks.map((t) => (t.id === id ? { ...t, doneAt: t.doneAt ? null : today } : t)) };
}
export const deleteTask = (st, id) => ({ ...st, tasks: st.tasks.filter((t) => t.id !== id) });

/** Temas desde texto: uno por línea (o separados por ";"). */
export const parseTopics = (text) => String(text || '').split(/\n|;/).map((x) => x.replace(/^\s*[-•*\d.)]+\s*/, '').trim()).filter(Boolean);

export function saveExam(st, input, today) {
  const prev = st.exams.find((e) => e.id === input.id);
  const merged = { ...prev, ...input };
  if (!str(merged.title)) throw new Error('Pon un nombre al examen.');
  if (!isKey(merged.date)) throw new Error('Elige la fecha del examen.');
  // Conservar el estado de los temas que ya existían (por nombre) al editar la lista
  const old = new Map((prev?.topics || []).map((t) => [t.name.toLowerCase(), t]));
  const topics = (input.topics ?? prev?.topics ?? []).map((t) => (typeof t === 'string' ? old.get(t.trim().toLowerCase()) || t : t));
  return { ...st, exams: upsert(st.exams, normExam({ ...prev, ...input, topics }, today)) };
}
export function deleteExam(st, id) {
  return { ...st, exams: st.exams.filter((e) => e.id !== id), sessions: st.sessions.map((s) => (s.examId === id ? { ...s, examId: null } : s)) };
}
export function setTopicStatus(st, examId, topicId, status, today) {
  return {
    ...st,
    exams: st.exams.map((e) => (e.id !== examId ? e : {
      ...e,
      topics: e.topics.map((t) => (t.id !== topicId ? t : {
        ...t, status,
        studiedAt: status >= 1 ? t.studiedAt || today : null,
        reviewedAt: status === 2 ? t.reviewedAt || today : null,
      })),
    })),
  };
}
/** Siguiente estado al tocar un tema: sin empezar → estudiado → repasado → sin empezar. */
export const cycleTopic = (st, examId, topic, today) => setTopicStatus(st, examId, topic.id, (topic.status + 1) % 3, today);
/**
 * Avanzar un tema (lo que hace un toque): sin empezar → estudiado → repasado, y ahí se queda.
 * Volver atrás es una acción aparte y explícita, para que un toque de más no borre progreso.
 */
export const advanceTopic = (st, examId, topic, today) => (topic.status >= 2 ? st : setTopicStatus(st, examId, topic.id, topic.status + 1, today));
export function setGrade(st, examId, grade) {
  return { ...st, exams: st.exams.map((e) => (e.id === examId ? normExam({ ...e, grade }, e.createdAt) : e)) };
}

export function saveReading(st, input, today) {
  const prev = st.readings.find((r) => r.id === input.id);
  if (!str({ ...prev, ...input }.title)) throw new Error('Pon el título de la lectura.');
  if (!posInt({ ...prev, ...input }.pages)) throw new Error('Indica cuántas páginas tiene.');
  return { ...st, readings: upsert(st.readings, normReading({ ...prev, ...input }, today)) };
}
/** Suma (o resta, con n negativo) páginas leídas un día. No pasa de las páginas totales. */
export function logPages(st, readingId, day, n) {
  return {
    ...st,
    readings: st.readings.map((r) => {
      if (r.id !== readingId) return r;
      const log = { ...r.log };
      const room = r.pages - pagesRead(r);
      const next = Math.max(0, (log[day] || 0) + Math.min(n, room));
      if (next) log[day] = next;
      else delete log[day];
      return { ...r, log };
    }),
  };
}
export const deleteReading = (st, id) => ({ ...st, readings: st.readings.filter((r) => r.id !== id) });

export function addSession(st, input, today) {
  if (!posInt(input.minutes)) throw new Error('¿Cuántos minutos has estudiado?');
  return { ...st, sessions: [...st.sessions, normSession(input, today)] };
}
export const deleteSession = (st, id) => ({ ...st, sessions: st.sessions.filter((s) => s.id !== id) });
export const saveDailyGoal = (st, minutes) => ({ ...st, dailyGoal: posInt(minutes) || DEFAULT_DAILY_GOAL });

// ── Derivados ─────────────────────────────────────────────────────────────────────────

export const pagesRead = (r) => Object.values(r.log).reduce((a, b) => a + b, 0);
export const readingDone = (r) => pagesRead(r) >= r.pages;
export const topicCounts = (e) => ({
  total: e.topics.length,
  unstudied: e.topics.filter((t) => t.status === 0).length,
  unreviewed: e.topics.filter((t) => t.status < 2).length,
  reviewed: e.topics.filter((t) => t.status === 2).length,
});
/** Cobertura 0..1: estudiar un tema vale la mitad; repasarlo, el tema entero. */
export const examCoverage = (e) => (e.topics.length ? e.topics.reduce((a, t) => a + t.status, 0) / (2 * e.topics.length) : 0);
export const upcomingExams = (st, today) => st.exams.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
export const pastExams = (st, today) => st.exams.filter((e) => e.date < today).sort((a, b) => b.date.localeCompare(a.date));
export const openTasks = (st) => st.tasks.filter((t) => !t.doneAt);

/**
 * Ritmo de un examen: cuántos temas tocan hoy. Primero se estudian todos dejando el último
 * día (la víspera) para repasar; con todo estudiado, se reparten los repasos.
 * Los temas marcados hoy cuentan como hechos hoy (para que el plan no "crezca" al marcar).
 */
export function examPace(e, today) {
  const daysLeft = diffDays(today, e.date); // días antes del examen (hoy incluido, el del examen no)
  const c = topicCounts(e);
  const doneToday = e.topics.filter((t) => t.studiedAt === today).length;
  const reviewedToday = e.topics.filter((t) => t.reviewedAt === today).length;
  if (!c.total) return { daysLeft, action: 'none', perDay: 0, today: 0, doneToday: 0, ...c };
  // Fase de estudio mientras quede algo sin estudiar (o se haya estudiado algo hoy)
  if (c.unstudied > 0 || doneToday > 0) {
    const atStart = c.unstudied + doneToday; // sin estudiar al empezar el día
    const perDay = Math.ceil(atStart / Math.max(1, daysLeft - 1)); // la víspera, para repasar
    return {
      daysLeft, action: 'study', perDay, today: Math.max(0, Math.min(c.unstudied, perDay - doneToday)), doneToday,
      spare: daysLeft - Math.ceil(atStart / perDay), ...c,
    };
  }
  const perDay = Math.ceil((c.unreviewed + reviewedToday) / Math.max(1, daysLeft));
  return { daysLeft, action: c.unreviewed ? 'review' : 'ready', perDay, today: Math.max(0, Math.min(c.unreviewed, perDay - reviewedToday)), doneToday: reviewedToday, ...c };
}

/** Ritmo de una lectura con plazo: páginas que tocan hoy y ritmo de los últimos 7 días. */
export function readingPace(r, today) {
  const read = pagesRead(r);
  const left = r.pages - read;
  const readToday = r.log[today] || 0;
  const last7 = dateRange(addDays(today, -6), today).reduce((a, k) => a + (r.log[k] || 0), 0);
  const recent = last7 / 7;
  if (!r.deadline) return { left, read, readToday, perDay: null, today: 0, recent, daysLeft: null };
  const daysLeft = diffDays(today, r.deadline) + 1; // el día del plazo cuenta
  const perDay = daysLeft > 0 ? Math.ceil((left + readToday) / daysLeft) : left;
  return { left, read, readToday, perDay, today: Math.max(0, Math.min(left, perDay - readToday)), recent, daysLeft };
}

/**
 * Plan del día: lo que hay que hacer hoy, en orden.
 * { overdue: Task[], dueToday: Task[], tomorrow: Task[], soon: Task[], exams: [{exam, pace, topics}], readings: [{reading, pace}], doneToday: Task[] }
 * - soon: tareas de los próximos 2–7 días (con prioridad alta o tiempo estimado, para ir adelantando).
 */
export function dayPlan(st, today) {
  const open = openTasks(st);
  const byDue = (a, b) => (a.due || '9').localeCompare(b.due || '9') || (a.time || '99').localeCompare(b.time || '99') || (a.priority === 'alta' ? -1 : 1);
  const tomorrow = addDays(today, 1);
  return {
    overdue: open.filter((t) => t.due && t.due < today).sort(byDue),
    dueToday: open.filter((t) => t.due === today).sort(byDue),
    tomorrow: open.filter((t) => t.due === tomorrow).sort(byDue),
    soon: open.filter((t) => t.due > tomorrow && diffDays(today, t.due) <= 7).sort(byDue),
    undated: open.filter((t) => !t.due),
    exams: upcomingExams(st, today).filter((e) => diffDays(today, e.date) <= EXAM_HORIZON).map((exam) => {
      const pace = examPace(exam, today);
      // Temas sugeridos hoy: los siguientes en orden; los ya marcados hoy se muestran también
      const want = pace.action === 'study' ? (t) => t.status === 0 : (t) => t.status < 2;
      const markedToday = exam.topics.filter((t) => (pace.action === 'study' ? t.studiedAt === today : t.reviewedAt === today));
      return { exam, pace, topics: [...markedToday, ...exam.topics.filter(want).slice(0, pace.today)] };
    }),
    readings: st.readings.filter((r) => !readingDone(r) || r.log[today]).map((reading) => ({ reading, pace: readingPace(reading, today) }))
      .sort((a, b) => (a.reading.deadline || '9').localeCompare(b.reading.deadline || '9')),
    doneToday: st.tasks.filter((t) => t.doneAt === today),
  };
}

/** Minutos estudiados por día: { 'YYYY-MM-DD': minutos }. */
export function minutesByDay(st) {
  const out = {};
  for (const s of st.sessions) out[s.date] = (out[s.date] || 0) + s.minutes;
  return out;
}
export const minutesOn = (st, day) => st.sessions.filter((s) => s.date === day).reduce((a, s) => a + s.minutes, 0);
export function minutesBetween(st, from, to, filter = () => true) {
  return st.sessions.filter((s) => s.date >= from && s.date <= to && filter(s)).reduce((a, s) => a + s.minutes, 0);
}

/** Días con actividad de estudio: sesiones, tareas hechas, páginas leídas o temas marcados. */
export function activeDays(st) {
  const days = new Set(st.sessions.map((s) => s.date));
  st.tasks.forEach((t) => t.doneAt && days.add(t.doneAt));
  st.readings.forEach((r) => Object.keys(r.log).forEach((k) => days.add(k)));
  st.exams.forEach((e) => e.topics.forEach((t) => { if (t.studiedAt) days.add(t.studiedAt); if (t.reviewedAt) days.add(t.reviewedAt); }));
  return days;
}

/** Racha de días seguidos con actividad. Hoy sin actividad aún no la rompe (está pendiente). */
export function studyStreak(st, today) {
  const days = activeDays(st);
  let k = days.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (days.has(k)) { current++; k = addDays(k, -1); }
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of [...days].sort()) {
    run = prev && diffDays(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best, today: days.has(today) };
}

/** Tareas entregadas a tiempo, sobre las que tenían fecha y ya están hechas o vencidas. */
export function onTimeRate(st, today) {
  const judged = st.tasks.filter((t) => t.due && (t.doneAt || t.due < today));
  const onTime = judged.filter((t) => t.doneAt && t.doneAt <= t.due).length;
  return { onTime, total: judged.length, rate: judged.length ? onTime / judged.length : null };
}

/** Media de notas (0–10), global y por asignatura. */
export function gradeSummary(st) {
  const graded = st.exams.filter((e) => e.grade !== null);
  const avg = (list) => (list.length ? list.reduce((a, e) => a + e.grade, 0) / list.length : null);
  return {
    average: avg(graded), count: graded.length,
    bySubject: st.subjects.map((s) => ({ subject: s, average: avg(graded.filter((e) => e.subjectId === s.id)), count: graded.filter((e) => e.subjectId === s.id).length })).filter((x) => x.count),
  };
}

/** Minutos por asignatura entre dos fechas, de más a menos. */
export function minutesBySubject(st, from, to) {
  const out = new Map();
  for (const s of st.sessions) if (s.date >= from && s.date <= to) out.set(s.subjectId, (out.get(s.subjectId) || 0) + s.minutes);
  return [...out].map(([id, minutes]) => ({ subject: subjectOf(st, id), minutes })).sort((a, b) => b.minutes - a.minutes);
}

/** Minutos por semana (lunes) de las últimas n semanas, la actual incluida. */
export function weeklyMinutes(st, today, n = 8) {
  const start = weekStart(today);
  return Array.from({ length: n }, (_, i) => {
    const from = addDays(start, -7 * (n - 1 - i));
    return { from, minutes: minutesBetween(st, from, addDays(from, 6)) };
  });
}

export function formatMinutes(min) {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const shortDate = (k) => formatDate(k, { weekday: 'short', day: 'numeric', month: 'short' });
const inDays = (d) => (d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} días`);

/**
 * Mensajes con cifras concretas, como en hábitos y finanzas: { kind, priority, text, short }.
 * Nada de frases genéricas: siempre una distancia, un ritmo o una fecha.
 */
export function studyMessages(st, today, { hour = null } = {}) {
  const out = [];
  const name = (o) => {
    const s = subjectOf(st, o.subjectId);
    return s && !o.title.toLowerCase().includes(s.name.toLowerCase()) ? `${o.title} (${s.name})` : o.title;
  };
  // "Parcial de Cálculo" ya dice que es un examen; "Cálculo" no
  const examName = (e) => (/\b(examen|parcial|final|control|prueba|test|quiz|evaluaci[oó]n)\b/i.test(e.title) ? name(e) : `Examen de ${name(e)}`);
  const plan = dayPlan(st, today);

  if (plan.overdue.length) {
    const t = plan.overdue[0];
    const late = diffDays(t.due, today);
    out.push({
      kind: 'task', priority: 92,
      text: plan.overdue.length === 1
        ? `«${name(t)}» venció hace ${plural(late, 'día', 'días')} (${shortDate(t.due)}). Entrégala o cambia la fecha.`
        : `${plan.overdue.length} tareas vencidas; la más antigua, «${name(t)}», hace ${plural(late, 'día', 'días')}.`,
      short: plan.overdue.length === 1 ? `Vencida hace ${plural(late, 'día', 'días')}: ${t.title}` : `${plan.overdue.length} tareas vencidas`,
    });
  }
  if (plan.dueToday.length) {
    const est = plan.dueToday.reduce((a, t) => a + (t.minutes || 0), 0);
    out.push({
      kind: 'task', priority: 90,
      text: `Hoy se ${plan.dueToday.length === 1 ? 'entrega' : 'entregan'} ${plan.dueToday.map((t) => `«${name(t)}»${t.time ? ` a las ${t.time}` : ''}`).join(', ')}${est ? `: unos ${formatMinutes(est)} de trabajo estimado` : ''}.`,
      short: plan.dueToday.length === 1 ? `Hoy se entrega: ${plan.dueToday[0].title}` : `${plan.dueToday.length} entregas hoy`,
    });
  }

  for (const { exam, pace } of plan.exams) {
    const d = pace.daysLeft;
    const when = `${inDays(d)} (${shortDate(exam.date)})`;
    let text;
    let short;
    // Terminó de estudiar hoy: ya se habla de repasos
    const action = pace.action === 'study' && !pace.unstudied ? (pace.unreviewed ? 'review' : 'ready') : pace.action;
    if (action === 'none') {
      if (d > 14) continue;
      text = `${examName(exam)} ${when}. Añade sus temas para que calcule cuántos tocan cada día.`;
      short = `${exam.title} ${inDays(d)}: añade los temas`;
    } else if (action === 'study') {
      const left = pace.unstudied;
      text = d <= 1
        ? `${examName(exam)} ${when} y quedan ${plural(left, 'tema', 'temas')} sin estudiar de ${pace.total}.`
        : `${examName(exam)} ${when}: te ${left === 1 ? 'queda' : 'quedan'} ${plural(left, 'tema', 'temas')} de ${pace.total} por estudiar. A ${plural(pace.perDay, 'tema', 'temas')} al día terminas con ${plural(Math.max(1, pace.spare), 'día', 'días')} para repasar.`;
      short = `${exam.title} ${inDays(d)}: ${left} de ${pace.total} temas sin estudiar`;
    } else if (action === 'review') {
      const perDay = Math.ceil(pace.unreviewed / Math.max(1, d));
      text = `${examName(exam)} ${when}: ya has estudiado los ${pace.total} temas; te ${pace.unreviewed === 1 ? 'falta' : 'faltan'} ${plural(pace.unreviewed, 'repaso', 'repasos')}, ${plural(perDay, 'tema', 'temas')} al día.`;
      short = `${exam.title} ${inDays(d)}: ${pace.unreviewed} temas por repasar`;
    } else {
      text = `${examName(exam)} ${when}: los ${pace.total} temas están estudiados y repasados.`;
      short = `${exam.title} ${inDays(d)}: todo repasado`;
    }
    out.push({ kind: 'exam', priority: Math.max(45, 89 - d * 2) - (action === 'ready' ? 30 : 0), text, short });
  }

  for (const { reading, pace } of plan.readings) {
    if (!reading.deadline || pace.left <= 0 || pace.daysLeft > 21) continue;
    if (pace.daysLeft <= 0) {
      out.push({ kind: 'reading', priority: 70, text: `El plazo de «${name(reading)}» pasó el ${shortDate(reading.deadline)} y quedan ${pace.left} págs.`, short: `${reading.title}: plazo pasado, ${pace.left} págs` });
      continue;
    }
    const recent = Math.round(pace.recent * 10) / 10;
    const behind = pace.recent < pace.perDay;
    out.push({
      kind: 'reading', priority: behind ? 62 : 35,
      text: `Te faltan ${pace.left} págs de «${name(reading)}»: ${pace.perDay}/día hasta el ${shortDate(reading.deadline)}${recent ? ` (los últimos 7 días, ${String(recent).replace('.', ',')}/día)` : ''}.`,
      short: `${reading.title}: ${pace.perDay} págs/día, quedan ${pace.left}`,
    });
  }

  // Esta semana frente a la anterior hasta el mismo día
  const ws = weekStart(today);
  const dayIdx = diffDays(ws, today);
  const thisWeek = minutesBetween(st, ws, today);
  const lastWeek = minutesBetween(st, addDays(ws, -7), addDays(ws, -7 + dayIdx));
  if (thisWeek || lastWeek) {
    const diff = thisWeek - lastWeek;
    out.push({
      kind: 'time', priority: 30,
      text: `Esta semana llevas ${formatMinutes(thisWeek)} de estudio${lastWeek || thisWeek ? `, ${diff === 0 ? 'lo mismo que' : `${formatMinutes(Math.abs(diff))} ${diff > 0 ? 'más' : 'menos'} que`} la semana pasada a estas alturas` : ''}.`,
      short: `${formatMinutes(thisWeek)} de estudio esta semana (${diff >= 0 ? '+' : '−'}${formatMinutes(Math.abs(diff))})`,
    });
  }
  const streak = studyStreak(st, today);
  // "Falta hoy para la racha" solo a partir de las 18 h: por la mañana el día acaba de empezar
  const lateEnough = hour === null || hour >= 18;
  if (streak.current >= 3 && (streak.today || lateEnough)) {
    out.push({
      kind: 'streak', priority: streak.today ? 20 : 50,
      text: streak.today ? `${streak.current} días seguidos estudiando${streak.current >= streak.best ? ' (tu récord)' : `; tu récord son ${streak.best}`}.` : `Llevas ${streak.current} días seguidos estudiando: hoy aún no has hecho nada para mantener la racha.`,
      short: streak.today ? `${streak.current} días seguidos estudiando` : `Racha de ${streak.current} días: falta hoy`,
    });
  }
  return out.sort((a, b) => b.priority - a.priority);
}

/** Todo lo que viene, por fecha: tareas abiertas, exámenes y plazos de lectura. */
export function agendaItems(st, today, { kind = 'all' } = {}) {
  const items = [];
  if (kind === 'all' || kind === 'task') openTasks(st).forEach((t) => items.push({ kind: 'task', date: t.due, time: t.time, item: t }));
  if (kind === 'all' || kind === 'exam') upcomingExams(st, today).forEach((e) => items.push({ kind: 'exam', date: e.date, time: e.time, item: e }));
  if (kind === 'all' || kind === 'reading') st.readings.filter((r) => !readingDone(r)).forEach((r) => items.push({ kind: 'reading', date: r.deadline, time: null, item: r }));
  return items.sort((a, b) => (a.date || '9').localeCompare(b.date || '9') || (a.time || '99').localeCompare(b.time || '99'));
}
