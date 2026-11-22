import { test, eq, ok } from './runner.js';
import {
  normalizeStudy, saveSubject, deleteSubject, saveTask, toggleTask, saveExam, setTopicStatus, cycleTopic, parseTopics,
  saveReading, logPages, pagesRead, addSession, advanceTopic, examPace, readingPace, dayPlan, studyStreak, onTimeRate, gradeSummary,
  studyMessages, examCoverage, weeklyMinutes, minutesBySubject, formatMinutes, agendaItems, setGrade, hasStudyData,
} from '../src/domain/study.js';
import { studyToICS, parseICS, importPreview, applyImport, guessKind } from '../src/domain/ics.js';
import { createStore, STORAGE_KEY } from '../src/store.js';

const T = '2026-11-11'; // miércoles

function base() {
  return normalizeStudy({
    subjects: [{ id: 'calc', name: 'Cálculo' }, { id: 'hist', name: 'Historia' }],
  }, T);
}
const exam = (topics, date = '2026-11-17', extra = {}) => ({ id: 'e1', title: 'Parcial', subjectId: 'calc', date, topics, ...extra });

test('study: normalizeStudy limpia asignaturas desconocidas y pone valores por defecto', () => {
  const st = normalizeStudy({ subjects: [{ id: 'a', name: 'A' }], tasks: [{ title: 'X', subjectId: 'zzz', due: 'mal' }, { title: '' }] }, T);
  eq(st.tasks.length, 1);
  eq([st.tasks[0].subjectId, st.tasks[0].due, st.tasks[0].priority, st.tasks[0].createdAt], [null, null, 'normal', T]);
  eq(st.dailyGoal, 60);
  ok(!hasStudyData(normalizeStudy(null, T)));
});

test('study: tareas: guardar, marcar hecha y desmarcar', () => {
  let st = saveTask(base(), { id: 't1', title: 'Informe', due: '2026-11-12', subjectId: 'hist' }, T);
  st = toggleTask(st, 't1', T);
  eq(st.tasks[0].doneAt, T);
  st = toggleTask(st, 't1', T);
  eq(st.tasks[0].doneAt, null);
  let threw = false;
  try { saveTask(st, { title: '  ' }, T); } catch { threw = true; }
  ok(threw, 'sin título falla');
});

test('study: borrar asignatura deja sus elementos sin asignatura', () => {
  let st = saveTask(base(), { id: 't1', title: 'Informe', subjectId: 'hist' }, T);
  st = deleteSubject(st, 'hist');
  eq([st.subjects.length, st.tasks[0].subjectId], [1, null]);
  st = saveSubject(st, { name: 'Física' });
  eq(st.subjects.length, 2);
});

test('study: parseTopics quita viñetas y numeración', () => {
  eq(parseTopics('1. Límites\n- Derivadas\n• Integrales; Series\n\n'), ['Límites', 'Derivadas', 'Integrales', 'Series']);
});

test('study: editar los temas de un examen conserva el estado de los que siguen', () => {
  let st = saveExam(base(), exam(['Límites', 'Derivadas']), T);
  const lim = st.exams[0].topics[0];
  st = setTopicStatus(st, 'e1', lim.id, 2, T);
  st = saveExam(st, { id: 'e1', topics: ['límites', 'Integrales'] }, T);
  eq(st.exams[0].topics.map((t) => [t.name, t.status]), [['Límites', 2], ['Integrales', 0]]);
});

test('study: cycleTopic recorre sin empezar → estudiado → repasado y fecha cada paso', () => {
  let st = saveExam(base(), exam(['A']), T);
  st = cycleTopic(st, 'e1', st.exams[0].topics[0], T);
  eq([st.exams[0].topics[0].status, st.exams[0].topics[0].studiedAt], [1, T]);
  st = cycleTopic(st, 'e1', st.exams[0].topics[0], '2026-11-12');
  eq([st.exams[0].topics[0].status, st.exams[0].topics[0].studiedAt, st.exams[0].topics[0].reviewedAt], [2, T, '2026-11-12']);
  st = cycleTopic(st, 'e1', st.exams[0].topics[0], T);
  eq([st.exams[0].topics[0].status, st.exams[0].topics[0].studiedAt], [0, null]);
});

test('study: advanceTopic avanza hasta repasado y ahí se queda', () => {
  let st = saveExam(base(), exam(['A']), T);
  st = advanceTopic(st, 'e1', st.exams[0].topics[0], T);
  st = advanceTopic(st, 'e1', st.exams[0].topics[0], T);
  eq(st.exams[0].topics[0].status, 2);
  const same = advanceTopic(st, 'e1', st.exams[0].topics[0], T);
  ok(same === st, 'un toque más no cambia nada');
});

test('study: el aviso de racha pendiente espera a la tarde', () => {
  let st = base();
  for (const k of ['2026-11-08', '2026-11-09', '2026-11-10']) st = addSession(st, { date: k, minutes: 30 }, T);
  ok(!studyMessages(st, T, { hour: 10 }).some((m) => m.kind === 'streak'), 'a las 10 no');
  ok(studyMessages(st, T, { hour: 19 }).some((m) => m.kind === 'streak'), 'a las 19 sí');
});

test('study: examPace reparte los temas dejando la víspera para repasar', () => {
  // Examen el martes 17: 6 días antes (mié–lun); 5 para estudiar, el lunes para repasar
  const st = saveExam(base(), exam(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']), T);
  const p = examPace(st.exams[0], T);
  eq([p.daysLeft, p.action, p.perDay, p.today, p.spare], [6, 'study', 2, 2, 1]);
});

test('study: examPace no aumenta el plan al marcar temas hoy', () => {
  let st = saveExam(base(), exam(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']), T);
  st = setTopicStatus(st, 'e1', st.exams[0].topics[0].id, 1, T);
  let p = examPace(st.exams[0], T);
  eq([p.perDay, p.today, p.doneToday], [2, 1, 1]);
  st = setTopicStatus(st, 'e1', st.exams[0].topics[1].id, 1, T);
  p = examPace(st.exams[0], T);
  eq([p.perDay, p.today], [2, 0], 'hecho por hoy');
});

test('study: examPace pasa a repasos cuando todo está estudiado', () => {
  let st = saveExam(base(), exam(['A', 'B', 'C', 'D']), T);
  for (const t of st.exams[0].topics) st = setTopicStatus(st, 'e1', t.id, 1, '2026-11-10');
  const p = examPace(st.exams[0], T);
  eq([p.action, p.perDay, p.today], ['review', 1, 1]);
  eq(examCoverage(st.exams[0]), 0.5);
});

test('study: lectura con plazo: páginas de hoy y ritmo reciente', () => {
  let st = saveReading(base(), { id: 'r1', title: 'Ensayo', pages: 100, deadline: '2026-11-15' }, T);
  st = logPages(st, 'r1', '2026-11-09', 30);
  let p = readingPace(st.readings[0], T);
  // 70 págs en 5 días (mié–dom) = 14/día
  eq([p.left, p.perDay, p.today, p.daysLeft], [70, 14, 14, 5]);
  st = logPages(st, 'r1', T, 10);
  p = readingPace(st.readings[0], T);
  eq([p.left, p.perDay, p.today], [60, 14, 4], 'leer hoy no cambia el objetivo del día');
  st = logPages(st, 'r1', T, 500);
  eq(pagesRead(st.readings[0]), 100, 'no pasa del total');
});

test('study: dayPlan ordena vencidas, hoy, mañana y próximas', () => {
  let st = base();
  st = saveTask(st, { id: 'a', title: 'Vieja', due: '2026-11-09' }, T);
  st = saveTask(st, { id: 'b', title: 'Hoy', due: T }, T);
  st = saveTask(st, { id: 'c', title: 'Mañana', due: '2026-11-12' }, T);
  st = saveTask(st, { id: 'd', title: 'Lunes', due: '2026-11-16' }, T);
  st = saveTask(st, { id: 'e', title: 'Lejos', due: '2026-12-20' }, T);
  st = saveExam(st, exam(['A', 'B']), T);
  st = saveExam(st, { id: 'e2', title: 'Final', date: '2027-02-01', topics: ['X'] }, T);
  const p = dayPlan(st, T);
  eq([p.overdue.map((t) => t.id), p.dueToday.map((t) => t.id), p.tomorrow.map((t) => t.id), p.soon.map((t) => t.id)], [['a'], ['b'], ['c'], ['d']]);
  eq(p.exams.map((x) => x.exam.id), ['e1'], 'solo exámenes en el horizonte de 21 días');
  eq(p.exams[0].topics.map((t) => t.name), ['A']);
});

test('study: racha de estudio: hoy pendiente no la rompe', () => {
  let st = base();
  st = addSession(st, { date: '2026-11-08', minutes: 30 }, T);
  st = addSession(st, { date: '2026-11-09', minutes: 30 }, T);
  st = saveTask(st, { id: 'x', title: 'X', doneAt: '2026-11-10' }, T);
  eq(studyStreak(st, T), { current: 3, best: 3, today: false });
  st = addSession(st, { date: T, minutes: 20 }, T);
  eq(studyStreak(st, T).current, 4);
});

test('study: entregas a tiempo y media de notas', () => {
  let st = base();
  st = saveTask(st, { title: 'A', due: '2026-11-05', doneAt: '2026-11-04' }, T);
  st = saveTask(st, { title: 'B', due: '2026-11-06', doneAt: '2026-11-08' }, T);
  st = saveTask(st, { title: 'C', due: '2026-11-07' }, T);
  st = saveTask(st, { title: 'D', due: '2026-11-20' }, T);
  eq(onTimeRate(st, T), { onTime: 1, total: 3, rate: 1 / 3 });
  st = saveExam(st, { id: 'p1', title: 'P1', subjectId: 'calc', date: '2026-10-10', grade: 7 }, T);
  st = saveExam(st, { id: 'p2', title: 'P2', subjectId: 'hist', date: '2026-10-11' }, T);
  st = setGrade(st, 'p2', '8,5'.replace(',', '.'));
  const g = gradeSummary(st);
  eq([g.average, g.count, g.bySubject.map((x) => x.subject.id)], [7.75, 2, ['calc', 'hist']]);
});

test('study: minutos por semana y por asignatura', () => {
  let st = base();
  st = addSession(st, { date: '2026-11-10', minutes: 45, subjectId: 'calc' }, T);
  st = addSession(st, { date: '2026-11-03', minutes: 30, subjectId: 'hist' }, T);
  st = addSession(st, { date: T, minutes: 15, subjectId: 'calc' }, T);
  eq(weeklyMinutes(st, T, 2).map((w) => [w.from, w.minutes]), [['2026-11-02', 30], ['2026-11-09', 60]]);
  eq(minutesBySubject(st, '2026-11-01', T).map((x) => [x.subject.id, x.minutes]), [['calc', 60], ['hist', 30]]);
  eq([formatMinutes(45), formatMinutes(60), formatMinutes(135)], ['45 min', '1 h', '2 h 15 min']);
});

test('study: mensajes con cifras concretas y versión corta', () => {
  let st = saveExam(base(), exam(['A', 'B', 'C', 'D']), T);
  st = saveTask(st, { title: 'Ensayo', due: '2026-11-09' }, T);
  st = saveReading(st, { id: 'r', title: 'Libro', pages: 50, deadline: '2026-11-15' }, T);
  const msgs = studyMessages(st, T);
  const ex = msgs.find((m) => m.kind === 'exam');
  ok(ex.text.includes('4 temas de 4') && ex.text.includes('en 6 días'), ex.text);
  ok(ex.short.length <= 60, ex.short);
  const late = msgs.find((m) => m.kind === 'task');
  ok(late.text.includes('hace 2 días'), late.text);
  ok(msgs.find((m) => m.kind === 'reading').text.includes('10/día'));
  ok(msgs.every((m) => m.short && m.short.length <= 64), 'todas con short');
  eq(msgs[0].kind, 'task', 'lo vencido primero');
});

test('study: agenda por fecha, sin tareas hechas ni exámenes pasados', () => {
  let st = saveTask(base(), { id: 't', title: 'T', due: '2026-11-20' }, T);
  st = saveTask(st, { id: 'h', title: 'Hecha', due: '2026-11-12', doneAt: T }, T);
  st = saveExam(st, exam([], '2026-11-13'), T);
  st = saveExam(st, { id: 'old', title: 'Viejo', date: '2026-11-01' }, T);
  eq(agendaItems(st, T).map((x) => x.item.id), ['e1', 't']);
  eq(agendaItems(st, T, { kind: 'task' }).map((x) => x.item.id), ['t']);
});

test('ics: exportar usa UID fijo, días completos y hora flotante, y pliega líneas', () => {
  let st = saveExam(base(), exam(['Límites', 'Derivadas'], '2026-11-17', { time: '09:30', duration: 90 }), T);
  st = saveTask(st, { id: 't1', title: 'Entregar, ya; ' + 'x'.repeat(80), due: '2026-11-12', subjectId: 'hist' }, T);
  st = saveTask(st, { id: 't2', title: 'Hecha', due: '2026-11-12', doneAt: T }, T);
  const ics = studyToICS(st, T, { now: new Date(Date.UTC(2026, 10, 11, 8, 0, 0)) });
  ok(ics.includes('UID:e1@panel-estudios'));
  ok(ics.includes('DTSTART:20261117T093000') && ics.includes('DTEND:20261117T110000'));
  ok(ics.includes('DTSTART;VALUE=DATE:20261112') && ics.includes('DTEND;VALUE=DATE:20261113'));
  ok(ics.includes('SUMMARY:Parcial · Cálculo'), 'sin «Examen:» si el título ya lo dice');
  ok(ics.includes('Entregar\\, ya\\;'));
  ok(!ics.includes('Hecha'), 'sin tareas hechas');
  ok(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75), 'líneas ≤ 75 octetos');
  // Ida y vuelta: lo que exportamos se reconoce como propio
  const back = parseICS(ics);
  eq(back.map((e) => [e.ownId, e.date, e.time]), [['e1', '2026-11-17', '09:30'], ['t1', '2026-11-12', null]]);
  ok(back[1].title.startsWith('Entrega: Entregar, ya; x'));
});

test('ics: importar eventos de Moodle (UTC, plegado, VALARM) y no duplicar al repetir', () => {
  const text = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:123@moodle.uni.es', 'SUMMARY:Entrega práctica 2 de Cálc', ' ulo', 'DTSTART:20261120T225900Z', 'CATEGORIES:Cálculo', 'BEGIN:VALARM', 'SUMMARY:no', 'END:VALARM', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:456@moodle.uni.es', 'SUMMARY:Examen parcial Historia', 'DTSTART;VALUE=DATE:20261201', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:789@moodle.uni.es', 'SUMMARY:Algo viejo', 'DTSTART;VALUE=DATE:20261001', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:000@x', 'SUMMARY:Cancelado', 'STATUS:CANCELLED', 'DTSTART;VALUE=DATE:20261201', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const evs = parseICS(text);
  eq(evs.length, 3);
  eq(evs[0].title, 'Entrega práctica 2 de Cálculo');
  ok(evs[0].time, 'hora local convertida desde UTC');
  eq([guessKind(evs[0]), guessKind(evs[1])], ['task', 'exam']);
  const st = base();
  const rows = importPreview(st, evs, T);
  eq(rows.map((r) => [r.status, r.kind, r.subjectId, r.selected]), [['past', 'task', null, false], ['new', 'task', 'calc', true], ['new', 'exam', 'hist', true]]);
  const { study, created } = applyImport(st, rows, T);
  eq([created, study.tasks.length, study.exams.length], [2, 1, 1]);
  // Segunda importación con la fecha cambiada: actualiza, no duplica
  const again = importPreview(study, parseICS(text.replace('20261201', '20261202')), T);
  eq(again.filter((r) => r.selected).map((r) => r.status), ['update', 'update']);
  const r2 = applyImport(study, again, T);
  eq([r2.created, r2.updated, r2.study.exams.length, r2.study.exams[0].date], [0, 2, 1, '2026-12-02']);
});

test('store: v6 añade estudios y setStudy se puede deshacer', () => {
  const data = {};
  const mem = { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
  mem.setItem(STORAGE_KEY, JSON.stringify({ version: 5, habits: [], entries: {} }));
  const s = createStore(mem);
  eq([s.get().version, s.get().study.tasks, s.get().study.dailyGoal], [6, [], 60]);
  s.setStudy(saveTask(s.get().study, { title: 'Leer' }, T));
  eq(createStore(mem).get().study.tasks[0].title, 'Leer', 'persistido');
  s.undo();
  eq(s.get().study.tasks, []);
});
