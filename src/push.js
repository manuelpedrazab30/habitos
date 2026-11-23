// Avisos push (Web Push) enviados por una Edge Function de Supabase (supabase/functions/send-reminders).
//
// Requiere la sincronización conectada (usa su sesión) y, en iPhone, la app instalada en la pantalla
// de inicio (iOS 16.4+). La app sube a la tabla panel_push la suscripción de este dispositivo y la lista
// de próximos avisos (domain/notify.js, SIN cifrar y sin nombres de hábitos); un cron de Supabase
// ejecuta la función cada minuto y envía los que ya tocan.
//
// Las preferencias (activado, hora) viven en localStorage['panel.push'], por dispositivo; la lista
// de avisos es única por cuenta (la última que se sube gana).

import { buildReminders, DEFAULT_TIME, validTime } from './domain/notify.js';

export const PUSH_KEY = 'panel.push';
const TABLE = '/rest/v1/panel_push';
const FUNCTION = '/functions/v1/send-reminders';

const b64ToBytes = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
};

export function pushSupported() {
  return typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator
    && 'PushManager' in window && 'Notification' in window;
}

export function createPush(store, sync, { storage = globalThis.localStorage, now = () => new Date(), debounceMs = 8000 } = {}) {
  let prefs = load();
  let timer = null;
  let busy = false;
  const listeners = new Set();
  let message = '';

  function load() {
    try {
      return { enabled: false, time: DEFAULT_TIME, last: '', ...JSON.parse(storage?.getItem(PUSH_KEY) || 'null') };
    } catch {
      return { enabled: false, time: DEFAULT_TIME, last: '' };
    }
  }
  function save() {
    try { storage?.setItem(PUSH_KEY, JSON.stringify(prefs)); } catch { /* sin espacio */ }
  }
  const emit = () => listeners.forEach((fn) => fn(api.status()));

  async function registration() {
    return navigator.serviceWorker.ready;
  }

  /** Sube la lista de avisos (solo si cambió, o con `force`). `extra` añade avisos sueltos (prueba). */
  async function refresh({ force = false, extra = [] } = {}) {
    if (!prefs.enabled || !sync.enabled() || busy) return;
    const list = [...buildReminders(store.get(), { now: now(), time: prefs.time }), ...extra];
    const sig = JSON.stringify(list);
    if (!force && sig === prefs.last) return;
    busy = true;
    try {
      await sync.request(`${TABLE}?on_conflict=user_id`, {
        method: 'POST',
        body: { reminders: list, updated_at: new Date().toISOString() },
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
      prefs.last = sig;
      save();
      message = '';
    } catch (e) {
      message = e.status === 404 ? 'Falta la tabla panel_push: ejecuta supabase/push.sql en Supabase.' : e.message;
    } finally {
      busy = false;
      emit();
    }
  }

  function schedule(ms = debounceMs) {
    if (!prefs.enabled) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, ms);
  }

  const api = {
    supported: pushSupported,
    status: () => ({
      supported: pushSupported(),
      enabled: prefs.enabled,
      time: prefs.time,
      message,
      permission: typeof Notification !== 'undefined' ? Notification.permission : 'denied',
      needsSync: !sync.enabled(),
    }),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Debe llamarse desde un toque (el permiso de notificaciones exige un gesto del usuario). */
    async enable(time = prefs.time) {
      if (!pushSupported()) throw new Error('Este navegador no admite avisos. En iPhone, instala la app en la pantalla de inicio.');
      if (!sync.enabled()) throw new Error('Conecta primero la sincronización con Supabase.');
      if (!validTime(time)) throw new Error('La hora no es válida.');
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('No diste permiso de notificaciones. Puedes activarlo en los ajustes del sistema.');
      let key;
      try {
        key = (await sync.request(`${FUNCTION}?action=key`)).publicKey;
      } catch (e) {
        throw new Error(e.status === 404 ? 'Falta desplegar la función send-reminders en Supabase.' : e.message);
      }
      const reg = await registration();
      const subscription = (await reg.pushManager.getSubscription())
        || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      const mine = subscription.toJSON();
      // Fusionar con las suscripciones de otros dispositivos de la cuenta
      const rows = await sync.request(`${TABLE}?select=subscriptions`);
      const others = (rows?.[0]?.subscriptions ?? []).filter((s) => s.endpoint !== mine.endpoint);
      await sync.request(`${TABLE}?on_conflict=user_id`, {
        method: 'POST',
        body: { subscriptions: [...others, mine], updated_at: new Date().toISOString() },
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
      prefs = { ...prefs, enabled: true, time, last: '' };
      save();
      await refresh({ force: true });
      emit();
    },

    async disable() {
      clearTimeout(timer);
      prefs = { ...prefs, enabled: false, last: '' };
      save();
      try {
        const reg = await registration();
        const sub = await reg.pushManager.getSubscription();
        if (sub && sync.enabled()) {
          const rows = await sync.request(`${TABLE}?select=subscriptions`);
          const rest = (rows?.[0]?.subscriptions ?? []).filter((s) => s.endpoint !== sub.endpoint);
          await sync.request(`${TABLE}?on_conflict=user_id`, {
            method: 'POST',
            body: { subscriptions: rest, reminders: rest.length ? undefined : [], updated_at: new Date().toISOString() },
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          });
        }
        await sub?.unsubscribe();
      } catch { /* sin red: la suscripción caducada se limpia sola en el servidor */ }
      message = '';
      emit();
    },

    async setTime(time) {
      if (!validTime(time)) return;
      prefs.time = time;
      save();
      await refresh({ force: true });
      emit();
    },

    /** Envía un aviso de prueba: llega en menos de un minuto (el cron pasa cada minuto). */
    async test() {
      await refresh({ force: true, extra: [{ id: 'test', at: new Date().toISOString(), title: 'Prueba de avisos', body: 'Si ves esto, los avisos funcionan.', url: './#/ajustes' }] });
    },

    start() {
      store.subscribe(() => schedule());
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(500); });
      }
      schedule(1500);
    },
  };
  return api;
}
