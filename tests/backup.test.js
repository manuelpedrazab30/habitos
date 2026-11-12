import { test, eq, ok } from './runner.js';
import { BACKUP_KEY, backupOverdue, decryptBackup, encryptBackup, isEncryptedBackup, PBKDF2_ITERATIONS } from '../src/backup.js';

const FAST = { iterations: 1000 }; // los tests no necesitan 600 000 iteraciones
const sample = JSON.stringify({ version: 5, habits: [{ name: 'Meditar' }], finance: { transactions: [{ amount: 1250, note: 'Café ☕ ñ €' }] } });

async function rejects(promise, includes) {
  try {
    await promise;
  } catch (e) {
    ok(e.message.includes(includes), `mensaje inesperado: ${e.message}`);
    return;
  }
  throw new Error('se esperaba un error');
}

test('backup: cifrar y descifrar devuelve exactamente lo mismo (con acentos y emojis)', async () => {
  const file = await encryptBackup(sample, 'contraseña larga', FAST);
  ok(isEncryptedBackup(file));
  ok(!file.includes('Meditar') && !file.includes('Café'), 'el archivo no contiene texto en claro');
  eq(await decryptBackup(file, 'contraseña larga'), sample);
});
test('backup: formato con sal e IV aleatorios en cada copia', async () => {
  const a = JSON.parse(await encryptBackup(sample, 'contraseña larga', FAST));
  const b = JSON.parse(await encryptBackup(sample, 'contraseña larga', FAST));
  eq([a.format, a.version, a.kdf.name, a.kdf.hash, a.cipher.name], ['panel-backup', 1, 'PBKDF2', 'SHA-256', 'AES-GCM']);
  ok(a.kdf.salt !== b.kdf.salt && a.cipher.iv !== b.cipher.iv && a.data !== b.data);
});
test('backup: contraseña incorrecta o archivo alterado se rechazan', async () => {
  const file = await encryptBackup(sample, 'contraseña larga', FAST);
  await rejects(decryptBackup(file, 'otra contraseña'), 'Contraseña incorrecta');
  const f = JSON.parse(file);
  const bytes = atob(f.data);
  f.data = btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1)); // un bit cambiado
  await rejects(decryptBackup(JSON.stringify(f), 'contraseña larga'), 'Contraseña incorrecta');
  await rejects(decryptBackup('{"habits":[]}', 'x'), 'Formato de copia no reconocido');
  await rejects(encryptBackup(sample, 'corta', FAST), 'al menos 8');
});
test('backup: las exportaciones sin cifrar no se confunden con copias cifradas', () => {
  ok(!isEncryptedBackup(sample));
  ok(!isEncryptedBackup('no es json'));
});
test('backup: la copia por defecto usa 600 000 iteraciones', async () => {
  eq(PBKDF2_ITERATIONS, 600000);
  const file = await encryptBackup('{}', 'contraseña larga');
  eq(JSON.parse(file).kdf.iterations, 600000);
});
test('backup: aviso si hay datos y nunca se hizo copia o hace 7 días o más', () => {
  const saved = localStorage.getItem(BACKUP_KEY);
  try {
    const now = new Date('2026-11-12T12:00:00');
    const withData = { habits: [{}], finance: { transactions: [] } };
    localStorage.removeItem(BACKUP_KEY);
    eq(backupOverdue({ habits: [], finance: { transactions: [] } }, now), false, 'sin datos no avisa');
    eq(backupOverdue(withData, now), true, 'nunca hecha');
    localStorage.setItem(BACKUP_KEY, new Date('2026-11-08T12:00:00').toISOString());
    eq(backupOverdue(withData, now), false, 'hace 4 días');
    localStorage.setItem(BACKUP_KEY, new Date('2026-11-05T12:00:00').toISOString());
    eq(backupOverdue(withData, now), true, 'hace 7 días');
  } finally {
    if (saved === null) localStorage.removeItem(BACKUP_KEY);
    else localStorage.setItem(BACKUP_KEY, saved);
  }
});
