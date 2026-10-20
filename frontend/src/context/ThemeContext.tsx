import React, { createContext, useContext, useLayoutEffect, useState } from 'react';
import { DEFAULT_THEME, Theme, isTheme } from '../theme/catalog';
import { applyTheme, initialTheme } from '../theme/runtime';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  useLayoutEffect(() => { applyTheme(theme); }, [theme]);
  const setTheme = (value: Theme) => { if (isTheme(value)) setThemeState(value); };
  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
