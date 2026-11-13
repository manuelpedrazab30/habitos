// Deslizar entre secciones (Inicio → Hábitos → Finanzas → Correo) en pantallas táctiles.
// La vista sigue al dedo mientras arrastras; al soltar, si el gesto fue claramente
// horizontal y suficientemente largo (o rápido), pasa a la sección vecina con una
// animación de entrada; si no, vuelve a su sitio.
//
// No se activa: con varios dedos, empezando en un borde de la pantalla (gesto "atrás" del
// sistema), dentro de zonas que se desplazan en horizontal o tienen su propio gesto
// (mapa de calor, pestañas de sesiones, gráficas), sobre campos de texto, ni con una hoja
// abierta. `main` lleva touch-action: pan-y para que el navegador solo haga scroll vertical.

const EDGE = 24; // px desde el borde: reservado al gesto del sistema
const DECIDE = 10; // px de movimiento para decidir si el gesto es horizontal o vertical
const DISTANCE = 0.22; // fracción del ancho para cambiar de sección…
const FLICK = 0.5; // …o velocidad en px/ms
const IGNORE = 'input, textarea, select, [contenteditable], svg, .heatmap-wrap, .session-tabs, .seg, .sheet-backdrop, [data-noswipe]';

/**
 * el: elemento a arrastrar (main). order: ids de sección en orden. current(): sección actual.
 * goTo(id, dir): navegar a esa sección (dir = 1 siguiente, -1 anterior).
 */
export function initSwipe({ el, order, current, goTo }) {
  let start = null; // { x, y, t }
  let axis = null; // 'x' | 'y'
  let dx = 0;

  const reset = (animate) => {
    el.style.transition = animate ? 'transform 0.22s ease, opacity 0.22s ease' : '';
    el.style.transform = '';
    el.style.opacity = '';
    if (animate) setTimeout(() => { el.style.transition = ''; }, 240);
  };

  el.addEventListener('touchstart', (e) => {
    start = null;
    axis = null;
    dx = 0;
    if (e.touches.length !== 1 || document.querySelector('.sheet-backdrop')) return;
    const t = e.touches[0];
    if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
    if (e.target.closest?.(IGNORE)) return;
    start = { x: t.clientX, y: t.clientY, t: performance.now() };
  }, { passive: true });

  el.addEventListener('touchmove', (e) => {
    if (!start || e.touches.length !== 1) return;
    const t = e.touches[0];
    const mx = t.clientX - start.x;
    const my = t.clientY - start.y;
    if (!axis) {
      if (Math.abs(mx) < DECIDE && Math.abs(my) < DECIDE) return;
      axis = Math.abs(mx) > Math.abs(my) * 1.3 ? 'x' : 'y';
    }
    if (axis !== 'x') return;
    const i = order.indexOf(current());
    const blocked = (mx < 0 && i >= order.length - 1) || (mx > 0 && i <= 0);
    dx = mx;
    // Resistencia en los extremos (no hay sección más allá)
    const shift = blocked ? mx * 0.15 : mx * 0.6;
    el.style.transition = '';
    el.style.transform = `translateX(${shift}px)`;
    el.style.opacity = String(1 - Math.min(0.35, Math.abs(shift) / window.innerWidth));
  }, { passive: true });

  const end = () => {
    if (!start || axis !== 'x') { start = null; return; }
    const i = order.indexOf(current());
    const dt = Math.max(1, performance.now() - start.t);
    const fast = Math.abs(dx) / dt > FLICK && Math.abs(dx) > 40;
    const far = Math.abs(dx) > window.innerWidth * DISTANCE;
    const dir = dx < 0 ? 1 : -1;
    const target = order[i + dir];
    start = null;
    if ((fast || far) && target) {
      el.style.transition = '';
      el.style.transform = '';
      el.style.opacity = '';
      goTo(target, dir);
    } else {
      reset(true);
    }
  };
  el.addEventListener('touchend', end, { passive: true });
  el.addEventListener('touchcancel', () => { start = null; reset(true); }, { passive: true });
}
