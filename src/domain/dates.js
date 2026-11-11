// Fechas como claves locales "YYYY-MM-DD". Nunca se usan timestamps UTC para días:
// así un registro hecho a las 23:30 no salta al día siguiente por la zona horaria.

const pad = (n) => String(n).padStart(2, '0');

export function toKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(now = new Date()) {
  return toKey(now);
}

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

/** Días desde `a` hasta `b` (b - a). Math.round absorbe los cambios de horario. */
export function diffDays(a, b) {
  return Math.round((fromKey(b) - fromKey(a)) / 86400000);
}

/** 0 = lunes … 6 = domingo. */
export function weekday(key) {
  return (fromKey(key).getDay() + 6) % 7;
}

export function weekStart(key) {
  return addDays(key, -weekday(key));
}

/** Claves de `from` a `to`, ambos incluidos. Las claves ISO se comparan como strings. */
export function dateRange(from, to) {
  const out = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

export const minKey = (a, b) => (a < b ? a : b);
export const maxKey = (a, b) => (a > b ? a : b);

export const WEEKDAYS_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

export function formatDate(key, opts = { day: 'numeric', month: 'short' }) {
  return fromKey(key).toLocaleDateString('es', opts);
}

export function relativeDay(key, today) {
  const d = diffDays(today, key);
  if (d === 0) return 'hoy';
  if (d === -1) return 'ayer';
  if (d === 1) return 'mañana';
  return formatDate(key, { weekday: 'short', day: 'numeric', month: 'short' });
}
