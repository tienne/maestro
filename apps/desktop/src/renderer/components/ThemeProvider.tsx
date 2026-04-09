import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

type Theme = 'dark' | 'light';
type FontSize = 'small' | 'medium' | 'large';

interface ThemeContextValue {
  theme: Theme;
  fontSize: FontSize;
  setTheme: (theme: Theme) => void;
  setFontSize: (size: FontSize) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

interface Props {
  children: ReactNode;
}

export function ThemeProvider({ children }: Props) {
  const [theme, setThemeState] = useState<Theme>('dark');
  const [fontSize, setFontSizeState] = useState<FontSize>('medium');

  // Load persisted settings on mount
  useEffect(() => {
    const savedTheme = (localStorage.getItem('maestro-theme') as Theme) ?? 'dark';
    const savedFontSize = (localStorage.getItem('maestro-font-size') as FontSize) ?? 'medium';
    applyTheme(savedTheme);
    applyFontSize(savedFontSize);
    setThemeState(savedTheme);
    setFontSizeState(savedFontSize);
  }, []);

  function applyTheme(t: Theme) {
    const html = document.documentElement;
    html.classList.remove('dark', 'light');
    html.classList.add(t);
  }

  function applyFontSize(s: FontSize) {
    document.documentElement.setAttribute('data-font-size', s);
  }

  function setTheme(t: Theme) {
    applyTheme(t);
    localStorage.setItem('maestro-theme', t);
    setThemeState(t);
  }

  function setFontSize(s: FontSize) {
    applyFontSize(s);
    localStorage.setItem('maestro-font-size', s);
    setFontSizeState(s);
  }

  return (
    <ThemeContext.Provider value={{ theme, fontSize, setTheme, setFontSize }}>
      {children}
    </ThemeContext.Provider>
  );
}
