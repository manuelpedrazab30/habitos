import { addDays, toKey } from './dates.js';
import { saveExam, saveTask, subjectOf } from './study.js';

// Calendario (.ics, RFC 5545) sin servidor: exportar los exámenes y entregas para añadirlos
// a Apple Calendar (u otro), e importar eventos de un .ics (el calendario de Moodle/Canvas,
// o uno exportado del Calendario del Mac).
// Cada evento exportado lleva un UID fijo (`<id>@panel-estudios`): al volver a exportar,
// el calendario reconoce el evento y lo actualiza en lugar de duplicarlo.

export const UID_DOMAIN = 'panel-estudios';
const EXAM_RE = /\b(examen|exámen|parcial|final|exam|prueba|test|quiz|control|evaluaci[oó]n)\b/i;

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const unesc = (s) => String(s ?? '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const ymd = (key) => key.replace(/-/g, '');
const hm = (time) => time.replace(':', '');

/** Plegado de líneas a 75 octetos (los calendarios lo exigen; respetando caracteres UTF-8). */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '';
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; size = 0; }
    cur += ch;
    size += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

function stamp(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`;
}

/** Hora local + minutos → 'HHMM' del final (sin pasar de medianoche: se recorta a 23:59). */
function endTime(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const t = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}${String(t % 60).padStart(2, '0')}`;
}

function event({ uid, date, time, minutes = 60, title, description, alarm, now }) {
  const lines = ['BEGIN:VEVENT', `UID:${uid}@${UID_DOMAIN}`, `DTSTAMP:${stamp(now)}`];
  if (time) {
    // Hora "flotante" (sin zona): el calendario la muestra a esa hora local, que es lo que se escribió
    lines.push(`DTSTART:${ymd(date)}T${hm(time)}00`, `DTEND:${ymd(date)}T${endTime(time, minutes)}00`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${ymd(date)}`, `DTEND;VALUE=DATE:${ymd(addDays(date, 1))}`);
  }
  lines.push(`SUMMARY:${esc(title)}`);
  if (description) lines.push(`DESCRIPTION:${esc(description)}`);
  if (alarm) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, `TRIGGER:${alarm}`, 'END:VALARM');
  lines.push('END:VEVENT');
  return lines;
}

/**
 * Exámenes futuros, tareas pendientes con fecha y plazos de lectura → texto .ics.
 * opts.from: no exportar nada anterior (por defecto, hoy).
 */
export function studyToICS(st, today, { now = new Date(), from = today } = {}) {
  const sub = (o) => subjectOf(st, o.subjectId)?.name;
  const label = (prefix, o) => {
    const s = sub(o);
    return `${prefix}${o.title}${s && !o.title.toLowerCase().includes(s.toLowerCase()) ? ` · ${s}` : ''}`;
  };
  const events = [];
  for (const e of st.exams.filter((x) => x.date >= from)) {
    const topics = e.topics.length ? `Temas:\n${e.topics.map((t) => `- ${t.name}`).join('\n')}` : '';
    events.push(...event({ uid: e.id, date: e.date, time: e.time, minutes: e.duration, title: label(EXAM_RE.test(e.title) ? '' : 'Examen: ', e), description: [topics, e.notes].filter(Boolean).join('\n\n'), alarm: '-P1D', now }));
  }
  for (const t of st.tasks.filter((x) => x.due && !x.doneAt && x.due >= from)) {
    events.push(...event({ uid: t.id, date: t.due, time: t.time, minutes: 30, title: label('Entrega: ', t), description: t.notes, alarm: t.priority === 'alta' ? '-P1D' : null, now }));
  }
  for (const r of st.readings.filter((x) => x.deadline && x.deadline >= from)) {
    events.push(...event({ uid: r.id, date: r.deadline, time: null, title: label('Lectura: ', r), description: `${r.pages} páginas`, now }));
  }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Panel//Estudios//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Estudios', ...events, 'END:VCALENDAR'];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export const exportCount = (st, today) => st.exams.filter((x) => x.date >= today).length
  + st.tasks.filter((x) => x.due && !x.doneAt && x.due >= today).length
  + st.readings.filter((x) => x.deadline && x.deadline >= today).length;

/** Fecha/hora de un DTSTART: { date, time } en hora local. Admite VALUE=DATE, hora flotante, UTC (Z) y TZID. */
function parseDate(value, params) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, , z] = m;
  if (!hh || /VALUE=DATE(?!-)/i.test(params)) return { date: `${y}-${mo}-${d}`, time: null };
  if (z) {
    const local = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi));
    return { date: toKey(local), time: `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}` };
  }
  // Flotante o con TZID: se toma tal cual (casi siempre es la zona del usuario)
  return { date: `${y}-${mo}-${d}`, time: `${hh}:${mi}` };
}

/** Texto .ics → [{ uid, title, date, time, description, categories, ownId }] (solo VEVENT). */
export function parseICS(text) {
  const lines = String(text).replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out = [];
  let cur = null;
  let depth = 0; // VALARM y otros bloques dentro del evento
  for (const line of lines) {
    if (/^BEGIN:VEVENT$/i.test(line)) { cur = {}; depth = 0; continue; }
    if (!cur) continue;
    if (/^END:VEVENT$/i.test(line)) {
      if (cur.title && cur.date) out.push(cur);
      cur = null;
      continue;
    }
    if (/^BEGIN:/i.test(line)) { depth++; continue; }
    if (/^END:/i.test(line)) { depth--; continue; }
    if (depth > 0) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const head = line.slice(0, i);
    const value = line.slice(i + 1);
    const [name, ...params] = head.split(';');
    const key = name.toUpperCase();
    if (key === 'SUMMARY') cur.title = unesc(value).trim();
    else if (key === 'DESCRIPTION') cur.description = unesc(value).trim();
    else if (key === 'CATEGORIES') cur.categories = unesc(value).split(',').map((c) => c.trim()).filter(Boolean);
    else if (key === 'UID') {
      cur.uid = value.trim();
      const own = cur.uid.match(new RegExp(`^(.+)@${UID_DOMAIN}$`));
      cur.ownId = own ? own[1] : null;
    } else if (key === 'DTSTART') Object.assign(cur, parseDate(value.trim(), params.join(';')) || {});
    else if (key === 'STATUS' && /CANCELLED/i.test(value)) cur.cancelled = true;
  }
  return out.filter((e) => !e.cancelled);
}

/** ¿Examen o tarea? Por las palabras del título (la UI deja cambiarlo antes de importar). */
export const guessKind = (ev) => (EXAM_RE.test(ev.title) ? 'exam' : 'task');

/** Asignatura que aparece en el título o las categorías del evento (por nombre). */
export function guessSubject(st, ev) {
  const hay = `${ev.title} ${(ev.categories || []).join(' ')}`.toLowerCase();
  return st.subjects.find((s) => hay.includes(s.name.toLowerCase()))?.id || null;
}

/**
 * Eventos candidatos a importar, con lo que pasará con cada uno:
 * status 'new' (se crea), 'update' (ya importado antes: se actualizan fecha y título),
 * 'own' (lo exportó esta app: ya existe) o 'past' (anterior a hoy: desmarcado por defecto).
 */
export function importPreview(st, events, today) {
  const byUid = new Map([...st.tasks, ...st.exams].filter((x) => x.uid).map((x) => [x.uid, x]));
  return events.map((ev) => {
    const existing = byUid.get(ev.uid);
    const status = ev.ownId ? 'own' : existing ? 'update' : ev.date < today ? 'past' : 'new';
    return {
      ev, status, existing,
      kind: existing ? (st.exams.includes(existing) ? 'exam' : 'task') : guessKind(ev),
      subjectId: existing?.subjectId ?? guessSubject(st, ev),
      selected: status === 'new' || status === 'update',
    };
  }).sort((a, b) => a.ev.date.localeCompare(b.ev.date));
}

/** Aplica los candidatos marcados. Devuelve { study, created, updated }. */
export function applyImport(st, rows, today) {
  let next = st;
  let created = 0;
  let updated = 0;
  for (const r of rows.filter((x) => x.selected && x.status !== 'own')) {
    const base = { title: r.ev.title.slice(0, 160), subjectId: r.subjectId, uid: r.ev.uid || null };
    const keep = r.existing && (r.existing.uid === r.ev.uid) ? r.existing : null;
    const sameKind = keep && (r.kind === 'exam') === st.exams.includes(keep);
    if (r.kind === 'exam') {
      next = saveExam(next, { ...(sameKind ? keep : {}), ...base, date: r.ev.date, time: r.ev.time, notes: sameKind ? keep.notes : r.ev.description || '' }, today);
    } else {
      next = saveTask(next, { ...(sameKind ? keep : {}), ...base, due: r.ev.date, time: r.ev.time, notes: sameKind ? keep.notes : r.ev.description || '' }, today);
    }
    if (keep && !sameKind) { // cambió de tipo: quitar el anterior
      next = { ...next, tasks: next.tasks.filter((t) => t.id !== keep.id), exams: next.exams.filter((e) => e.id !== keep.id) };
    }
    if (keep) updated++;
    else created++;
  }
  return { study: next, created, updated };
}
