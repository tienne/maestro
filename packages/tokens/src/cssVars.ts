import { colors } from './colors';
import { spacing } from './spacing';
import { radius } from './radius';

export function generateCssVars(): string {
  const lines: string[] = [':root {'];

  for (const [key, value] of Object.entries(colors)) {
    lines.push(`  --color-${key}: ${value};`);
  }

  for (const [key, value] of Object.entries(spacing)) {
    lines.push(`  --spacing-${key}: ${value}px;`);
  }

  for (const [key, value] of Object.entries(radius)) {
    lines.push(`  --radius-${key}: ${value === 9999 ? '9999px' : `${value}px`};`);
  }

  lines.push('}');
  return lines.join('\n');
}

export const cssVarNames = {
  color: (token: string) => `var(--color-${token})`,
  spacing: (token: string) => `var(--spacing-${token})`,
  radius: (token: string) => `var(--radius-${token})`,
} as const;
