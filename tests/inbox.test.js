import { test, eq, ok } from './runner.js';
import { analyzeMessage, demoInbox, digest, findAmount, findDeadline, inboxMessages, parseAddress } from '../src/domain/inbox.js';

const T = '2026-11-11'; // miércoles
const NOW = new Date('2026-11-11T12:00:00');
const base = (over = {}) => ({
  id: 'x', threadId: 'x', provider: 'test', from: parseAddress('Ana <ana@ejemplo.com>'), to: ['yo@ejemplo.com'],
  subject: '', snippet: '', date: NOW.toISOString(), unread: true, important: false, starred: false, category: 'primary', bulkHeader: false, link: null, ...over,
});

test('inbox: parseAddress con y sin nombre', () => {
  eq(parseAddress('"Ana Ruiz" <Ana.Ruiz@Ejemplo.com>'), { name: 'Ana Ruiz', email: 'ana.ruiz@ejemplo.com' });
  eq(parseAddress('<solo@ejemplo.com>'), { name: 'solo', email: 'solo@ejemplo.com' });
  eq(parseAddress('pepe@ejemplo.com'), { name: 'pepe', email: 'pepe@ejemplo.com' });
});
test('inbox: importes en formato español y anglosajón', () => {
  eq(findAmount('Importe total: 64,15 €. Se cargará…'), 6415);
  eq(findAmount('Total due: $1,234.50'), 123450);
  eq(findAmount('recibo por 35,00 EUR'), 3500);
  eq(findAmount('Tu pedido 4471 llegará mañana'), null, 'sin moneda no es importe');
});
test('inbox: fechas solo con palabra de plazo, relativas al correo', () => {
  eq(findDeadline('La entrega vence mañana', T), '2026-11-12');
  eq(findDeadline('Confírmame antes del viernes', T), '2026-11-13');
  eq(findDeadline('Tu póliza vence el 3 de enero', '2026-12-20'), '2027-01-03', 'año siguiente');
  eq(findDeadline('Plazo: 20/11', T), '2026-11-20');
  eq(findDeadline('Nos vemos el viernes para cenar', T), null, 'sin palabra de plazo no cuenta');
});
test('inbox: clasificación de un correo', () => {
  const ask = analyzeMessage(base({ subject: 'Duda', snippet: '¿Puedes revisarlo hoy?' }), { me: 'yo@ejemplo.com', today: T });
  ok(ask.needsReply && ask.score >= 6, JSON.stringify(ask));
  const promo = analyzeMessage(base({ from: parseAddress('Tienda <promo@tienda.com>'), subject: '¿Te lo vas a perder?', category: 'promotions', bulkHeader: true }), { today: T });
  ok(promo.bulk && !promo.needsReply && promo.score < 0, 'promoción con interrogación no pide respuesta');
  const bot = analyzeMessage(base({ from: parseAddress('App <noreply@app.com>'), subject: '¿Olvidaste tu contraseña?' }), { today: T });
  ok(bot.automated && !bot.needsReply);
  const code = analyzeMessage(base({ from: parseAddress('Banco <alertas@banco.com>'), subject: 'Código', snippet: 'Tu código de verificación es 482913' }), { today: T });
  ok(code.code && !code.bill);
  const mine = analyzeMessage(base({ from: parseAddress('Yo <yo@ejemplo.com>'), snippet: '¿Quedamos?' }), { me: 'yo@ejemplo.com', today: T });
  ok(!mine.needsReply, 'mis propios correos no esperan respuesta');
});
test('inbox: resumen de la bandeja de ejemplo', () => {
  const { me, messages } = demoInbox(NOW);
  const d = digest(messages, { me, today: T });
  eq(d.total, 18);
  eq(d.needsReply.map((m) => m.from.name), ['Ana Ruiz', 'Laura (Equipo)', 'Carlos Méndez'], 'la más antigua primero');
  eq(d.bills.map((m) => m.bill.amount).sort((a, b) => a - b), [3500, 6415, 18640]);
  eq(d.codes.length, 1);
  ok(d.bulk.length >= 7);
  eq(d.topSenders[0], { name: 'Tienda Moda Urbana', count: 3 });
  ok(d.attention.length > 0 && d.attention[0].score >= d.attention.at(-1).score);
  ok(d.deadlines.some((m) => m.subject === 'Informe trimestral' && m.deadline.key === '2026-11-13'));
});
test('inbox: facturas ya registradas en Finanzas y avisos concretos', () => {
  const { me, messages } = demoInbox(NOW);
  const finance = { transactions: [{ type: 'expense', amount: 3500, date: '2026-11-08' }] }; // el recibo de fibra ya está
  const d = digest(messages, { me, today: T, finance });
  eq(d.bills.filter((m) => m.bill.recorded).length, 1);
  const texts = inboxMessages(d, { today: T }).map((m) => m.text);
  ok(texts.some((t) => t === '3 correos esperan tu respuesta; el más antiguo, de Ana Ruiz, desde hace 2 días.'), JSON.stringify(texts));
  ok(texts.some((t) => t.startsWith('2 facturas o pagos (250,55') && t.includes('no están en tus gastos')), JSON.stringify(texts));
  ok(texts.some((t) => t.includes('«Recordatorio de cita» es mañana')), JSON.stringify(texts));
});
test('inbox: versiones cortas para el Inicio y sin fechas ya pasadas', () => {
  const { me, messages } = demoInbox(NOW);
  const later = digest(messages, { me, today: '2026-11-13' }); // viernes: el jueves 12 ya pasó
  ok(later.deadlines.every((m) => m.deadline.key >= '2026-11-13'), JSON.stringify(later.deadlines.map((m) => m.deadline.key)));
  const msgs = inboxMessages(later, { today: '2026-11-13' });
  ok(!msgs.some((m) => m.text.includes('Presupuesto de la reforma')), 'la fecha del jueves no aparece el viernes');
  const reply = msgs.find((m) => m.text.includes('esperan tu respuesta'));
  eq(reply.short, '3 correos por responder · Ana Ruiz, hace 4 días');
  ok(msgs.every((m) => !m.short || m.short.length <= 60), JSON.stringify(msgs.map((m) => m.short)));
});
