// Iconos de línea en lugar de emojis, para los temas que lo piden (THEMES[].symbols).
// En vez de tocar cada vista, un MutationObserver sustituye los emojis de los nodos de
// texto por <span class="sym"><svg>…</svg></span>, que toman el color del tema (CSS).
// Al desactivarlo, cada span vuelve a su emoji (data-emoji). Los temas sin símbolos no
// se enteran: este módulo no hace nada hasta enableSymbols().

const P = (d) => `<path d="${d}"/>`;
const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;

/** Iconos 24×24 de trazo (stroke = currentColor). */
const ICONS = {
  sparkle: P('M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18'),
  meditate: C(12, 5, 2) + P('M12 7.5v5M7 11l5 1.5 5-1.5M4.5 18c2.2-2 4.5-3 7.5-3s5.3 1 7.5 3M8 19.5h8'),
  book: P('M4 4.5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 4.5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z'),
  dumbbell: P('M6.5 7.5v9M17.5 7.5v9M3.5 10v4M20.5 10v4M6.5 12h11'),
  drop: P('M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z'),
  scale: P('M12 3.5v17M7 20.5h10M4.5 7h15M4.5 7L2 12.5a2.5 2.5 0 0 0 5 0zM19.5 7L17 12.5a2.5 2.5 0 0 0 5 0z'),
  run: P('M3 12h4l3-7.5 4 15 3-7.5h4'),
  leaf: P('M5 19c0-8 6-14 15-14 0 9-6 15-14 15zM5 19l8-8'),
  moon: P('M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'),
  pen: P('M4 20h4L19 9l-4-4L4 16zM14 6l4 4'),
  music: P('M9 18V5.5l11-2v12.5') + C(6, 18, 3) + C(17, 16, 3),
  laptop: P('M5 5h14v10H5zM2.5 19h19'),
  noSmoke: C(12, 12, 9) + P('M5.6 5.6l12.8 12.8M7 12.5h6'),
  cpu: P('M7 7h10v10H7zM10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5'),
  bike: C(6, 16, 3.5) + C(18, 16, 3.5) + P('M6 16l4-7h5l3 7M10 9l2 7M13 6h3'),
  coin: C(12, 12, 8.5) + P('M14.5 9.5c-.4-1-1.3-1.6-2.5-1.6-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.2 0-2.1-.6-2.5-1.6M12 6.5V8M12 16v1.5'),
  cart: P('M3 4h2l2.4 11h11l2-8H6.2') + C(9, 19.5, 1.5) + C(17, 19.5, 1.5),
  dining: P('M5.5 3v6a2 2 0 0 0 4 0V3M7.5 11v10M16 21V3c2.5 1 3.5 4 3.5 7.5H16'),
  car: P('M3 13l2.2-6h13.6L21 13v5H3zM3 13h18M6.5 18v2M17.5 18v2') + C(7.5, 15.5, 1) + C(16.5, 15.5, 1),
  home: P('M3 11l9-7 9 7M5.5 9.5V20h13V9.5M10 20v-6h4v6'),
  bulb: P('M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z'),
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/>' + P('M11 18.5h2'),
  star: P('M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z'),
  bag: P('M5 8h14l-1 13H6zM9 8V6.5a3 3 0 0 1 6 0V8'),
  heart: P('M12 20s-7.5-4.6-9-9.2C2 7.6 4.2 5 7 5c2 0 3.3 1.1 5 3 1.7-1.9 3-3 5-3 2.8 0 5 2.6 4 5.8-1.5 4.6-9 9.2-9 9.2z'),
  box: P('M3 7.5L12 3l9 4.5v9L12 21l-9-4.5zM3 7.5l9 4.5 9-4.5M12 12v9'),
  question: C(12, 12, 9) + P('M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01'),
  plane: P('M21 3L3 10.5l7 2.5 2.5 7zM10 13l5-5'),
  paw: C(7, 9, 1.7) + C(12, 6.5, 1.7) + C(17, 9, 1.7) + P('M8 16.5c0-2.5 2-4.5 4-4.5s4 2 4 4.5c0 1.8-1.5 2.5-4 2.5s-4-.7-4-2.5z'),
  gift: P('M4 10h16v11H4zM3 7h18v3H3zM12 7v14M12 7c-1-3-5-4-5-1.5S10 7 12 7zM12 7c1-3 5-4 5-1.5S14 7 12 7z'),
  cup: P('M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1.5a2.5 2.5 0 0 1 0 5H17M8.5 3.5c0 1.5 1 1.5 1 3M12.5 3.5c0 1.5 1 1.5 1 3'),
  fuel: P('M5 21V4h9v17M3 21h13M5 10h9M14 8l3 3v7a1.5 1.5 0 0 0 3 0V9l-3-3'),
  smile: C(12, 12, 9) + P('M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01'),
  bank: P('M3 9.5l9-6 9 6M5 9.5v8M9.5 9.5v8M14.5 9.5v8M19 9.5v8M3 20h18'),
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/>' + P('M2.5 10h19M6 15h4'),
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/>' + C(12, 12, 2.5) + P('M6 9.5v.01M18 14.5v.01'),
  savings: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/>' + P('M5 6v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6'),
  chartUp: P('M3 20h18M5 16l5-5 3 3 6-7M15 7h4v4'),
  wallet: P('M3 7a2 2 0 0 1 2-2h12v4M3 7v11a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14.5h.01'),
  globe: C(12, 12, 9) + P('M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18'),
  flame: P('M12 21c4 0 7-2.8 7-6.8 0-3-1.8-5.3-3.5-6.9.2 2-1 3.5-2.2 3.5C14 7.5 12 4.5 9.5 3c.5 3-1.5 5-3 7A7 7 0 0 0 5 14.2C5 18.2 8 21 12 21z'),
  pin: P('M9 3h6l-1 6 3 3H7l3-3zM12 12v9'),
  gear: C(12, 12, 3) + P('M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1'),
  pencil: P('M4 20l1-5L16 4l4 4L9 19zM14 6l4 4'),
  share: P('M12 15V3.5M7.5 8L12 3.5 16.5 8M5 12v8h14v-8'),
  target: C(12, 12, 9) + C(12, 12, 5) + C(12, 12, 1),
  clock: C(12, 12, 9) + P('M12 7v5l3 2'),
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/>' + P('M3.5 10h17M8 3v4M16 3v4'),
  trophy: P('M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z'),
  water: P('M3 15c2 0 2-1.5 4.5-1.5S9.5 15 12 15s2-1.5 4.5-1.5S18.5 15 21 15M3 19c2 0 2-1.5 4.5-1.5S9.5 19 12 19s2-1.5 4.5-1.5S18.5 19 21 19') + P('M12 3s3.5 3.8 3.5 6.5a3.5 3.5 0 0 1-7 0C8.5 6.8 12 3 12 3z'),
  plus: P('M12 5v14M5 12h14'),
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/>' + P('M3.5 6.5L12 13l8.5-6.5'),
};

/** Emoji (sin selector de variante ni tono de piel) → icono. */
const MAP = {
  '✨': 'sparkle', '🧘': 'meditate', '📚': 'book', '📖': 'book', '🏋': 'dumbbell', '💪': 'dumbbell', '💧': 'drop', '🚰': 'water',
  '⚖': 'scale', '🏃': 'run', '🥗': 'leaf', '🌱': 'leaf', '😴': 'moon', '🌙': 'moon', '✍': 'pen', '📝': 'pen', '🎸': 'music', '🎵': 'music',
  '💻': 'laptop', '🚭': 'noSmoke', '🧠': 'cpu', '🚴': 'bike', '💰': 'coin', '🪙': 'coin', '🛒': 'cart', '🍽': 'dining', '🍴': 'dining',
  '🚗': 'car', '🚙': 'car', '🏠': 'home', '🏡': 'home', '💡': 'bulb', '📱': 'phone', '🎉': 'star', '⭐': 'star', '🛍': 'bag',
  '❤': 'heart', '💖': 'heart', '📦': 'box', '❔': 'question', '❓': 'question', '✈': 'plane', '🐾': 'paw', '🎁': 'gift', '☕': 'cup',
  '⛽': 'fuel', '👶': 'smile', '🙂': 'smile', '🏦': 'bank', '💳': 'card', '💵': 'cash', '💶': 'cash', '🐷': 'savings', '📈': 'chartUp',
  '👛': 'wallet', '🌍': 'globe', '🌎': 'globe', '🔥': 'flame', '📌': 'pin', '⚙': 'gear', '✎': 'pencil', '✏': 'pencil', '⬆': 'share',
  '🎯': 'target', '⏰': 'clock', '⏱': 'clock', '📅': 'calendar', '🏆': 'trophy', '➕': 'plus', '\u2709': 'mail', '📧': 'mail', '📨': 'mail',
};

// Clave del mapa: primer carácter, sin selector de variante ni tono de piel
const clean = (s) => [...s.replace(/\uFE0F|[\u{1F3FB}-\u{1F3FF}]/gu, '')][0];
const RE = /(?:\p{Extended_Pictographic}|\u270E)(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}]|\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;
// Para comprobar si hay emoji: SIN la bandera g (un test() con g deja lastIndex movido y
// matchAll empezaría después del primer emoji → el observer entraría en bucle)
const HAS = /\p{Extended_Pictographic}|\u270E/u;
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SVG', 'svg', 'text', 'title', 'tspan']);

function symbolFor(emoji) {
  const span = document.createElement('span');
  span.className = 'sym';
  span.dataset.emoji = emoji;
  span.setAttribute('aria-hidden', 'true');
  const icon = ICONS[MAP[clean(emoji)]];
  if (icon) span.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${icon}</svg>`;
  else { span.classList.add('sym-fallback'); span.textContent = emoji; }
  return span;
}

function replaceIn(textNode) {
  const text = textNode.nodeValue;
  if (!HAS.test(text)) return;
  const parent = textNode.parentNode;
  if (!parent || parent.closest?.('.sym')) return;
  // <option> no admite HTML: ahí el emoji simplemente se quita
  if (parent.nodeName === 'OPTION') { textNode.nodeValue = text.replace(RE, '').replace(/^\s+/, ''); return; }
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(RE)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    frag.append(symbolFor(m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.append(text.slice(last));
  parent.replaceChild(frag, textNode);
}

function process(root) {
  if (root.nodeType === Node.TEXT_NODE) { if (!SKIP.has(root.parentNode?.nodeName)) replaceIn(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE || SKIP.has(root.nodeName) || root.closest?.('svg')) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (SKIP.has(n.parentNode?.nodeName) || n.parentNode?.closest?.('svg, .sym') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(replaceIn);
}

const observer = new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === 'characterData') process(r.target);
    else r.addedNodes.forEach(process);
  }
});

let active = false;
export function enableSymbols() {
  if (active) return;
  active = true;
  process(document.body);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

export function disableSymbols() {
  if (!active) return;
  active = false;
  observer.disconnect();
  document.querySelectorAll('.sym[data-emoji]').forEach((s) => s.replaceWith(document.createTextNode(s.dataset.emoji)));
}
