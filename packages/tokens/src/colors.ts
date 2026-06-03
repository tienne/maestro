export const colors = {
  // Brand
  primary: '#000000',
  ink: '#000000',
  'on-primary': '#ffffff',
  'on-dark': '#ffffff',

  // Canvas
  'canvas-night': '#000000',
  'canvas-night-elevated': '#0a0a0a',
  'canvas-light': '#ffffff',
  'canvas-cream': '#fbfbf5',
  'surface-elevated-dark': '#1e2c31',

  // Shades
  'shade-30': '#d4d4d8',
  'shade-40': '#a1a1aa',
  'shade-50': '#71717a',
  'shade-60': '#52525b',
  'shade-70': '#3f3f46',

  // Hairlines
  'hairline-light': '#e4e4e7',
  'hairline-dark': '#1e2c31',

  // Accents (light track only)
  'aloe-10': '#c1fbd4',
  'pistachio-10': '#d4f9e0',

  // Status
  'status-running': '#22c55e',
  'status-success': '#16a34a',
  'status-warning': '#f59e0b',
  'status-danger': '#ef4444',
  'status-idle': '#71717a',
  'status-completed': '#52525b',

  // Link tones (dark surfaces)
  'link-cool-1': '#9dabad',
  'link-cool-2': '#9797a2',
  'link-cool-3': '#bdbdca',
  'link-mint': '#99b3ad',
} as const;

export type ColorToken = keyof typeof colors;
