import { h } from './dom.js';

/**
 * Hoja modal (desde abajo en el móvil, centrada en escritorio). Vive en <body>, fuera de
 * #view, así que los re-render de la vista no la destruyen. Se cierra con el fondo,
 * Escape o al cambiar de ruta. build(close) devuelve el contenido.
 */
export function openSheet(build, { label = 'Diálogo' } = {}) {
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', close);
    document.body.style.overflow = '';
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', close);
  sheet.append(build(close));
  backdrop.append(sheet);
  document.body.append(backdrop);
  document.body.style.overflow = 'hidden';
  return close;
}
