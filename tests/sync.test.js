import { test, eq, ok } from './runner.js';
import { createStore } from '../src/store.js';
import { createSync } from '../src/sync.js';
import { decideSync, hasData, normalizeUrl, errorMessage } from '../src/domain/sync.js';

// ── Lógica pura

test('sync: decideSync cubre cada caso', () => {
  const d = (remoteRev, baseRev, dirty, localEmpty = false) => decideSync({ remoteRev, baseRev, dirty, localEmpty });
  eq(d(null, null, false, true), 'noop');
  eq(d(null, null, true), 'push');
  eq(d(3, null, false, true), 'pull');
  eq(d(3, null, true), 'conflict');
  eq(d(3, 3, false), 'noop');
  eq(d(3, 3, true), 'push');
  eq(d(4, 3, false), 'pull');
  eq(d(4, 3, true), 'conflict');
  eq(d(2, 3, false), 'conflict');
});
test('sync: normalizeUrl exige https y quita rutas', () => {
  eq(normalizeUrl(' https://abc.supabase.co/ '), 'https://abc.supabase.co');
  eq(normalizeUrl('http://abc.supabase.co'), null);
  eq(normalizeUrl('abc'), null);
});
test('sync: mensajes de error legibles', () => {
  ok(errorMessage({ msg: 'Invalid login credentials' }, 400).includes('incorrectos'));
  ok(errorMessage({}, 404).includes('schema.sql'));
});

// ── Cliente con un Supabase falso en memoria

function fakeSupabase() {
  const db = { row: null, calls: [] };
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const session = { access_token: 'tok', refresh_token: 'ref', expires_in: 3600 };
  const fetchFn = async (url, opts = {}) => {
    const path = url.replace('https://x.supabase.co', '');
    db.calls.push(`${opts.method || 'GET'} ${path}`);
    if (path.startsWith('/auth/v1/token?grant_type=password')) {
      return JSON.parse(opts.body).password === 'bien' ? json(200, session) : json(400, { msg: 'Invalid login credentials' });
    }
    if (path.startsWith('/auth/v1/token?grant_type=refresh_token')) return json(200, session);
    if (path.startsWith('/auth/v1/signup')) return json(200, { user: {} }); // sin sesión: falta confirmar el correo
    if (path.startsWith('/rest/v1/panel_sync')) {
      if (opts.headers.Authorization !== 'Bearer tok') return json(401, { message: 'JWT' });
      const method = opts.method || 'GET';
      if (method === 'GET') return json(200, db.row ? [{ ...db.row }] : []);
      const body = JSON.parse(opts.body);
      if (method === 'POST') {
        if (db.row) return json(409, { message: 'duplicate key' });
        db.row = { rev: body.rev, data: body.data, updated_at: body.updated_at };
        return json(201, [{ ...db.row }]);
      }
      if (method === 'PATCH') {
        const want = Number(path.split('rev=eq.')[1]);
        if (!db.row || db.row.rev !== want) return json(200, []);
        db.row = { rev: body.rev, data: body.data, updated_at: body.updated_at };
        return json(200, [{ ...db.row }]);
      }
    }
    return json(404, {});
  };
  return { db, fetchFn };
}

function memStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function device(server) {
  const store = createStore(memStorage());
  const sync = createSync(store, { storage: memStorage(), fetchFn: server.fetchFn, iterations: 1000, debounceMs: 0 });
  return { store, sync };
}
const creds = { url: 'https://x.supabase.co', key: 'anon', email: 'a@b.c', password: 'bien', passphrase: 'cifrado-largo' };
const addHabit = (store, name) => store.addHabit({ name, kind: 'check', schedule: { type: 'daily' } });

test('sync: primer dispositivo sube sus datos cifrados', async () => {
  const server = fakeSupabase();
  const a = device(server);
  addHabit(a.store, 'Meditar');
  await a.sync.signIn(creds);
  ok(server.db.row && server.db.row.rev === 1);
  ok(!server.db.row.data.includes('Meditar'), 'el servidor no ve texto en claro');
  eq(a.sync.status().state, 'idle');
});

test('sync: un dispositivo vacío baja los datos de la nube', async () => {
  const server = fakeSupabase();
  const a = device(server);
  addHabit(a.store, 'Meditar');
  await a.sync.signIn(creds);
  const b = device(server);
  await b.sync.signIn(creds);
  eq(b.store.get().habits.map((x) => x.name), ['Meditar']);
});

test('sync: un cambio posterior se sube y el otro dispositivo lo baja', async () => {
  const server = fakeSupabase();
  const a = device(server);
  addHabit(a.store, 'Meditar');
  await a.sync.signIn(creds);
  const b = device(server);
  await b.sync.signIn(creds);
  addHabit(a.store, 'Leer');
  await a.sync.syncNow();
  eq(server.db.row.rev, 2);
  await b.sync.syncNow();
  eq(b.store.get().habits.length, 2);
  ok(!b.sync.status().dirty, 'bajar datos no marca cambios pendientes');
});

test('sync: cambios en los dos lados → conflicto y se resuelve eligiendo', async () => {
  const server = fakeSupabase();
  const a = device(server);
  addHabit(a.store, 'Meditar');
  await a.sync.signIn(creds);
  const b = device(server);
  await b.sync.signIn(creds);
  addHabit(a.store, 'Leer');
  addHabit(b.store, 'Correr');
  await a.sync.syncNow();
  await b.sync.syncNow();
  eq(b.sync.status().state, 'conflict');
  eq(b.sync.status().conflict.remote.habits, 2);
  await b.sync.resolve('local');
  eq(server.db.row.rev, 3);
  eq(b.store.get().habits.map((x) => x.name).sort(), ['Correr', 'Meditar']);
  await a.sync.syncNow();
  eq(a.store.get().habits.map((x) => x.name).sort(), ['Correr', 'Meditar']);
});

test('sync: contraseña de cifrado distinta se rechaza y no deja sesión', async () => {
  const server = fakeSupabase();
  const a = device(server);
  addHabit(a.store, 'Meditar');
  await a.sync.signIn(creds);
  const b = device(server);
  let msg = '';
  try { await b.sync.signIn({ ...creds, passphrase: 'otra-distinta' }); } catch (e) { msg = e.message; }
  ok(msg.includes('contraseña de cifrado'), msg);
  ok(!b.sync.enabled());
});

test('sync: credenciales erróneas y cuenta sin confirmar dan mensajes claros', async () => {
  const server = fakeSupabase();
  const a = device(server);
  let msg = '';
  try { await a.sync.signIn({ ...creds, password: 'mal' }); } catch (e) { msg = e.message; }
  ok(msg.includes('incorrectos'), msg);
  try { await a.sync.signIn({ ...creds, create: true }); } catch (e) { msg = e.message; }
  ok(msg.includes('confirma el correo'), msg);
  ok(!a.sync.enabled());
});

test('sync: hasData distingue un dispositivo vacío', () => {
  ok(!hasData(createStore(memStorage()).get()));
});
