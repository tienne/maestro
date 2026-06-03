import { useColorScheme } from 'react-native';
import { colors, spacing, radius, typography, fontFamilies } from '@maestro/tokens';

const darkTheme = {
  background: '#151110',
  backgroundSecondary: '#1a1716',
  surface: '#201e1c',
  surfaceHover: '#252220',
  textPrimary: '#eae8e6',
  textSecondary: '#a8a5a3',
  textMuted: '#5a5755',
  accent: '#e07850',
  border: '#2a2827',
} as const;

const lightTheme = {
  background: '#f5f4f2',
  backgroundSecondary: '#eeedea',
  surface: '#ffffff',
  surfaceHover: '#e8e6e2',
  textPrimary: '#1c1a19',
  textSecondary: '#6b6866',
  textMuted: '#9e9b98',
  accent: '#c0623c',
  border: '#e5e3de',
} as const;

export function useTokens() {
  const scheme = useColorScheme();
  const isDark = scheme !== 'light';
  const theme = isDark ? darkTheme : lightTheme;

  return {
    colors: { ...colors, ...theme },
    spacing,
    radius,
    typography,
    fontFamilies,
    isDark,
  };
}

export type Tokens = ReturnType<typeof useTokens>;
