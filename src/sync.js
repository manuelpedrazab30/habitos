// Sincronización automática con Supabase (Auth + una tabla con RLS). Sin SDK: solo fetch.
//
// - El estado se cifra EN EL DISPOSITIVO (src/backup.js, AES-256-GCM) antes de subirse: Supabase
//   solo guarda texto cifrado. La contraseña de cifrado es distinta de la de la cuenta.
// - Offline primero: localStorage sigue siendo la fuente local. Cada cambio marca `dirty` y se
//   sube tras un breve retraso; al abrir la app o volver a primer plano se baja lo nuevo.
// - Concurrencia optimista por `rev` (ver domain/sync.js). Si dos dispositivos cambiaron sin
//   sincronizar hay conflicto y el usuario elige qué versión conservar; nunca se pisa en silencio.
// - Config y sesión viven en localStorage['panel.sync'] (incluida la contraseña de cifrado, como
//   los propios datos en claro: quien tenga el dispositivo ya tiene acceso a ambos).

import { decryptBackup, encryptBackup, PBKDF2_ITERATIONS } from './backup.js';
import { decideSync, errorMessage, hasData, normalizeUrl, summarize } from './domain/sync.js';

export const SYNC_KEY = 'panel.sync';
const TABLE = '/rest/v1/panel_sync';

const blank = () => ({
  url: '', key: '', email: '', passphrase: '', access: '', refresh: '', expiresAt: 0,
  salt: null, baseRev: null, dirty: false, lastSyncAt: null,
});

export function createSync(store, {
  storage = globalThis.localStorage,
  fetchFn = (...a) => globalThis.fetch(...a),
  iterations = PBKDF2_ITERATIONS,
  now = () => Date.now(),
  debounceMs = 4000,
} = {}) {
  let cfg = load();
  let status = { state: cfg.refresh ? 'idle' : 'off', message: '', conflict: null };
  const listeners = new Set();
  let timer = null;
  let running = null;
  let again = false;
  let applying = false;
  let changes = 0;
  let pending = null; // { remote, json } mientras hay un conflicto sin resolver

  function load() {
    try {
      return { ...blank(), ...JSON.parse(storage?.getItem(SYNC_KEY) || 'null') };
    } catch {
      return blank();
    }
  }
  function save() {
    try { storage?.setItem(SYNC_KEY, JSON.stringify(cfg)); } catch { /* sin espacio: se reintenta en el siguiente cambio */ }
  }
  function setStatus(patch) {
    status = { ...status, ...patch };
    listeners.forEach((fn) => fn(api.status()));
  }
  const enabled = () => Boolean(cfg.refresh && cfg.passphrase && cfg.url);

  // ── Red

  async function request(path, { method = 'GET', body, token = true, headers = {} } = {}, retried = false) {
    if (token) await ensureToken();
    const res = await fetchFn(cfg.url + path, {
      method,
      headers: {
        apikey: cfg.key,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${cfg.access}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* respuesta vacía */ }
    if (res.status === 401 && token && !retried) {
      cfg.expiresAt = 0;
      return request(path, { method, body, token, headers }, true);
    }
    if (!res.ok) {
      const err = new Error(errorMessage(json, res.status));
      err.status = res.status;
      throw err;
    }
    return json;
  }

  function takeSession(s) {
    cfg.access = s.access_token;
    cfg.refresh = s.refresh_token;
    cfg.expiresAt = now() + (s.expires_in ?? 3600) * 1000;
    save();
  }

  async function ensureToken() {
    if (cfg.access && cfg.expiresAt - now() > 60_000) return;
    if (!cfg.refresh) throw new Error('Inicia sesión para sincronizar.');
    const s = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', token: false, body: { refresh_token: cfg.refresh } })
      .catch((e) => {
        // Refresh token rechazado (no un fallo de red): la sesión caducó o se cerró en otro sitio
        if (e.status === 400 || e.status === 401) { cfg.refresh = ''; cfg.access = ''; save(); setStatus({ state: 'off', message: 'La sesión ha caducado: vuelve a entrar.' }); }
        throw e;
      });
    takeSession(s);
  }

  // ── Cuenta

  /** Entra (o crea la cuenta) y hace la primera sincronización. Lanza Error con un mensaje legible. */
  async function signIn({ url, key, email, password, passphrase, create = false }) {
    const clean = normalizeUrl(url);
    if (!clean) throw new Error('La URL del proyecto debe empezar por https://');
    if (!key?.trim()) throw new Error('Falta la clave pública (anon).');
    if (!passphrase || passphrase.length < 8) throw new Error('La contraseña de cifrado necesita al menos 8 caracteres.');
    const prev = cfg;
    cfg = { ...blank(), url: clean, key: key.trim(), email: email.trim(), passphrase };
    try {
      const s = await request(create ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password', {
        method: 'POST', token: false, body: { email: cfg.email, password },
      });
      if (!s?.access_token) throw new Error('Cuenta creada: confirma el correo que te hemos enviado y pulsa “Entrar”.');
      takeSession(s);
      // Cuenta nueva en un servidor que ya tenía datos de otra: la primera sync decide
      const result = await run();
      if (result?.passphraseError) throw Object.assign(new Error(result.passphraseError), { passphrase: true });
    } catch (e) {
      if (!cfg.refresh || e.passphrase) { cfg = prev; save(); setStatus({ state: enabled() ? 'idle' : 'off', message: '' }); }
      throw e;
    }
  }

  function signOut() {
    clearTimeout(timer);
    cfg = blank();
    pending = null;
    save();
    setStatus({ state: 'off', message: '', conflict: null });
  }

  // ── Sincronizar

  async function pullRemote(remote, json) {
    applying = true;
    try { store.importJson(json, { undoable: false }); } finally { applying = false; }
    cfg.baseRev = remote.rev;
    cfg.salt = JSON.parse(remote.data).kdf?.salt ?? cfg.salt;
    cfg.dirty = false;
    cfg.lastSyncAt = new Date(now()).toISOString();
    pending = null;
    save();
  }

  async function decryptRemote(remote) {
    try {
      return await decryptBackup(remote.data, cfg.passphrase);
    } catch (e) {
      const err = new Error('La contraseña de cifrado no coincide con la de los datos guardados en la nube.');
      err.passphrase = true;
      throw err;
    }
  }

  async function runOnce() {
    const rows = await request(`${TABLE}?select=rev,data,updated_at`);
    const remote = rows?.[0] ?? null;
    const action = decideSync({ remoteRev: remote?.rev ?? null, baseRev: cfg.baseRev, dirty: cfg.dirty, localEmpty: !hasData(store.get()) });

    if (action === 'pull') {
      await pullRemote(remote, await decryptRemote(remote));
    } else if (action === 'push') {
      const stamp = changes;
      const text = await encryptBackup(store.exportJson(), cfg.passphrase, { iterations, salt: cfg.salt });
      const body = { data: text, updated_at: new Date(now()).toISOString() };
      let saved;
      if (remote) {
        saved = await request(`${TABLE}?rev=eq.${remote.rev}`, { method: 'PATCH', body: { ...body, rev: remote.rev + 1 }, headers: { Prefer: 'return=representation' } });
        if (!saved?.length) return 'retry'; // otro dispositivo se adelantó entre la lectura y la subida
      } else {
        saved = await request(TABLE, { method: 'POST', body: { ...body, rev: 1 }, headers: { Prefer: 'return=representation' } })
          .catch((e) => { if (e.status === 409) return []; throw e; });
        if (!saved?.length) return 'retry';
      }
      cfg.baseRev = saved[0].rev;
      cfg.salt = JSON.parse(text).kdf.salt;
      cfg.dirty = changes !== stamp; // cambió algo mientras se subía
      cfg.lastSyncAt = new Date(now()).toISOString();
      save();
      if (cfg.dirty) schedule();
    } else if (action === 'conflict') {
      const json = await decryptRemote(remote);
      pending = { remote, json };
      setStatus({
        state: 'conflict',
        message: 'Hay cambios distintos en este dispositivo y en la nube.',
        conflict: { local: summarize(store.get()), remote: summarize(JSON.parse(json)), remoteAt: remote.updated_at },
      });
      return 'conflict';
    } else {
      cfg.lastSyncAt = new Date(now()).toISOString();
      save();
    }
    return 'done';
  }

  async function run() {
    if (running) { again = true; return running; }
    running = (async () => {
      setStatus({ state: 'syncing', message: '', conflict: null });
      try {
        let outcome = await runOnce();
        if (outcome === 'retry') outcome = await runOnce();
        if (outcome === 'conflict') return { conflict: true };
        setStatus({ state: 'idle', message: '' });
        return {};
      } catch (e) {
        if (e.passphrase) {
          setStatus({ state: 'error', message: e.message });
          return { passphraseError: e.message };
        }
        const offline = e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
        if (cfg.refresh) setStatus({ state: 'error', message: offline ? 'Sin conexión: se sincronizará al volver.' : e.message });
        return { error: e.message };
      } finally {
        running = null;
        if (again) { again = false; schedule(); }
      }
    })();
    return running;
  }

  function schedule(ms = debounceMs) {
    if (!enabled() || status.state === 'conflict') return;
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }

  /** Elegir qué versión se conserva tras un conflicto: 'local' (sube la de aquí) o 'remote' (baja la de la nube). */
  async function resolve(choice) {
    if (!pending) return;
    const { remote, json } = pending;
    if (choice === 'remote') {
      await pullRemote(remote, json);
      setStatus({ state: 'idle', message: '', conflict: null });
    } else {
      cfg.baseRev = remote.rev;
      cfg.dirty = true;
      pending = null;
      save();
      setStatus({ state: 'idle', message: '', conflict: null });
      await run();
    }
  }

  // ── Arranque: marcar cambios y sincronizar al abrir / volver a primer plano / recuperar conexión

  store.subscribe(() => {
    if (applying || !enabled()) return;
    changes += 1;
    cfg.dirty = true;
    save();
    schedule();
  });

  const api = {
    enabled,
    syncNow: run,
    signIn,
    signOut,
    resolve,
    status: () => ({ ...status, email: cfg.email, lastSyncAt: cfg.lastSyncAt, dirty: cfg.dirty, url: cfg.url, key: cfg.key }),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start() {
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') schedule(300);
          else if (cfg.dirty) schedule(0); // al salir, subir ya lo pendiente
        });
        addEventListener('online', () => schedule(300));
      }
      schedule(300);
    },
  };
  return api;
}
