import { AI_MODELS } from '../../inbox/ai.js';
import { GMAIL_SCOPE, redirectUri, startGmailAuth } from '../../inbox/gmail.js';
import { connectDemo, disconnectInbox, inboxConfig, saveInboxConfig } from '../../inbox/state.js';
import { h, toast } from '../dom.js';

/** Conexión: Gmail (guía de Google Cloud + id de cliente), resumen con IA y privacidad. */
export function inboxConnectView(state, ctx) {
  const cfg = inboxConfig();
  const uri = redirectUri();
  const origin = location.origin;
  const clientInput = h('input', { value: cfg.clientId, placeholder: '1234…apps.googleusercontent.com', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'ID de cliente de OAuth' });
  const keyInput = h('input', { type: 'password', value: cfg.aiKey, placeholder: 'sk-ant-…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Clave de API de Claude' });
  const modelSelect = h('select', { 'aria-label': 'Modelo' }, AI_MODELS.map((m) => h('option', { value: m.id, selected: m.id === cfg.aiModel }, m.label)));
  const copy = (text) => navigator.clipboard?.writeText(text).then(() => toast('Copiado'), () => toast('No se pudo copiar'));
  const secure = window.isSecureContext;

  return h('section', { class: 'view inbox' },
    h('h1', {}, 'Conexión'),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Gmail'),
        cfg.mode === 'gmail' ? h('span', { class: 'tag up' }, '✓ Conectado') : cfg.mode === 'demo' ? h('span', { class: 'tag' }, 'Ejemplo') : null),
      cfg.mode === 'gmail' && cfg.account ? h('p', { class: 'muted small' }, `Cuenta: ${cfg.account}. Google pide volver a entrar cada hora; al pulsar Actualizar te lleva y te devuelve aquí.`) : null,
      h('details', { class: 'guide', open: !cfg.clientId },
        h('summary', {}, 'Cómo obtener tu ID de cliente (una vez, ~10 min)'),
        h('ol', {},
          h('li', {}, 'Abre ', h('a', { href: 'https://console.cloud.google.com/projectcreate', target: '_blank', rel: 'noopener' }, 'Google Cloud Console'), ' y crea un proyecto (p. ej. “Panel”).'),
          h('li', {}, 'En “APIs y servicios → Biblioteca”, busca ', h('b', {}, 'Gmail API'), ' y pulsa Habilitar.'),
          h('li', {}, 'En “Google Auth Platform” (pantalla de consentimiento OAuth): tipo ', h('b', {}, 'Externo'), ', tu correo como contacto, y en “Público” añade tu cuenta de Gmail como ', h('b', {}, 'usuario de prueba'), '. En “Acceso a los datos” añade el permiso ', h('code', {}, 'gmail.readonly'), '.'),
          h('li', {}, 'En “Clientes”, crea un ', h('b', {}, 'ID de cliente de OAuth'), ' de tipo ', h('b', {}, 'Aplicación web'), ' con:',
            h('div', { class: 'copy-row' }, h('small', { class: 'muted' }, 'Origen autorizado'), h('code', {}, origin), h('button', { type: 'button', class: 'btn ghost small', onClick: () => copy(origin) }, 'Copiar')),
            h('div', { class: 'copy-row' }, h('small', { class: 'muted' }, 'URI de redirección'), h('code', {}, uri), h('button', { type: 'button', class: 'btn ghost small', onClick: () => copy(uri) }, 'Copiar')),
            h('small', { class: 'muted' }, 'Si usas la app en otra dirección (localhost y la web publicada), añade las dos.')),
          h('li', {}, 'Copia el ID de cliente (acaba en .apps.googleusercontent.com) y pégalo aquí abajo.'),
        ),
        h('p', { class: 'muted small' }, 'Mientras la app esté “en pruebas” en Google, solo las cuentas que añadas como usuario de prueba pueden conectarse. Es lo correcto para un uso personal.'),
      ),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'ID de cliente de OAuth'), clientInput),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Correos a leer'),
        h('select', { onChange: (e) => saveInboxConfig({ days: Number(e.target.value) }) },
          [[1, 'Último día'], [3, 'Últimos 3 días'], [7, 'Última semana']].map(([v, l]) => h('option', { value: v, selected: cfg.days === v }, l)))),
      !secure ? h('p', { class: 'error small' }, 'Google solo permite conectar desde HTTPS o localhost.') : null,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', disabled: !secure, onClick: () => {
          const id = clientInput.value.trim();
          if (!/\.apps\.googleusercontent\.com$/.test(id)) { toast('Ese no parece un ID de cliente de Google (acaba en .apps.googleusercontent.com).', { tone: 'bad' }); return; }
          saveInboxConfig({ clientId: id, mode: 'gmail' });
          startGmailAuth(id, cfg.account);
        } }, cfg.mode === 'gmail' ? 'Volver a conectar' : 'Conectar Gmail'),
        cfg.mode ? h('button', { class: 'btn danger', onClick: () => { disconnectInbox(); toast('Correo desconectado y caché borrada'); ctx.go('#/correo'); } }, 'Desconectar') : null,
        cfg.mode !== 'demo' ? h('button', { class: 'btn ghost', onClick: () => { connectDemo(); ctx.refreshInbox(); ctx.go('#/correo'); } }, 'Usar correos de ejemplo') : null,
      ),
      h('p', { class: 'muted small' }, `Permiso pedido: ${GMAIL_SCOPE.split('/').pop()} (solo lectura). Se leen remitente, asunto, fecha y el extracto de cada correo; nunca el cuerpo completo ni los adjuntos.`),
    ),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Outlook'), h('span', { class: 'tag' }, 'Próximamente')),
      h('p', { class: 'muted small' }, 'El módulo está preparado para un segundo proveedor; Outlook / Microsoft 365 será el siguiente.'),
    ),

    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Resumen con IA (opcional)'), cfg.aiKey ? h('span', { class: 'tag up' }, '✓ Activo') : null),
      h('p', { class: 'muted small' }, 'Con tu propia clave de la API de Claude, cada actualización genera un resumen escrito y una lista de tareas. Se envían a Anthropic el remitente, el asunto y el extracto de los correos (no el cuerpo). La clave se guarda solo en este dispositivo y nunca en las copias de seguridad.'),
      h('p', { class: 'muted small' }, 'Consíguela en ', h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, 'console.anthropic.com'), '. Pon un límite de gasto mensual en tu cuenta si quieres más tranquilidad.'),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Clave de API'), keyInput),
      h('label', { class: 'field' }, h('span', { class: 'label' }, 'Modelo'), modelSelect),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => {
          const key = keyInput.value.trim();
          if (key && !key.startsWith('sk-ant-')) { toast('Las claves de Claude empiezan por sk-ant-', { tone: 'bad' }); return; }
          saveInboxConfig({ aiKey: key, aiModel: modelSelect.value });
          toast(key ? 'Resumen con IA activado' : 'Resumen con IA desactivado');
          if (key) ctx.runInboxAi();
          ctx.rerender();
        } }, 'Guardar'),
        cfg.aiKey ? h('button', { class: 'btn ghost', onClick: () => { saveInboxConfig({ aiKey: '' }); toast('Clave borrada de este dispositivo'); ctx.rerender(); } }, 'Borrar clave') : null,
      ),
    ),
  );
}
