import { disableSymbols, enableSymbols } from './symbols.js';

// Estilos visuales intercambiables. Cada tema es una hoja en themes/ con todas sus reglas
// bajo html[data-theme="…"]; el tema "classic" es styles.css sin más.
// index.html aplica el guardado antes de pintar (sin parpadeo) y acepta ?theme=hud.

export const THEME_KEY = 'panel.theme';

// symbols: sustituye los emojis por iconos de línea en el color del tema (ui/symbols.js)
export const THEMES = [
  { id: 'classic', label: 'Clásico', color: '#f5cd47', symbols: true },
  { id: 'hud', label: 'HUD · versión A', color: '#02070c' },
  { id: 'gold', label: 'Dorado · versión B', color: '#03060c', symbols: true },
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
