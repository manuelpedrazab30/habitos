import { disableSymbols, enableSymbols } from './symbols.js';

// Estilos visuales intercambiables. Cada tema es una hoja en themes/ con todas sus reglas
// bajo html[data-theme="…"]; el tema "classic" es styles.css sin más.
// index.html aplica el guardado antes de pintar (sin parpadeo) y acepta ?theme=ocean, etc.

export const THEME_KEY = 'panel.theme';

// symbols: sustituye los emojis por iconos de línea en el color del tema (ui/symbols.js)
export const THEMES = [
  { id: 'classic', label: 'Clásico', color: '#f5cd47', dot: '#f5cd47', symbols: true },
  { id: 'ocean', label: 'Océano', color: '#4d9bff', dot: '#4d9bff', symbols: true },
  { id: 'forest', label: 'Bosque', color: '#3fbf86', dot: '#3fbf86', symbols: true },
  { id: 'coral', label: 'Atardecer', color: '#ff7f6e', dot: '#ff7f6e', symbols: true },
  { id: 'graphite', label: 'Grafito', color: '#3b3f4a', dot: '#8b8f9a', symbols: true },
];

export const currentTheme = () => document.documentElement.dataset.theme || 'classic';

/** Al arrancar: activa los iconos si el tema guardado los usa (index.html ya puso data-theme). */
export function initTheme() {
  if (THEMES.find((t) => t.id === currentTheme())?.symbols) enableSymbols();
}

export function applyTheme(id) {
  const theme = THEMES.find((t) => t.id === id) || THEMES[0];
  document.documentElement.dataset.theme = theme.id;
  localStorage.setItem(THEME_KEY, theme.id);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.color);
  if (theme.symbols) enableSymbols();
  else disableSymbols();
}
