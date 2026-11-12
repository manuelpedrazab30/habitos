import { addDays, diffDays, formatDate, toKey, weekday } from './dates.js';
import { formatMoney, parseAmount } from './finance.js';

// Resumen del correo con reglas, en el dispositivo (sin IA ni servidor). Independiente del
// proveedor: Gmail (y en el futuro Outlook) se traducen a este formato de mensaje:
//
//   { id, threadId, provider, from: { name, email }, to: [email], subject, snippet,
//     date (ISO), unread, important, starred,
//     category: 'primary'|'promotions'|'social'|'updates'|'forums', bulkHeader, link }
//
// analyzeMessage() añade: needsReply, personal, bulk, automated, code, bill, deadline,
// score y reasons. digest() agrupa la bandeja y inboxMessages() redacta avisos con cifras
// concretas, como el resto de la app.

const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function parseAddress(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].split('@')[0], email: m[2].trim().toLowerCase() };
  const email = (s.match(/[^\s<>"]+@[^\s<>"]+/) || [s])[0].toLowerCase();
  return { name: email.split('@')[0], email };
}

const AUTOMATED = /(^|[._+-])(no-?reply|noreply|donotreply|do-not-reply|no_responder|noresponder|notifications?|notificaciones|alerts?|alertas|mailer-daemon|postmaster|bounce|news|newsletter|boletin|marketing|promo(ciones)?|info|hello|hola|team|equipo|support|soporte|billing|facturacion|facturas|recibos|accounts?|citas|reservas|envios|pedidos|clientes|atencion|ventas|polizas)([._+-]|@|$)/;
const QUESTION = /\?/;
// Peticiones reales, no cualquier "puedes" ("si no puedes asistir, avísanos" no pide respuesta)
const REQUEST = /(¿\s*(puedes|podrias|me)|me puedes|podrias|me confirmas|confirmame|avisame|dime |que te parece|necesito que|cuando puedas|me mandas|me envias|te importa|could you|can you|let me know|would you|are you able|do you have|any update|thoughts\?)/;
const BILL_WORDS = /(factura|invoice|recibo|receipt|pago|payment|cargo|importe|total|suscripcion|subscription|renovacion|renewal|pedido|order|compra|purchase|cobro|domiciliacion|amount due|a pagar)/;
const AMOUNT = /(?:€|eur|euros?|usd|us\$|\$|mxn|cop|£)\s?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)|(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?(?:€|eur\b|euros?\b|usd\b|mxn\b|cop\b)/i;
const CODE = /(codigo|code|verificacion|verification|otp|2fa|one-time|un solo uso|inicio de sesion|sign-in|login)/;
const DEADLINE_WORDS = /(vence|vencimiento|plazo|antes del|antes de|hasta el|fecha limite|deadline|due|entrega|entregar|ultimo dia|last day|recordatorio|reminder|reunion|meeting|cita|appointment)/;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS = [['lunes', 'monday'], ['martes', 'tuesday'], ['miercoles', 'wednesday'], ['jueves', 'thursday'], ['viernes', 'friday'], ['sabado', 'saturday'], ['domingo', 'sunday']];

/** Importe de una factura/recibo en el texto (céntimos) o null. */
export function findAmount(text) {
  const m = String(text || '').match(AMOUNT);
  if (!m) return null;
  return parseAmount(m[1] || m[2]);
}

/**
 * Fecha límite/cita mencionada en el texto, relativa al día del correo. Solo cuenta si va
 * acompañada de una palabra de plazo ("vence", "antes del", "deadline", "reunión"…).
 * Devuelve una clave YYYY-MM-DD o null.
 */
export function findDeadline(text, mailKey) {
  const t = strip(text);
  if (!DEADLINE_WORDS.test(t)) return null;
  if (/\b(hoy|today)\b/.test(t)) return mailKey;
  if (/\b(manana|tomorrow)\b/.test(t)) return addDays(mailKey, 1);
  let m = t.match(/\b(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/);
  if (m) return yearAware(mailKey, MONTHS.indexOf(m[2]), Number(m[1]));
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/); // dd/mm(/aaaa), formato español
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    if (m[3]) {
      const y = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
      return toKey(new Date(y, Number(m[2]) - 1, Number(m[1])));
    }
    return yearAware(mailKey, Number(m[2]) - 1, Number(m[1]));
  }
  for (let i = 0; i < 7; i++) {
    if (DAYS[i].some((d) => new RegExp(`\\b${d}\\b`).test(t))) {
      let k = mailKey;
      for (let j = 0; j < 7 && weekday(k) !== i; j++) k = addDays(k, 1);
      return k;
    }
  }
  return null;
}

function yearAware(mailKey, month, day) {
  const y = Number(mailKey.slice(0, 4));
  const k = toKey(new Date(y, month, day));
  return diffDays(mailKey, k) < -60 ? toKey(new Date(y + 1, month, day)) : k; // "3 de enero" visto en diciembre
}

/** Clasifica un mensaje y le da una puntuación de prioridad con sus motivos. */
export function analyzeMessage(msg, { me = '', today }) {
  const text = `${msg.subject} ${msg.snippet}`;
  const t = strip(text);
  const mailKey = toKey(new Date(msg.date));
  const fromMe = me && msg.from.email === me.toLowerCase();
  const automated = AUTOMATED.test(msg.from.email.split('@')[0]) || msg.category === 'updates';
  const bulk = ['promotions', 'social', 'forums'].includes(msg.category) || Boolean(msg.bulkHeader);
  const code = CODE.test(t) && /\b\d{4,8}\b/.test(text);
  const amount = BILL_WORDS.test(t) ? findAmount(text) : null;
  const bill = amount && !code ? { amount } : null;
  const deadlineKey = findDeadline(text, mailKey);
  const deadline = deadlineKey && deadlineKey >= addDays(today, -1) ? { key: deadlineKey, inDays: diffDays(today, deadlineKey) } : null;
  const asks = QUESTION.test(text) || REQUEST.test(t);
  const directToMe = Boolean(me) && msg.to.length === 1 && msg.to[0] === me.toLowerCase();
  const needsReply = !fromMe && !bulk && !automated && !code && asks;
  const personal = !bulk && !automated && !code && !fromMe;

  let score = 0;
  const reasons = [];
  if (needsReply) { score += 6; reasons.push(QUESTION.test(text) ? 'Te pregunta algo' : 'Te pide algo'); }
  if (deadline) {
    score += deadline.inDays <= 3 ? 4 : deadline.inDays <= 7 ? 2 : 1;
    reasons.push(`Fecha: ${deadline.inDays === 0 ? 'hoy' : deadline.inDays === 1 ? 'mañana' : formatDate(deadline.key, { weekday: 'short', day: 'numeric', month: 'short' })}`);
  }
  if (bill) { score += 3; reasons.push('Factura o pago'); }
  if (msg.important) { score += 3; reasons.push('Importante'); }
  if (msg.starred) { score += 2; reasons.push('Destacado'); }
  if (msg.unread) score += 2;
  if (personal && directToMe) { score += 1; if (!needsReply) reasons.push('Solo para ti'); }
  if (bulk) score -= 6;
  else if (automated && !bill && !deadline) score -= 3;
  if (code) score -= 4;
  const age = diffDays(mailKey, today);
  if (age > 3) score -= Math.min(3, Math.floor((age - 3) / 2));

  return { ...msg, mailKey, needsReply, personal, bulk, automated, code, bill, deadline, score, reasons, age };
}

/** ¿Ya hay un gasto con ese importe en Finanzas, ±7 días alrededor del correo? */
export function billRecorded(bill, mailKey, finance) {
  return Boolean(finance?.transactions?.some((t) => t.type === 'expense' && t.amount === bill.amount && Math.abs(diffDays(mailKey, t.date)) <= 7));
}

/** Agrupa la bandeja analizada: qué necesita atención, respuestas, facturas, fechas, boletines. */
export function digest(messages, { me = '', today, finance = null } = {}) {
  const analyzed = messages.map((m) => analyzeMessage(m, { me, today })).sort((a, b) => b.score - a.score || (a.date < b.date ? 1 : -1));
  for (const m of analyzed) if (m.bill) m.bill.recorded = billRecorded(m.bill, m.mailKey, finance);
  const bulk = analyzed.filter((m) => m.bulk);
  const senders = new Map();
  for (const m of bulk) senders.set(m.from.name, (senders.get(m.from.name) || 0) + 1);
  return {
    total: analyzed.length,
    unread: analyzed.filter((m) => m.unread).length,
    analyzed,
    attention: analyzed.filter((m) => m.score >= 4).slice(0, 6),
    needsReply: analyzed.filter((m) => m.needsReply).sort((a, b) => (a.date < b.date ? -1 : 1)), // la más antigua primero
    bills: analyzed.filter((m) => m.bill),
    deadlines: analyzed.filter((m) => m.deadline).sort((a, b) => (a.deadline.key < b.deadline.key ? -1 : 1)),
    personal: analyzed.filter((m) => m.personal && !m.needsReply),
    bulk,
    codes: analyzed.filter((m) => m.code),
    topSenders: [...senders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({ name, count })),
  };
}

/** Avisos del correo con cifras concretas ({ kind, priority, text }), para el resumen y el Inicio. */
export function inboxMessages(d, { today, currency = 'EUR' } = {}) {
  const out = [];
  const push = (kind, priority, text, ref = null) => out.push({ id: `inbox:${out.length}`, kind, priority, text, ref, source: 'inbox' });
  const days = (n) => (n === 0 ? 'hoy' : n === 1 ? 'desde ayer' : `desde hace ${n} días`);

  if (d.needsReply.length) {
    const oldest = d.needsReply[0];
    push('today', 82, d.needsReply.length === 1
      ? `${oldest.from.name} espera tu respuesta ${days(oldest.age)}: «${oldest.subject}».`
      : `${d.needsReply.length} correos esperan tu respuesta; el más antiguo, de ${oldest.from.name}, ${days(oldest.age)}.`, oldest);
  }
  for (const m of d.deadlines.filter((x) => x.deadline.inDays <= 3).slice(0, 2)) {
    const when = m.deadline.inDays === 0 ? 'es hoy' : m.deadline.inDays === 1 ? 'es mañana' : `es el ${formatDate(m.deadline.key, { weekday: 'long', day: 'numeric' })}`;
    push('risk', 78, `Fecha en el correo de ${m.from.name}: «${m.subject}» ${when}.`, m);
  }
  const pendingBills = d.bills.filter((m) => !m.bill.recorded);
  if (pendingBills.length === 1) {
    const m = pendingBills[0];
    push('today', 74, `${m.from.name}: ${formatMoney(m.bill.amount, currency)} en «${m.subject}». No está en tus gastos.`, m);
  } else if (pendingBills.length > 1) {
    const sum = pendingBills.reduce((a, m) => a + m.bill.amount, 0);
    push('today', 74, `${pendingBills.length} facturas o pagos (${formatMoney(sum, currency)}) que no están en tus gastos.`, pendingBills[0]);
  }
  if (d.total >= 8 && d.bulk.length / d.total >= 0.4) {
    const top = d.topSenders[0];
    push('insight', 30, `${d.bulk.length} de ${d.total} correos son promociones o boletines${top ? `; quien más envía: ${top.name} (${top.count})` : ''}.`);
  }
  return out.sort((a, b) => b.priority - a.priority);
}

/** Correos de ejemplo (ficticios) para probar el módulo sin conectar una cuenta. */
export function demoInbox(now = new Date()) {
  const at = (daysAgo, h, m = 0) => { const d = new Date(now); d.setDate(d.getDate() - daysAgo); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const me = 'tu.nombre@ejemplo.com';
  let n = 0;
  const msg = (from, subject, snippet, date, extra = {}) => ({
    id: `demo-${++n}`, threadId: `demo-t${n}`, provider: 'demo', from: parseAddress(from), to: [me], subject, snippet, date,
    unread: true, important: false, starred: false, category: 'primary', bulkHeader: false, link: null, ...extra,
  });
  const today = toKey(now);
  const friday = (() => { let k = today; while (weekday(k) !== 4) k = addDays(k, 1); return k; })();
  const fridayName = formatDate(friday, { weekday: 'long' });
  return {
    me,
    messages: [
      msg('Ana Ruiz <ana.ruiz@estudio-norte.example>', 'Presupuesto de la reforma', '¿Puedes confirmarme antes del jueves si te encaja la segunda opción? Así reservo al equipo.', at(2, 10, 14), { important: true, unread: false }),
      msg('Carlos Méndez <carlos@ejemplo.org>', 'Cena del sábado', 'Somos seis al final. ¿Te apuntas? Avísame y reservo mesa para las 21:30.', at(0, 9, 2)),
      msg('Laura (Equipo) <laura.gomez@trabajo.example>', 'Informe trimestral', `Recordatorio: la entrega del informe es el ${fridayName}. ¿Me mandas tu parte cuando puedas?`, at(1, 16, 40), { important: true }),
      msg('Luz Hogar <facturas@luzhogar.example>', 'Tu factura de octubre ya está disponible', 'Importe total: 64,15 €. Se cargará en tu cuenta el día 18. Consulta el detalle en tu área de cliente.', at(1, 8, 0), { category: 'updates' }),
      msg('Fibra Rápida <noreply@fibrarapida.example>', 'Recibo de noviembre', 'Hemos emitido tu recibo por 35,00 € correspondiente al periodo del 1 al 30 de noviembre.', at(3, 7, 30), { category: 'updates', unread: false }),
      msg('Banco Ejemplo <alertas@bancoejemplo.example>', 'Código de verificación', 'Tu código de verificación es 482913. No lo compartas con nadie. Caduca en 10 minutos.', at(0, 11, 5), { category: 'updates' }),
      msg('Clínica Dental Sonrisa <citas@clinicasonrisa.example>', 'Recordatorio de cita', 'Te recordamos tu cita mañana a las 17:00. Si no puedes asistir, avísanos con antelación.', at(0, 8, 30)),
      msg('Paquetería Veloz <envios@paqveloz.example>', 'Tu pedido está en camino', 'Tu pedido 4471 llegará entre hoy y mañana. Sigue el envío en tiempo real.', at(0, 7, 50), { category: 'updates' }),
      msg('Marta Sánchez <marta.s@ejemplo.net>', 'Fotos del viaje', 'Te paso el enlace con todas las fotos. ¡Qué buenos días pasamos!', at(1, 21, 10), { unread: false }),
      msg('Tienda Moda Urbana <promo@modaurbana.example>', '-40% solo este fin de semana', 'Nuevas rebajas en abrigos y botas. Envío gratis a partir de 50 €.', at(0, 6, 0), { category: 'promotions', bulkHeader: true }),
      msg('Tienda Moda Urbana <promo@modaurbana.example>', 'Últimas horas: rebajas', 'No te quedes sin tu talla. Descuentos de hasta el 40%.', at(1, 18, 0), { category: 'promotions', bulkHeader: true }),
      msg('Tienda Moda Urbana <promo@modaurbana.example>', 'Te hemos guardado algo', 'Artículos que te gustaron vuelven a estar disponibles.', at(2, 12, 0), { category: 'promotions', bulkHeader: true }),
      msg('Boletín Tecnología <boletin@noticiastec.example>', 'Las 10 noticias de la semana', 'Inteligencia artificial, móviles y más: el resumen semanal.', at(1, 7, 0), { category: 'updates', bulkHeader: true }),
      msg('Red Social <notificaciones@redsocial.example>', 'Tienes 5 notificaciones nuevas', 'A Pablo y 4 personas más les gustó tu publicación.', at(0, 10, 0), { category: 'social', bulkHeader: true }),
      msg('Gimnasio Activo <info@gimnasioactivo.example>', 'Nuevas clases de yoga', 'Desde el lunes, clases a las 7:00 y a las 20:00. ¡Reserva tu plaza en la app!', at(2, 9, 0), { category: 'promotions', bulkHeader: true }),
      msg('Viajes Sol <ofertas@viajessol.example>', 'Escapadas de invierno', 'Destinos con nieve desde 120 € por persona.', at(3, 11, 0), { category: 'promotions', bulkHeader: true, unread: false }),
      msg('Pedro Alonso <pedro.alonso@trabajo.example>', 'Re: reunión con el cliente', 'Perfecto, nos vemos en la reunión del lunes. Llevo yo la demo.', at(1, 13, 20), { unread: false }),
      msg('Seguros Tranquilo <polizas@segurostranquilo.example>', 'Renovación de tu póliza', 'Tu póliza de hogar se renueva el 1 de diciembre por un importe de 186,40 €.', at(2, 10, 0), { category: 'updates' }),
    ],
  };
}
