import { todayKey } from '../domain/dates.js';
import { demoInbox, digest } from '../domain/inbox.js';
import { clearGmailToken, fetchGmail, GmailAuthError, gmailToken, startGmailAuth } from './gmail.js';
import { aiBriefing, DEFAULT_AI_MODEL } from './ai.js';

// Estado del módulo Correo. Va APARTE del estado de la app (store.js) a propósito:
//  - panel.inbox.config: id de cliente de Google, cuenta, clave de Claude y modelo.
//  - panel.inbox.cache:  la última lectura de la bandeja y el último resumen con IA.
// Así las copias de seguridad cifradas nunca incluyen tus correos ni tus claves, y el
// resto de la app no depende de este módulo. El token de Gmail va en sessionStorage.

const CONFIG_KEY = 'panel.inbox.config';
const CACHE_KEY = 'panel.inbox.cache';

const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fallback; } catch { return fallback; } };
const write = (k, v) => (v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)));

export const inboxConfig = () => ({ mode: null, clientId: '', account: '', aiKey: '', aiModel: DEFAULT_AI_MODEL, days: 3, ...read(CONFIG_KEY, {}) });
export const saveInboxConfig = (patch) => write(CONFIG_KEY, { ...inboxConfig(), ...patch });
export const inboxCache = () => read(CACHE_KEY, null);
const saveCache = (patch) => write(CACHE_KEY, { ...(inboxCache() || {}), ...patch });

export const isConnected = () => Boolean(inboxConfig().mode);
let busy = null; // 'mail' | 'ai' | null
export const inboxBusy = () => busy;

/** Bandeja analizada a partir de la caché (o null). La lee cada vista; es barato. */
export function currentDigest(finance) {
  const c = inboxCache();
  if (!c?.messages) return null;
  return digest(c.messages, { me: c.me, today: todayKey(), finance });
}

/**
 * Actualiza la bandeja. En modo Gmail, si no hay token válido, lleva a la pantalla de Google
 * (la app se recarga al volver). onChange se llama al empezar y terminar cada paso.
 */
export async function refreshInbox({ finance, currency, onChange = () => {} } = {}) {
  const cfg = inboxConfig();
  if (!cfg.mode || busy) return;
  try {
    busy = 'mail';
    onChange();
    if (cfg.mode === 'demo') {
      const d = demoInbox(new Date());
      saveCache({ fetchedAt: new Date().toISOString(), me: d.me, messages: d.messages, error: null });
    } else {
      const token = gmailToken();
      if (!token) { busy = null; startGmailAuth(cfg.clientId, cfg.account); return; }
      const { me, messages } = await fetchGmail(token, { days: cfg.days });
      if (!cfg.account) saveInboxConfig({ account: me });
      saveCache({ fetchedAt: new Date().toISOString(), me, messages, error: null });
    }
    if (cfg.aiKey) await runAi({ finance, currency, onChange });
  } catch (e) {
    if (e instanceof GmailAuthError) saveCache({ error: 'La sesión de Gmail ha caducado: pulsa Actualizar para volver a entrar.' });
    else saveCache({ error: e.message || String(e) });
  } finally {
    busy = null;
    onChange();
  }
}

/** Pide (otra vez) el resumen con IA de la bandeja en caché. */
export async function runAi({ finance, currency, onChange = () => {} } = {}) {
  const cfg = inboxConfig();
  const d = currentDigest(finance);
  if (!cfg.aiKey || !d || !d.total) return;
  busy = 'ai';
  onChange();
  try {
    const result = await aiBriefing(d, { apiKey: cfg.aiKey, model: cfg.aiModel, today: todayKey(), currency });
    saveCache({ ai: { at: new Date().toISOString(), forFetch: inboxCache()?.fetchedAt, result }, aiError: null });
  } catch (e) {
    saveCache({ aiError: e.message || String(e) });
  } finally {
    busy = null;
    onChange();
  }
}

export function connectDemo() {
  saveInboxConfig({ mode: 'demo' });
  write(CACHE_KEY, null);
}

/** Desconecta: borra token, caché y cuenta (conserva el id de cliente y la clave de IA). */
export function disconnectInbox() {
  clearGmailToken();
  write(CACHE_KEY, null);
  saveInboxConfig({ mode: null, account: '' });
}
