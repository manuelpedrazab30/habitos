import { h, toast } from './dom.js';
import { installCard } from './install.js';
import { applyTheme, currentTheme, THEMES } from './theme.js';
import { openSheet } from './sheet.js';
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
    backupCard(state, ctx, fileInput),
    h('div', { class: 'card' },
      h('h2', {}, 'Estilo visual'),
      h('p', { class: 'muted small' }, 'Cambia el aspecto de toda la app. Tus datos no se tocan.'),
      h('div', { class: 'seg' }, THEMES.map((t) => h('button', {
        class: currentTheme() === t.id ? 'on' : '',
        onClick: () => { applyTheme(t.id); ctx.rerender(); },
      }, t.label))),
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
        h('p', {}, h('b', {}, 'Copia cifrada lista'), ` · ${kb} KB · ${st.habits.length} hábitos, ${st.finance.transactions.length} movimientos`),
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
  const summary = `${parsed.habits.length} hábitos y ${parsed.finance?.transactions?.length ?? 0} movimientos`;
  if (!confirm(`Copia ${label}: ${summary}.\n\nSustituirá los datos actuales de este dispositivo (podrás deshacerlo justo después). ¿Continuar?`)) return;
  try {
    ctx.store.importJson(json);
    toast(`Copia restaurada: ${summary}`, { tone: 'good', action: 'Deshacer', onAction: () => ctx.store.undo(), timeout: 8000 });
  } catch (e) {
    toast(`No se pudo restaurar: ${e.message}`, { tone: 'bad' });
  }
}

