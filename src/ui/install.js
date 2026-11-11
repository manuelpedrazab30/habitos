import { h } from './dom.js';

// iOS no tiene botón "Instalar": hay que hacerlo desde Compartir → Añadir a pantalla de inicio.
// Mostramos cómo hacerlo, solo en Safari de iPhone/iPad y si la app aún no está instalada.

const DISMISS_KEY = 'habitos.installHintDismissed';

export const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

const steps = () => [
  'Toca ', h('span', { class: 'share-glyph', 'aria-label': 'Compartir' }, '⬆︎'), ' (Compartir) en Safari y luego ', h('b', {}, 'Añadir a pantalla de inicio'), '.',
];

/** Aviso descartable para la vista Hoy. */
export function installHint(ctx) {
  if (!isIOS() || isStandalone() || localStorage.getItem(DISMISS_KEY)) return null;
  return h('div', { class: 'card install-hint' },
    h('img', { src: 'icons/icon-180.png', alt: '' }),
    h('div', {},
      h('strong', {}, 'Tenla en tu pantalla de inicio'),
      h('p', { class: 'muted small' }, steps()),
    ),
    h('button', { class: 'close', 'aria-label': 'Ocultar', onClick: () => { localStorage.setItem(DISMISS_KEY, '1'); ctx.rerender(); } }, '✕'),
  );
}

/** Tarjeta fija para Ajustes. */
export function installCard() {
  if (isStandalone()) return null;
  return h('div', { class: 'card' },
    h('h2', {}, 'Añadir a la pantalla de inicio'),
    h('p', { class: 'muted' }, 'En iPhone: ', steps(), ' Se abrirá a pantalla completa, como una app.'),
    h('p', { class: 'muted small' }, 'Los datos de la app instalada son independientes de los de Safari: si ya tenías registros, expórtalos aquí e impórtalos dentro de la app.'),
  );
}
