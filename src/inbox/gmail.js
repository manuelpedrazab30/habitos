import { parseAddress } from '../domain/inbox.js';

// Proveedor Gmail: OAuth 2.0 para apps web sin servidor (flujo de token por redirección)
// y la API REST de Gmail con permiso de SOLO LECTURA. Sin librerías de Google.
//
//  1. startGmailAuth() lleva a la pantalla de Google; al aceptar, Google vuelve a la app con
//     #access_token=… en la URL.
//  2. handleOAuthRedirect() (al arrancar, antes del router) valida `state`, guarda el token en
//     sessionStorage (dura ~1 h) y deja la URL en #/correo.
//  3. fetchGmail() lee los últimos días de la bandeja: solo cabeceras y el extracto (snippet),
//     nunca el cuerpo completo.
// El token nunca sale del dispositivo salvo hacia Google.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const TOKEN_KEY = 'panel.gmail.token';
const STATE_KEY = 'panel.gmail.state';

export class GmailAuthError extends Error {}

/** URL a la que Google devuelve al usuario: hay que darla de alta tal cual en Google Cloud. */
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

export function startGmailAuth(clientId, loginHint = '') {
  const state = crypto.getRandomValues(new Uint32Array(4)).join('-');
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: GMAIL_SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  if (loginHint) params.set('login_hint', loginHint);
  location.assign(`${AUTH_URL}?${params}`);
}

/** Procesa la vuelta de Google. Devuelve null si la URL no es una respuesta de OAuth. */
export function handleOAuthRedirect() {
  const hash = location.hash.slice(1);
  if (!/(^|&)(access_token|error)=/.test(hash)) return null;
  const p = new URLSearchParams(hash);
  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  history.replaceState(null, '', `${location.pathname}${location.search}#/correo`);
  if (p.get('error')) return { error: p.get('error') === 'access_denied' ? 'Has cancelado el acceso a Gmail.' : `Google devolvió un error: ${p.get('error')}` };
  if (!expected || p.get('state') !== expected) return { error: 'La respuesta de Google no coincide con la solicitud (state). Inténtalo de nuevo.' };
  if (!String(p.get('scope') || '').includes(GMAIL_SCOPE)) return { error: 'No se concedió el permiso de lectura de Gmail.' };
  const token = { value: p.get('access_token'), expiresAt: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000 - 60_000 };
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  return { ok: true };
}

export function gmailToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
    return t && t.expiresAt > Date.now() ? t.value : null;
  } catch {
    return null;
  }
}
export const clearGmailToken = () => sessionStorage.removeItem(TOKEN_KEY);

async function api(path, token) {
  const res = await fetch(`${API}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { clearGmailToken(); throw new GmailAuthError('La sesión de Gmail ha caducado.'); }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* sin cuerpo */ }
    if (res.status === 403 && /has not been used|is disabled/i.test(detail)) throw new Error('La API de Gmail no está activada en tu proyecto de Google Cloud (paso 2 de la guía).');
    if (res.status === 403) throw new Error(`Google ha denegado el acceso (${detail || 'permiso insuficiente'}). Revisa que tu cuenta esté como usuario de prueba.`);
    throw new Error(`Error de Gmail ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return res.json();
}

/** Ejecuta fn sobre items con como mucho `n` peticiones a la vez. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

const decodeEntities = (s) => new DOMParser().parseFromString(`<!doctype html><body>${s}`, 'text/html').body.textContent || '';
const CATEGORY = { CATEGORY_PROMOTIONS: 'promotions', CATEGORY_SOCIAL: 'social', CATEGORY_UPDATES: 'updates', CATEGORY_FORUMS: 'forums' };

function toMessage(g) {
  const header = (name) => g.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
  const labels = new Set(g.labelIds || []);
  const category = Object.entries(CATEGORY).find(([l]) => labels.has(l))?.[1] || 'primary';
  return {
    id: g.id,
    threadId: g.threadId,
    provider: 'gmail',
    from: parseAddress(header('From')),
    to: (header('To').match(/[^\s<>",;]+@[^\s<>",;]+/g) || []).map((e) => e.toLowerCase()),
    subject: header('Subject') || '(sin asunto)',
    snippet: decodeEntities(g.snippet || ''),
    date: new Date(Number(g.internalDate) || Date.parse(header('Date')) || Date.now()).toISOString(),
    unread: labels.has('UNREAD'),
    important: labels.has('IMPORTANT'),
    starred: labels.has('STARRED'),
    category,
    bulkHeader: Boolean(header('List-Unsubscribe')),
    link: `https://mail.google.com/mail/u/0/#all/${g.threadId}`,
  };
}

/** Lee la bandeja de entrada de los últimos `days` días (máx. `max` correos). */
export async function fetchGmail(token, { days = 3, max = 40 } = {}) {
  const profile = await api('profile', token);
  const q = encodeURIComponent(`in:inbox newer_than:${days}d`);
  const list = await api(`messages?maxResults=${max}&q=${q}`, token);
  const ids = list.messages || [];
  const fields = ['From', 'To', 'Subject', 'Date', 'List-Unsubscribe'].map((h) => `metadataHeaders=${encodeURIComponent(h)}`).join('&');
  const full = await pool(ids, 6, (m) => api(`messages/${m.id}?format=metadata&${fields}`, token));
  return { me: profile.emailAddress.toLowerCase(), messages: full.map(toMessage) };
}
