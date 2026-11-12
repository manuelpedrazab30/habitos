// Copias de seguridad cifradas (sin servidor). El estado se cifra EN EL DISPOSITIVO con una
// contraseña que solo conoce el usuario y se guarda donde él quiera (en iPhone: Compartir →
// Guardar en Archivos → iCloud Drive). Sin la contraseña el archivo es ilegible.
//
// Cifrado: AES-256-GCM (autenticado: detecta archivos alterados o contraseña errónea) con
// clave derivada por PBKDF2-SHA-256 (600 000 iteraciones, sal aleatoria de 16 bytes).
// Todo con WebCrypto (crypto.subtle), que solo existe en contexto seguro: HTTPS o localhost.
//
// Formato del archivo (JSON):
//   { format: 'panel-backup', version: 1, createdAt, kdf: { name, hash, iterations, salt },
//     cipher: { name: 'AES-GCM', iv }, data }   (salt, iv y data en base64)

export const BACKUP_FORMAT = 'panel-backup';
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE = 8;
export const BACKUP_KEY = 'panel.lastBackup'; // fecha de la última copia hecha (en este dispositivo)
export const BACKUP_EVERY_DAYS = 7;

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export const cryptoAvailable = () => Boolean(globalThis.crypto?.subtle);

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Cifra un texto (el JSON del estado) → texto JSON del archivo de copia. */
export async function encryptBackup(plaintext, passphrase, { iterations = PBKDF2_ITERATIONS, now = new Date() } = {}) {
  if (!cryptoAvailable()) throw new Error('El cifrado necesita HTTPS (o localhost).');
  if (String(passphrase).length < MIN_PASSPHRASE) throw new Error(`La contraseña debe tener al menos ${MIN_PASSPHRASE} caracteres.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)));
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: 1,
    createdAt: now.toISOString(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) },
    cipher: { name: 'AES-GCM', iv: toB64(iv) },
    data: toB64(data),
  });
}

/** ¿Es un archivo de copia cifrada (y no una exportación JSON sin cifrar)? */
export function isEncryptedBackup(text) {
  try {
    return JSON.parse(text)?.format === BACKUP_FORMAT;
  } catch {
    return false;
  }
}

/** Descifra el archivo → texto original. Contraseña errónea o archivo alterado → Error claro. */
export async function decryptBackup(fileText, passphrase) {
  if (!cryptoAvailable()) throw new Error('El cifrado necesita HTTPS (o localhost).');
  let f;
  try {
    f = JSON.parse(fileText);
  } catch {
    throw new Error('El archivo no es una copia de esta app.');
  }
  if (f?.format !== BACKUP_FORMAT || f.version !== 1 || f.kdf?.name !== 'PBKDF2' || f.cipher?.name !== 'AES-GCM') {
    throw new Error('Formato de copia no reconocido.');
  }
  const key = await deriveKey(passphrase, fromB64(f.kdf.salt), f.kdf.iterations);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(f.cipher.iv) }, key, fromB64(f.data));
    return dec.decode(plain);
  } catch {
    throw new Error('Contraseña incorrecta (o el archivo está dañado).');
  }
}

// ── Guardar el archivo: hoja de Compartir del sistema (iPhone → Guardar en Archivos) o descarga

/**
 * Devuelve 'shared' | 'downloaded' | 'cancelled'. En iOS/macOS abre la hoja de Compartir
 * con el archivo; si no se puede, lo descarga.
 */
export async function saveFile(text, filename) {
  const file = new File([text], filename, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Copia de Panel' });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      // Otros errores (p. ej. sin gesto de usuario): caer a descarga
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  return 'downloaded';
}

// ── Estado de las copias y del almacenamiento

export const lastBackupAt = () => localStorage.getItem(BACKUP_KEY);
export const markBackupDone = (now = new Date()) => localStorage.setItem(BACKUP_KEY, now.toISOString());

/** Días desde la última copia (null si nunca). */
export function daysSinceBackup(now = new Date()) {
  const last = lastBackupAt();
  return last ? Math.floor((now - new Date(last)) / 86_400_000) : null;
}

/** Toca recordar la copia: hay datos y nunca se hizo, o hace más de BACKUP_EVERY_DAYS días. */
export function backupOverdue(state, now = new Date()) {
  const hasData = state.habits.length > 0 || (state.finance?.transactions?.length ?? 0) > 0;
  if (!hasData) return false;
  const d = daysSinceBackup(now);
  return d === null || d >= BACKUP_EVERY_DAYS;
}

/**
 * Pide al navegador que no borre el almacenamiento por falta de espacio. Safari/Chrome
 * deciden según el uso (en la app instalada suele concederse). Devuelve true/false/null.
 */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function isStoragePersisted() {
  try {
    return navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    return null;
  }
}
