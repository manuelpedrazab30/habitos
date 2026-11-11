// Mini helper de DOM: h('div', { class: 'x', onClick: fn }, ...hijos). Sin framework.

const SVG_NS = 'http://www.w3.org/2000/svg';

function build(el, props, children) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val); // variables CSS
        else el.style[prop] = val;
      }
    }
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const h = (tag, props, ...children) => build(document.createElement(tag), props, children);
export const s = (tag, props, ...children) => build(document.createElementNS(SVG_NS, tag), props, children);

// Tooltip compartido por todas las gráficas
let tip;
export function showTip(html, x, y) {
  if (!tip) {
    tip = h('div', { class: 'tooltip', role: 'tooltip' });
    document.body.append(tip);
  }
  tip.innerHTML = html;
  tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2));
  const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}
export function hideTip() {
  if (tip) tip.style.display = 'none';
}

export const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Avisos breves con acción opcional (p. ej. "Deshacer")
export function toast(text, { action, onAction, timeout = 3500, tone = '' } = {}) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = h('div', { id: 'toasts', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const el = h('div', { class: `toast ${tone}` }, h('span', {}, text));
  if (action) {
    el.append(h('button', { class: 'toast-action', onClick: () => { onAction?.(); el.remove(); } }, action));
  }
  host.append(el);
  setTimeout(() => el.classList.add('out'), timeout);
  setTimeout(() => el.remove(), timeout + 300);
}
