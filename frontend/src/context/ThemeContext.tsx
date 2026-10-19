import React, { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'aurora' | 'ivory' | 'sunset' | 'obsidian' | 'emerald';

export const THEMES: { id: Theme; name: string; description: string; label: string }[] = [
  { id: 'light', name: 'Corporate Light', description: 'Trong sáng · Chuyên nghiệp', label: 'Sáng mặc định' },
  { id: 'dark', name: 'Midnight Dark', description: 'Sâu lắng · Tập trung', label: 'Tối mặc định' },
  { id: 'aurora', name: 'Aurora Glass', description: 'Kính mờ · Xanh tím dịu', label: 'Glass Workspace' },
  { id: 'ivory', name: 'Ivory & Forest', description: 'Nền ngà · Xanh rừng', label: 'Organic Minimal' },
  { id: 'sunset', name: 'Sunset Coral Glass', description: 'Hoàng hôn · Kính hồng đào', label: 'Ấm áp & Rực rỡ' },
  { id: 'obsidian', name: 'Obsidian Titanium', description: 'Titan tối · Điểm nhấn bạc hà', label: 'Hiện đại & Sắc nét' },
  { id: 'emerald', name: 'Emerald Aurora', description: 'Ngọc lục bảo · Ánh sáng dịu', label: 'Tươi mới & Thanh lịch' },
];

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  toggleTheme: () => {},
  setTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('dtl_theme');
      if (THEMES.some(item => item.id === saved)) return saved as Theme;
    } catch { /* Storage may be disabled; theme still works for this visit. */ }
    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const isDark = theme === 'dark' || theme === 'obsidian';

    root.setAttribute('data-theme', theme);
    body.setAttribute('data-theme', theme);

    for (const element of [root, body]) {
      element.classList.toggle('dark', isDark);
      element.classList.toggle('light', theme === 'light');
    }
    root.style.colorScheme = isDark ? 'dark' : 'light';
    try { localStorage.setItem('dtl_theme', theme); } catch { /* Optional persistence. */ }
  }, [theme]);

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const setTheme = (t: Theme) => setThemeState(t);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
