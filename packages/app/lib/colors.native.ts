import { Appearance } from 'react-native';

const lightColors = {
  background: '#fdfcfc',
  backgroundSecondary: '#f1eeee',
  surface: '#f8f7f7',
  surfaceHover: '#f1eeee',
  foreground: '#201d1d',
  foregroundSecondary: '#424245',
  foregroundMuted: '#6e6e73',
  accent: '#007aff',
  accentDim: '#0056b3',
  danger: '#ff3b30',
  warning: '#ff9f0a',
  success: '#30d158',
  border: 'rgba(15, 0, 0, 0.12)',
  borderActive: '#007aff',
} as const;

const darkColors = {
  background: '#201d1d',
  backgroundSecondary: '#302c2c',
  surface: '#302c2c',
  surfaceHover: '#403c3c',
  foreground: '#fdfcfc',
  foregroundSecondary: '#9a9898',
  foregroundMuted: '#6e6e73',
  accent: '#007aff',
  accentDim: '#0056b3',
  danger: '#ff3b30',
  warning: '#ff9f0a',
  success: '#30d158',
  border: 'rgba(15, 0, 0, 0.12)',
  borderActive: '#007aff',
} as const;

const lightAlpha = {
  accentSubtle: 'rgba(0, 122, 255, 0.08)',
  accentLight: 'rgba(0, 122, 255, 0.1)',
  accentLight12: 'rgba(0, 122, 255, 0.12)',
  accentMedium15: 'rgba(0, 122, 255, 0.15)',
  accentMedium: 'rgba(0, 122, 255, 0.2)',
  accentBorder: 'rgba(0, 122, 255, 0.25)',
  backgroundDim: 'rgba(253, 252, 252, 0.15)',
  backgroundOverlay: 'rgba(253, 252, 252, 0.2)',
  backgroundShadow: 'rgba(253, 252, 252, 0.4)',
  backgroundOpaque96: 'rgba(253, 252, 252, 0.96)',
  backgroundOpaque98: 'rgba(253, 252, 252, 0.98)',
  backgroundSecondaryOpaque96: 'rgba(241, 238, 238, 0.96)',
  surfaceOpaque94: 'rgba(248, 247, 247, 0.94)',
  foregroundOverlay: 'rgba(32, 29, 29, 0.15)',
  foregroundSubtle: 'rgba(32, 29, 29, 0.35)',
  warningSubtle: 'rgba(255, 159, 10, 0.08)',
  warningLight12: 'rgba(255, 159, 10, 0.12)',
  warningBorder: 'rgba(255, 159, 10, 0.2)',
  warningBorder22: 'rgba(255, 159, 10, 0.22)',
  mutedLight: 'rgba(110, 110, 115, 0.15)',
  mutedMedium: 'rgba(110, 110, 115, 0.3)',
} as const;

const darkAlpha = {
  accentSubtle: 'rgba(0, 122, 255, 0.08)',
  accentLight: 'rgba(0, 122, 255, 0.1)',
  accentLight12: 'rgba(0, 122, 255, 0.12)',
  accentMedium15: 'rgba(0, 122, 255, 0.15)',
  accentMedium: 'rgba(0, 122, 255, 0.2)',
  accentBorder: 'rgba(0, 122, 255, 0.25)',
  backgroundDim: 'rgba(32, 29, 29, 0.15)',
  backgroundOverlay: 'rgba(32, 29, 29, 0.2)',
  backgroundShadow: 'rgba(32, 29, 29, 0.4)',
  backgroundOpaque96: 'rgba(32, 29, 29, 0.96)',
  backgroundOpaque98: 'rgba(32, 29, 29, 0.98)',
  backgroundSecondaryOpaque96: 'rgba(48, 44, 44, 0.96)',
  surfaceOpaque94: 'rgba(48, 44, 44, 0.94)',
  foregroundOverlay: 'rgba(253, 252, 252, 0.15)',
  foregroundSubtle: 'rgba(253, 252, 252, 0.35)',
  warningSubtle: 'rgba(255, 159, 10, 0.08)',
  warningLight12: 'rgba(255, 159, 10, 0.12)',
  warningBorder: 'rgba(255, 159, 10, 0.2)',
  warningBorder22: 'rgba(255, 159, 10, 0.22)',
  mutedLight: 'rgba(110, 110, 115, 0.15)',
  mutedMedium: 'rgba(110, 110, 115, 0.3)',
} as const;

// Resolve theme from system appearance
const scheme = Appearance.getColorScheme();
export const colors = scheme === 'light' ? lightColors : darkColors;
export const colorAlpha = scheme === 'light' ? lightAlpha : darkAlpha;

export { terminalTheme } from './colors.shared';
