import { addDays, diffDays, formatDate, fromKey, weekStart, WEEKDAYS_SHORT } from '../domain/dates.js';
import { fmt } from '../domain/messages.js';
import { h, hideTip, s, showTip } from './dom.js';

// Gráficas SVG hechas a mano (sin dependencias). Todas son responsivas vía viewBox
// y comparten el tooltip de dom.js.

/**
 * Ancho del viewBox = ancho real disponible (≤ 640). Así el texto de 10–11 px se ve a ese
 * tamaño también en el móvil en lugar de encogerse. app.js re-renderiza al cambiar el ancho.
 */
export function chartWidth() {
  const main = document.getElementById('view');
  const avail = (main?.clientWidth || window.innerWidth) - 62; // padding de main + tarjeta
  return Math.round(Math.max(280, Math.min(640, avail)));
}

const tipAt = (e, html) => {
  const p = e.touches?.[0] || e;
  showTip(html, p.clientX, p.clientY);
};

/** Mapa de calor tipo calendario: columnas = semanas, filas = lunes…domingo. */
export function heatmap({ from, to, value, label, color, onSelect, today }) {
  const cell = 13;
  const gap = 3;
  const left = 18;
  const top = 16;
  const start = weekStart(from);
  const cols = Math.ceil((diffDays(start, to) + 1) / 7);
  const W = left + cols * (cell + gap);
  const H = top + 7 * (cell + gap);
  // Tamaño natural ×1.4, se encoge hasta el ancho disponible pero nunca por debajo de 1× (si no cabe, scroll horizontal)
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'heatmap', role: 'img', 'aria-label': 'Mapa de calor de cumplimiento',
    style: { width: `${W * 1.4}px`, maxWidth: '100%', minWidth: `${W}px` },
  });

  [0, 2, 4].forEach((r) => svg.append(s('text', { x: 0, y: top + r * (cell + gap) + cell - 2, class: 'axis' }, WEEKDAYS_SHORT[r])));

  let lastMonth = -1;
  for (let c = 0; c < cols; c++) {
    const colStart = addDays(start, c * 7);
    const sunday = fromKey(addDays(colStart, 6));
    // Etiqueta de mes en la primera semana cuyo domingo cae en un mes nuevo
    if (sunday.getMonth() !== lastMonth) {
      if (c < cols - 2) svg.append(s('text', { x: left + c * (cell + gap), y: 10, class: 'axis' }, sunday.toLocaleDateString('es', { month: 'short' })));
      lastMonth = sunday.getMonth();
    }
    for (let r = 0; r < 7; r++) {
      const key = addDays(colStart, r);
      if (key < from || key > to) continue;
      const v = value(key);
      const rect = s('rect', {
        x: left + c * (cell + gap),
        y: top + r * (cell + gap),
        width: cell,
        height: cell,
        rx: 3,
        class: `cell ${v === null ? 'none' : v === 0 ? 'zero' : ''} ${key === today ? 'today' : ''}`,
        style: v ? { fill: color, fillOpacity: 0.25 + 0.75 * v } : null, // inline: el CSS de .cell ganaría a un atributo
        tabindex: onSelect ? 0 : null,
      });
      rect.addEventListener('mouseenter', (e) => tipAt(e, label(key, v)));
      rect.addEventListener('mousemove', (e) => tipAt(e, label(key, v)));
      rect.addEventListener('mouseleave', hideTip);
      if (onSelect) {
        rect.style.cursor = 'pointer';
        rect.addEventListener('click', (e) => { hideTip(); onSelect(key, e); });
        rect.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(key, e); } });
      }
      svg.append(rect);
    }
  }
  const wrap = h('div', { class: 'heatmap-wrap' }, svg);
  requestAnimationFrame(() => { wrap.scrollLeft = wrap.scrollWidth; }); // lo más reciente a la vista
  return wrap;
}

/**
 * Línea de evolución de una medida con objetivo, plazo y proyección.
 * points: [{key, value}] · projection: {fromKey, fromValue, toKey, toValue} | null
 */
export function lineChart({ points, goal = null, projection = null, deadline = null, unit = '', color, from, to }) {
  const W = chartWidth();
  const H = 260;
  const pad = { l: 44, r: 16, t: 16, b: 28 };
  const span = Math.max(1, diffDays(from, to));
  const x = (k) => pad.l + (diffDays(from, k) / span) * (W - pad.l - pad.r);
  const vals = points.map((p) => p.value);
  if (goal !== null) vals.push(goal);
  if (projection) vals.push(projection.toValue);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const margin = (hi - lo) * 0.12;
  lo -= margin;
  hi += margin;
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Evolución de la medida' });

  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    svg.append(
      s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' }),
      s('text', { x: pad.l - 6, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' }, fmt(v)),
    );
  }
  const ticks = W < 420 ? 3 : 5;
  for (let i = 0; i <= ticks; i++) {
    const k = addDays(from, Math.round((span * i) / ticks));
    svg.append(s('text', { x: x(k), y: H - 8, class: 'axis', 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle' }, formatDate(k)));
  }

  if (goal !== null) {
    svg.append(
      s('line', { x1: pad.l, x2: W - pad.r, y1: y(goal), y2: y(goal), class: 'goal-line' }),
      s('text', { x: W - pad.r, y: y(goal) - 6, class: 'axis goal-label', 'text-anchor': 'end' }, `Objetivo ${fmt(goal)} ${unit}`),
    );
  }
  if (deadline && deadline >= from && deadline <= to) {
    svg.append(
      s('line', { x1: x(deadline), x2: x(deadline), y1: pad.t, y2: H - pad.b, class: 'deadline-line' }),
      s('text', { x: x(deadline) - 4, y: pad.t + 10, class: 'axis', 'text-anchor': 'end' }, 'Plazo'),
    );
  }
  if (projection) {
    svg.append(s('line', { x1: x(projection.fromKey), y1: y(projection.fromValue), x2: x(projection.toKey), y2: y(projection.toValue), class: 'projection', stroke: color }));
  }
  if (points.length) {
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.key).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    svg.append(s('path', { d, class: 'line', stroke: color }));
    points.forEach((p) => svg.append(s('circle', { cx: x(p.key), cy: y(p.value), r: 3.5, fill: color, class: 'dot' })));
  }

  // Interacción: punto más cercano al cursor
  const cross = s('line', { y1: pad.t, y2: H - pad.b, class: 'crosshair', visibility: 'hidden' });
  const focus = s('circle', { r: 6, fill: 'none', stroke: color, 'stroke-width': 2, visibility: 'hidden' });
  svg.append(cross, focus);
  const overlay = s('rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: 'transparent' });
  const move = (e) => {
    if (!points.length) return;
    const r = svg.getBoundingClientRect();
    const cx = (((e.touches?.[0] || e).clientX - r.left) / r.width) * W;
    const p = points.reduce((a, b) => (Math.abs(x(b.key) - cx) < Math.abs(x(a.key) - cx) ? b : a));
    cross.setAttribute('x1', x(p.key));
    cross.setAttribute('x2', x(p.key));
    focus.setAttribute('cx', x(p.key));
    focus.setAttribute('cy', y(p.value));
    cross.setAttribute('visibility', 'visible');
    focus.setAttribute('visibility', 'visible');
    const prev = points[points.indexOf(p) - 1];
    const delta = prev ? ` <span class="muted">(${p.value - prev.value > 0 ? '+' : ''}${fmt(p.value - prev.value)})</span>` : '';
    tipAt(e, `<b>${fmt(p.value)} ${unit}</b>${delta}<br>${formatDate(p.key, { weekday: 'short', day: 'numeric', month: 'short' })}`);
  };
  const leave = () => { cross.setAttribute('visibility', 'hidden'); focus.setAttribute('visibility', 'hidden'); hideTip(); };
  overlay.addEventListener('mousemove', move);
  overlay.addEventListener('touchstart', move, { passive: true });
  overlay.addEventListener('touchmove', move, { passive: true });
  overlay.addEventListener('mouseleave', leave);
  overlay.addEventListener('touchend', leave);
  svg.append(overlay);
  return svg;
}

/** Barras verticales simples. bars: [{label, value, tip, highlight}] */
export function barChart({ bars, color, goal = null, format = fmt, height = 180, max = null }) {
  const W = chartWidth();
  const H = height;
  const pad = { l: 8, r: 8, t: 18, b: 24 };
  const top = Math.max(max ?? 0, goal ?? 0, ...bars.map((b) => b.value), 1);
  const bw = (W - pad.l - pad.r) / bars.length;
  const y = (v) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Gráfica de barras' });
  bars.forEach((b, i) => {
    const bx = pad.l + i * bw + bw * 0.18;
    const g = s('g', { class: `bar ${b.highlight ? 'highlight' : ''}` },
      s('rect', { x: bx, y: y(b.value), width: bw * 0.64, height: Math.max(0, H - pad.b - y(b.value)), rx: 4, style: { fill: b.highlight ? 'var(--warn)' : color } }),
      s('text', { x: bx + bw * 0.32, y: H - 8, class: 'axis', 'text-anchor': 'middle' }, b.label),
      b.value && bw >= 22 ? s('text', { x: bx + bw * 0.32, y: y(b.value) - 4, class: 'axis value', 'text-anchor': 'middle' }, format(b.value)) : null,
      s('rect', { x: pad.l + i * bw, y: pad.t, width: bw, height: H - pad.t - pad.b, fill: 'transparent' }),
    );
    if (b.tip) {
      g.addEventListener('touchstart', (e) => tipAt(e, b.tip), { passive: true });
      g.addEventListener('mousemove', (e) => tipAt(e, b.tip));
      g.addEventListener('mouseleave', hideTip);
    }
    svg.append(g);
  });
  if (goal !== null) svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(goal), y2: y(goal), class: 'goal-line' }));
  return svg;
}

/** Anillo de progreso (0..1). */
export function ring(fraction, { size = 56, stroke = 6, color = 'var(--accent)', label = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return s('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'ring' },
    s('circle', { cx: size / 2, cy: size / 2, r, class: 'ring-bg', 'stroke-width': stroke, fill: 'none' }),
    s('circle', {
      cx: size / 2, cy: size / 2, r, fill: 'none', style: { stroke: color }, 'stroke-width': stroke, 'stroke-linecap': 'round',
      'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - Math.min(1, Math.max(0, fraction))),
      transform: `rotate(-90 ${size / 2} ${size / 2})`, class: 'ring-fg',
    }),
    s('text', { x: '50%', y: '50%', 'dominant-baseline': 'central', 'text-anchor': 'middle', class: 'ring-label' }, label),
  );
}
