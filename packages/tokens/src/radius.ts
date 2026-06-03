export const radius = {
  xs: 4,
  sm: 5,
  md: 8,
  lg: 12,
  xl: 20,
  pill: 9999,
} as const;

export type RadiusToken = keyof typeof radius;
