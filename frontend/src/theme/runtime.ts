import { DEFAULT_THEME, THEME_STORAGE_KEY, THEMES, Theme, ColorMode, themeMode } from './catalog';

interface BootstrapConfig { defaultTheme: string; storageKey: string; modes: Record<string, ColorMode>; }
const bootstrapConfig: BootstrapConfig = {
  defaultTheme: DEFAULT_THEME, storageKey: THEME_STORAGE_KEY,
  modes: Object.fromEntries(THEMES.map(({ id }) => [id, themeMode(id)])),
};

// These two functions are self-contained: Vite serializes exactly the same logic
// into the HTML, so initial rendering and React never use separate whitelists.
function applyThemeState(theme: string, mode: ColorMode, doc: Document): void {
  for (const element of [doc.documentElement, doc.body]) {
    if (!element) continue;
    element.dataset.theme = theme;
    element.dataset.colorMode = mode;
    element.classList.toggle('dark', mode === 'dark');
    element.classList.toggle('light', mode === 'light');
  }
  doc.documentElement.style.colorScheme = mode;
}

function initializeTheme(config: BootstrapConfig, apply: typeof applyThemeState): string {
  let theme = config.defaultTheme;
  try {
    const saved = localStorage.getItem(config.storageKey);
    if (saved && Object.prototype.hasOwnProperty.call(config.modes, saved)) theme = saved;
  } catch { /* Theme selection still works if persistence is unavailable. */ }
  apply(theme, config.modes[theme], document);
  return theme;
}

export function initialTheme(): Theme {
  return initializeTheme(bootstrapConfig, applyThemeState) as Theme;
}

export function applyTheme(theme: Theme): void {
  applyThemeState(theme, themeMode(theme), document);
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* Optional persistence. */ }
}

export function renderThemeBootstrap(): string {
  return `(${initializeTheme.toString()})(${JSON.stringify(bootstrapConfig)},${applyThemeState.toString()});`;
}
