// Confeti ligero en un <canvas> temporal sobre toda la pantalla.
// Se elimina solo al terminar; respeta prefers-reduced-motion.

const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444'];
const COUNT = 70;
const GRAVITY = 0.35;
const DRAG = 0.985;
const DURATION = 1600; // ms

/**
 * Lanza confeti desde el centro de `origin` (elemento) o, si no hay, desde la parte
 * superior de la pantalla. `color` añade el color del hábito a la paleta.
 */
export function confetti({ origin = null, color = null } = {}) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '60' });
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  document.body.append(canvas);
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);

  const r = origin?.getBoundingClientRect();
  const visible = r && r.bottom > 0 && r.top < H;
  const x0 = visible ? r.left + r.width / 2 : W / 2;
  const y0 = visible ? r.top + r.height / 2 : H * 0.3;
  const colors = color ? [color, color, ...PALETTE] : PALETTE;

  const parts = Array.from({ length: COUNT }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9; // abanico hacia arriba
    const speed = 7 + Math.random() * 8;
    return {
      x: x0, y: y0,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 5 + Math.random() * 5,
      h: 3 + Math.random() * 4,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)],
    };
  });

  const start = performance.now();
  let last = start;
  function frame(now) {
    const t = now - start;
    const k = Math.min((now - last) / 16.7, 3); // independiente de la tasa de refresco
    last = now;
    g.clearRect(0, 0, W, H);
    g.globalAlpha = Math.max(0, 1 - Math.max(0, t - DURATION * 0.6) / (DURATION * 0.4));
    for (const p of parts) {
      p.vx *= DRAG ** k;
      p.vy = p.vy * DRAG ** k + GRAVITY * k;
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.rot += p.vr * k;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.scale(1, Math.cos(p.rot * 2)); // efecto de giro del papel
      g.fillStyle = p.color;
      g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    if (t < DURATION) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
