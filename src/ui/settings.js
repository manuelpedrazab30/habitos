import { h, toast } from './dom.js';
import { installCard } from './install.js';
import { applyTheme, currentTheme, THEMES } from './theme.js';
import { openSheet } from './sheet.js';
import { formatDate } from '../domain/dates.js';
import { summaryText } from '../domain/sync.js';
import { APP_DATE, APP_VERSION } from '../version.js';
import {
  BACKUP_EVERY_DAYS, cryptoAvailable, daysSinceBackup, decryptBackup, encryptBackup, isEncryptedBackup,
  isStoragePersisted, lastBackupAt, markBackupDone, MIN_PASSPHRASE, saveFile,
} from '../backup.js';

export function settingsView(state, ctx) {
  const archived = state.habits.filter((x) => x.archived);
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onChange: async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // permitir elegir el mismo archivo otra vez
    if (!file) return;
    const text = await file.text();
    if (isEncryptedBackup(text)) restoreSheet(ctx, text);
    else confirmImport(ctx, text, 'sin cifrar');
  } });
  return h('section', { class: 'view settings' },
    h('h1', {}, 'Ajustes'),
    syncCard(ctx),
    backupCard(state, ctx, fileInput),
    h('div', { class: 'card' },
      h('h2', {}, 'Estilo visual'),
      h('p', { class: 'muted small' }, 'Cambia el aspecto de toda la app. Tus datos no se tocan.'),
      h('div', { class: 'theme-grid' }, THEMES.map((t) => h('button', {
        class: `theme-opt ${currentTheme() === t.id ? 'on' : ''}`,
        'aria-pressed': String(currentTheme() === t.id),
        onClick: () => { applyTheme(t.id); ctx.rerender(); },
      }, h('span', { class: 'theme-dot', style: { background: t.dot } }), t.label))),
    ),
    installCard(),
    archived.length ? h('div', { class: 'card' },
      h('h2', {}, 'Archivados'),
      h('ul', { class: 'plain' }, archived.map((x) => h('li', {},
        h('a', { href: `#/habito/${x.id}` }, `${x.emoji} ${x.name}`),
        h('button', { class: 'btn ghost small', onClick: () => ctx.store.setArchived(x.id, false) }, 'Restaurar')))),
    ) : null,
    h('div', { class: 'card' },
      h('h2', {}, 'Empezar de cero'),
      h('button', { class: 'btn danger', onClick: () => {
        if (!confirm('¿Borrar todos los hábitos y registros?')) return;
        ctx.store.reset();
        toast('Datos borrados', { action: 'Deshacer', onAction: () => ctx.store.undo(), timeout: 8000 });
      } }, 'Borrar todo'),
    ),
    h('p', { class: 'muted small app-version' }, `Versión ${APP_VERSION} · ${formatDate(APP_DATE, { day: 'numeric', month: 'short', year: 'numeric' })}`),
  );
}

// ── Copias de seguridad cifradas (src/backup.js)

function backupCard(state, ctx, fileInput) {
  const days = daysSinceBackup();
  const last = lastBackupAt();
  const overdue = days === null || days >= BACKUP_EVERY_DAYS;
  const persisted = h('span', { class: 'muted small' }, 'Comprobando…');
  isStoragePersisted().then((v) => {
    persisted.textContent = v === true ? '✓ Este dispositivo no borrará tus datos por falta de espacio.'
      : v === false ? 'El sistema aún no ha protegido el almacenamiento: haz copias con frecuencia.' : '';
  });
  return h('div', { class: `card backup-card ${overdue ? 'overdue' : ''}` },
    h('h2', {}, 'Copia de seguridad'),
    h('p', { class: 'muted small' }, 'Tus datos solo viven en este dispositivo. La copia se cifra aquí con tu contraseña y la guardas tú (en iPhone: Guardar en Archivos → iCloud Drive). Sin la contraseña nadie puede leerla.'),
    h('p', { class: `backup-status ${overdue ? 'warn' : 'pos'}` },
      last ? `Última copia: ${days === 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days} días`} (${new Date(last).toLocaleDateString('es', { day: 'numeric', month: 'long' })})` : 'Aún no has hecho ninguna copia.',
      overdue ? ` · conviene hacer una cada ${BACKUP_EVERY_DAYS} días` : ''),
    persisted,
    !cryptoAvailable() ? h('p', { class: 'error small' }, 'El cifrado solo funciona en la web publicada (HTTPS) o en localhost.') : null,
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', disabled: !cryptoAvailable(), onClick: () => backupSheet(ctx) }, 'Hacer copia cifrada'),
      h('button', { class: 'btn ghost', onClick: () => fileInput.click() }, 'Restaurar copia'),
      fileInput,
    ),
    h('button', { class: 'linklike small', onClick: async () => {
      if (!confirm('La copia sin cifrar se puede leer con cualquier editor de texto. ¿Exportar igualmente?')) return;
      await saveFile(ctx.store.exportJson(), `panel-sin-cifrar-${ctx.today()}.json`);
    } }, 'Exportar sin cifrar (JSON legible)'),
  );
}

/** Campos de contraseña preparados para el llavero (iCloud Keychain puede guardarla y rellenarla). */
function passFields(mode) {
  const user = h('input', { type: 'text', name: 'username', autocomplete: 'username', value: 'Copia de Panel', class: 'visually-hidden', tabindex: -1, 'aria-hidden': 'true', readonly: true });
  const pass = h('input', { type: 'password', name: 'password', autocomplete: mode === 'new' ? 'new-password' : 'current-password', minlength: MIN_PASSPHRASE, placeholder: 'Contraseña de la copia', 'aria-label': 'Contraseña', required: true });
  return { user, pass };
}

function backupSheet(ctx) {
  openSheet((close) => {
    const { user, pass } = passFields('new');
    const confirm2 = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Repite la contraseña', 'aria-label': 'Repetir contraseña', required: true });
    const err = h('small', { class: 'error' });
    const submit = h('button', { type: 'submit', class: 'btn primary' }, 'Cifrar copia');
    const body = h('div', { class: 'sheet-form' });
    const form = h('form', { class: 'sheet-form', onSubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (pass.value.length < MIN_PASSPHRASE) { err.textContent = `Usa al menos ${MIN_PASSPHRASE} caracteres.`; return; }
      if (pass.value !== confirm2.value) { err.textContent = 'Las contraseñas no coinciden.'; return; }
      submit.disabled = true;
      submit.textContent = 'Cifrando…';
      try {
        const text = await encryptBackup(ctx.store.exportJson(), pass.value);
        ready(text);
      } catch (e2) {
        err.textContent = e2.message;
        submit.disabled = false;
        submit.textContent = 'Cifrar copia';
      }
    } },
    user,
    h('p', { class: 'muted small' }, `Elige una contraseña (mín. ${MIN_PASSPHRASE} caracteres). Tu iPhone puede guardarla en el llavero. Si la pierdes, la copia no se puede abrir: nadie puede recuperarla.`),
    pass, confirm2, err,
    h('div', { class: 'sheet-actions' }, submit),
    );

    // Paso 2: guardar. Va en un toque aparte porque la hoja de Compartir de iOS exige un gesto directo.
    function ready(text) {
      const st = ctx.store.get();
      const kb = Math.max(1, Math.round(text.length / 1024));
      body.replaceChildren(
        h('p', {}, h('b', {}, 'Copia cifrada lista'), ` · ${kb} KB · ${st.habits.length} hábitos, ${st.finance.transactions.length} movimientos, ${st.study.tasks.length + st.study.exams.length} tareas y exámenes`),
        h('p', { class: 'muted small' }, 'En la hoja que se abre, elige “Guardar en Archivos” y una carpeta de iCloud Drive.'),
        h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn primary', onClick: async () => {
            const res = await saveFile(text, `panel-copia-${ctx.today()}.json`);
            if (res === 'cancelled') return;
            markBackupDone();
            close();
            toast(res === 'shared' ? 'Copia guardada' : 'Copia descargada', { tone: 'good' });
            ctx.rerender();
          } }, 'Guardar copia…'),
        ),
      );
    }

    body.append(form);
    return h('div', { class: 'sheet-form' },
      h('div', { class: 'sheet-head' }, h('h2', {}, 'Copia cifrada'), h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Cerrar', onClick: close }, '✕')),
      body,
    );
  }, { label: 'Hacer copia cifrada' });
}

function restoreSheet(ctx, fileText) {
  openSheet((close) => {
    const { user, pass } = passFields('current');
    const err = h('small', { class: 'error' });
    const submit = h('button', { type: 'submit', class: 'btn primary' }, 'Descifrar');
    let created = '';
    try { created = new Date(JSON.parse(fileText).createdAt).toLocaleString('es', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { /* sin fecha */ }
    const form = h('form', { class: 'sheet-form', onSubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      submit.disabled = true;
      submit.textContent = 'Descifrando…';
      try {
        const json = await decryptBackup(fileText, pass.value);
        close();
        confirmImport(ctx, json, created ? `del ${created}` : 'cifrada');
      } catch (e2) {
        err.textContent = e2.message;
        submit.disabled = false;
        submit.textContent = 'Descifrar';
        pass.select();
      }
    } },
    h('div', { class: 'sheet-head' }, h('h2', {}, 'Restaurar copia'), h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Cerrar', onClick: close }, '✕')),
    user,
    h('p', { class: 'muted small' }, created ? `Copia cifrada del ${created}. Escribe su contraseña.` : 'Escribe la contraseña de la copia.'),
    pass, err,
    h('div', { class: 'sheet-actions' }, submit),
    );
    setTimeout(() => pass.focus(), 50);
    return form;
  }, { label: 'Restaurar copia' });
}

/** Resumen de lo que contiene la copia y confirmación antes de sustituir los datos actuales. */
function confirmImport(ctx, json, label) {
  let parsed;
  try {
    parsed = JSON.parse(json);
    if (!Array.isArray(parsed?.habits)) throw new Error();
  } catch {
    toast('El archivo no parece una copia de esta app.', { tone: 'bad' });
    return;
  }
  const summary = `${parsed.habits.length} hábitos, ${parsed.finance?.transactions?.length ?? 0} movimientos y ${(parsed.study?.tasks?.length ?? 0) + (parsed.study?.exams?.length ?? 0)} tareas y exámenes`;
  if (!confirm(`Copia ${label}: ${summary}.\n\nSustituirá los datos actuales de este dispositivo (podrás deshacerlo justo después). ¿Continuar?`)) return;
  try {
    ctx.store.importJson(json);
    toast(`Copia restaurada: ${summary}`, { tone: 'good', action: 'Deshacer', onAction: () => ctx.store.undo(), timeout: 8000 });
  } catch (e) {
    toast(`No se pudo restaurar: ${e.message}`, { tone: 'bad' });
  }
}


// ── Sincronización automática con Supabase (src/sync.js)

function ago(iso) {
  if (!iso) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60_000));
  return min < 1 ? 'ahora mismo' : min < 60 ? `hace ${min} min` : min < 1440 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} d`;
}

function syncCard(ctx) {
  const sync = ctx.sync;
  const st = sync.status();
  const on = sync.enabled();
  const conflict = st.state === 'conflict' ? st.conflict : null;
  return h('div', { class: `card backup-card ${conflict || st.state === 'error' ? 'overdue' : ''}` },
    h('h2', {}, 'Sincronización'),
    !on ? h('p', { class: 'muted small' }, 'Guarda tus datos en tu propio proyecto de Supabase y compártelos entre dispositivos, sin copias a mano. Se cifran aquí antes de subirse: el servidor solo ve texto ilegible.') : null,
    on ? h('p', { class: `backup-status ${st.state === 'error' || conflict ? 'warn' : 'pos'}` },
      st.state === 'syncing' ? 'Sincronizando…'
        : conflict ? 'Hay un conflicto que resolver'
          : st.state === 'error' ? 'No se pudo sincronizar'
            : st.dirty ? 'Cambios pendientes de subir' : `✓ Sincronizado ${ago(st.lastSyncAt)}`) : null,
    on ? h('p', { class: 'muted small' }, st.email) : null,
    st.message ? h('p', { class: `small ${st.state === 'error' ? 'error' : 'muted'}` }, st.message) : null,
    conflict ? h('div', { class: 'sheet-form' },
      h('p', { class: 'small' }, `Este dispositivo: ${summaryText(conflict.local)}.`),
      h('p', { class: 'small' }, `Nube (${ago(conflict.remoteAt)}): ${summaryText(conflict.remote)}.`),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: async () => {
          if (confirm('Se subirá la versión de este dispositivo y se sustituirá la de la nube. ¿Continuar?')) await sync.resolve('local');
        } }, 'Quedarme con este dispositivo'),
        h('button', { class: 'btn ghost', onClick: async () => {
          if (confirm('Se descargará la versión de la nube y se sustituirán los datos de este dispositivo. ¿Continuar?')) await sync.resolve('remote');
        } }, 'Quedarme con la nube'),
      )) : null,
    h('div', { class: 'actions' },
      on ? h('button', { class: 'btn ghost', disabled: st.state === 'syncing', onClick: () => sync.syncNow() }, 'Sincronizar ahora') : null,
      on ? h('button', { class: 'btn ghost', onClick: () => {
        if (confirm('Dejará de sincronizar en este dispositivo. Tus datos aquí y en la nube se conservan. ¿Cerrar sesión?')) sync.signOut();
      } }, 'Cerrar sesión') : null,
      !on ? h('button', { class: 'btn primary', disabled: !cryptoAvailable(), onClick: () => syncSheet(ctx) }, 'Conectar con Supabase') : null,
    ),
    !on && !cryptoAvailable() ? h('p', { class: 'error small' }, 'El cifrado solo funciona en la web publicada (HTTPS) o en localhost.') : null,
  );
}

function syncSheet(ctx) {
  openSheet((close) => {
    const st = ctx.sync.status();
    const field = (label, attrs) => h('label', { class: 'field' }, h('span', { class: 'small muted' }, label), h('input', attrs));
    const url = field('URL del proyecto', { type: 'url', placeholder: 'https://xxxx.supabase.co', value: st.url || '', required: true, autocomplete: 'off', autocapitalize: 'off' });
    const key = field('Clave pública (anon)', { type: 'text', placeholder: 'eyJ… o sb_publishable_…', value: st.key || '', required: true, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const email = field('Correo de tu cuenta', { type: 'email', name: 'username', autocomplete: 'username', value: st.email || '', required: true });
    const pass = field('Contraseña de la cuenta', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
    const secret = field(`Contraseña de cifrado (mín. ${MIN_PASSPHRASE})`, { type: 'password', autocomplete: 'new-password', minlength: MIN_PASSPHRASE, required: true });
    const err = h('small', { class: 'error' });
    let creating = false;
    const submit = h('button', { type: 'submit', class: 'btn primary' }, 'Entrar y sincronizar');
    const create = h('button', { type: 'submit', class: 'btn ghost', onClick: () => { creating = true; } }, 'Crear cuenta');
    const form = h('form', { class: 'sheet-form', onSubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      submit.disabled = create.disabled = true;
      submit.textContent = 'Conectando…';
      try {
        await ctx.sync.signIn({
          url: url.querySelector('input').value, key: key.querySelector('input').value,
          email: email.querySelector('input').value, password: pass.querySelector('input').value,
          passphrase: secret.querySelector('input').value, create: creating,
        });
        close();
        toast(ctx.sync.status().state === 'conflict' ? 'Conectado: hay un conflicto que resolver' : 'Sincronización activada', { tone: 'good' });
        ctx.rerender();
      } catch (e2) {
        err.textContent = e2.message;
        submit.disabled = create.disabled = false;
        submit.textContent = 'Entrar y sincronizar';
      }
      creating = false;
    } },
    h('div', { class: 'sheet-head' }, h('h2', {}, 'Conectar con Supabase'), h('button', { type: 'button', class: 'icon-btn small', 'aria-label': 'Cerrar', onClick: close }, '✕')),
    h('p', { class: 'muted small' }, 'Crea un proyecto gratuito en supabase.com, ejecuta supabase/schema.sql en su SQL Editor y copia aquí la URL y la clave pública (anon) de Project Settings → API.'),
    url, key, email, pass, secret,
    h('p', { class: 'muted small' }, 'La contraseña de cifrado protege tus datos: se queda en tus dispositivos y no se puede recuperar. Usa la misma en todos.'),
    err,
    h('div', { class: 'sheet-actions' }, submit, create),
    );
    return form;
  }, { label: 'Conectar con Supabase' });
}
