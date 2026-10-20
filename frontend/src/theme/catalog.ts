import catalog from './catalog.json';

export type Theme = keyof typeof catalog.themes;
export type ColorMode = 'light' | 'dark';
export const DEFAULT_THEME = catalog.defaultTheme as Theme;
export const THEME_STORAGE_KEY = catalog.storageKey;
export const THEMES = Object.entries(catalog.themes).map(([id, definition]) => ({ ...definition, id: id as Theme }));

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(catalog.themes, value);
}

export function themeMode(theme: Theme): ColorMode {
  return catalog.themes[theme].mode === 'dark' ? 'dark' : 'light';
}

export function themeTokens(theme: Theme): Record<string, string> {
  return { ...catalog.common, ...catalog.modes.light, ...catalog.modes[themeMode(theme)], ...catalog.themes[theme].tokens };
}

export function themePreview(theme: Theme): Record<string, string> {
  const tokens = themeTokens(theme);
  return {
    '--preview-accent': tokens['--accent'], '--preview-card': tokens['--bg-card'],
    '--preview-line': tokens['--border'], '--preview-bg': tokens['--bg-page-gradient'],
  };
}

/** Used by Vite for both development and the production HTML. */
export function renderThemeStyles(): string {
  const defaults = themeTokens(DEFAULT_THEME);
  const declarations = (tokens: Record<string, string>) => Object.entries(tokens).map(([key, value]) => `${key}:${value};`).join('');
  return `:root{${declarations(defaults)}color-scheme:${themeMode(DEFAULT_THEME)};background-color:var(--bg-main);color:var(--text-main);}` + THEMES.map(({ id }) => {
    const differences = Object.fromEntries(Object.entries(themeTokens(id)).filter(([key, value]) => value !== defaults[key]));
    return `:root[data-theme="${id}"]{${declarations(differences)}color-scheme:${themeMode(id)};}`;
  }).join('');
}
