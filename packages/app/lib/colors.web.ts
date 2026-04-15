// CSS-variable-based color constants for inline styles (responds to light/dark mode)
export const colors = {
  background: 'rgb(var(--color-background))',
  backgroundSecondary: 'rgb(var(--color-background-secondary))',
  surface: 'rgb(var(--color-surface))',
  surfaceHover: 'rgb(var(--color-surface-hover))',
  foreground: 'rgb(var(--color-foreground))',
  foregroundSecondary: 'rgb(var(--color-foreground-secondary))',
  foregroundMuted: 'rgb(var(--color-foreground-muted))',
  accent: 'rgb(var(--color-accent))',
  accentDim: 'rgb(var(--color-accent-dim))',
  danger: 'rgb(var(--color-danger))',
  warning: 'rgb(var(--color-warning))',
  success: 'rgb(var(--color-success))',
  border: 'rgb(var(--color-border))',
  borderActive: 'rgb(var(--color-border-active))',
} as const;

// Pre-computed alpha color variants for CSS variable contexts
export const colorAlpha = {
  accentSubtle: 'rgba(var(--color-accent) / 0.08)',
  accentLight: 'rgba(var(--color-accent) / 0.1)',
  accentLight12: 'rgba(var(--color-accent) / 0.12)',
  accentMedium15: 'rgba(var(--color-accent) / 0.15)',
  accentMedium: 'rgba(var(--color-accent) / 0.2)',
  accentBorder: 'rgba(var(--color-accent) / 0.25)',
  backgroundDim: 'rgba(var(--color-background) / 0.15)',
  backgroundOverlay: 'rgba(var(--color-background) / 0.2)',
  backgroundShadow: 'rgba(var(--color-background) / 0.4)',
  backgroundOpaque96: 'rgba(var(--color-background) / 0.96)',
  backgroundOpaque98: 'rgba(var(--color-background) / 0.98)',
  backgroundSecondaryOpaque96: 'rgba(var(--color-background-secondary) / 0.96)',
  surfaceOpaque94: 'rgba(var(--color-surface) / 0.94)',
  foregroundOverlay: 'rgba(var(--color-foreground) / 0.15)',
  foregroundSubtle: 'rgba(var(--color-foreground) / 0.35)',
  warningSubtle: 'rgba(var(--color-warning) / 0.08)',
  warningLight12: 'rgba(var(--color-warning) / 0.12)',
  warningBorder: 'rgba(var(--color-warning) / 0.2)',
  warningBorder22: 'rgba(var(--color-warning) / 0.22)',
  mutedLight: 'rgba(var(--color-foreground-muted) / 0.15)',
  mutedMedium: 'rgba(var(--color-foreground-muted) / 0.3)',
} as const;

export { terminalTheme } from './colors.shared';
