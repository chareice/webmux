import { Appearance } from 'react-native';

const lightColors = {
  background: '#f5f4ed',
  backgroundSecondary: '#faf9f5',
  surface: '#faf9f5',
  surfaceHover: '#f0eee6',
  foreground: '#141413',
  foregroundSecondary: '#5e5d59',
  foregroundMuted: '#87867f',
  accent: '#c96442',
  accentDim: '#d97757',
  danger: '#b53333',
  warning: '#c96442',
  success: '#30d158',
  border: '#f0eee6',
  borderActive: '#c96442',
} as const;

const darkColors = {
  background: '#141413',
  backgroundSecondary: '#30302e',
  surface: '#30302e',
  surfaceHover: '#3d3d3a',
  foreground: '#faf9f5',
  foregroundSecondary: '#b0aea5',
  foregroundMuted: '#87867f',
  accent: '#d97757',
  accentDim: '#c96442',
  danger: '#b53333',
  warning: '#d97757',
  success: '#30d158',
  border: '#30302e',
  borderActive: '#d97757',
} as const;

const lightAlpha = {
  accentSubtle: 'rgba(201, 100, 66, 0.08)',
  accentLight: 'rgba(201, 100, 66, 0.1)',
  accentLight12: 'rgba(201, 100, 66, 0.12)',
  accentMedium15: 'rgba(201, 100, 66, 0.15)',
  accentMedium: 'rgba(201, 100, 66, 0.2)',
  accentBorder: 'rgba(201, 100, 66, 0.25)',
  backgroundDim: 'rgba(245, 244, 237, 0.15)',
  backgroundOverlay: 'rgba(245, 244, 237, 0.2)',
  backgroundShadow: 'rgba(245, 244, 237, 0.4)',
  backgroundOpaque96: 'rgba(245, 244, 237, 0.96)',
  backgroundOpaque98: 'rgba(245, 244, 237, 0.98)',
  backgroundSecondaryOpaque96: 'rgba(250, 249, 245, 0.96)',
  surfaceOpaque94: 'rgba(250, 249, 245, 0.94)',
  foregroundOverlay: 'rgba(20, 20, 19, 0.15)',
  foregroundSubtle: 'rgba(20, 20, 19, 0.35)',
  warningSubtle: 'rgba(201, 100, 66, 0.08)',
  warningLight12: 'rgba(201, 100, 66, 0.12)',
  warningBorder: 'rgba(201, 100, 66, 0.2)',
  warningBorder22: 'rgba(201, 100, 66, 0.22)',
  mutedLight: 'rgba(135, 134, 127, 0.15)',
  mutedMedium: 'rgba(135, 134, 127, 0.3)',
} as const;

const darkAlpha = {
  accentSubtle: 'rgba(217, 119, 87, 0.08)',
  accentLight: 'rgba(217, 119, 87, 0.1)',
  accentLight12: 'rgba(217, 119, 87, 0.12)',
  accentMedium15: 'rgba(217, 119, 87, 0.15)',
  accentMedium: 'rgba(217, 119, 87, 0.2)',
  accentBorder: 'rgba(217, 119, 87, 0.25)',
  backgroundDim: 'rgba(20, 20, 19, 0.15)',
  backgroundOverlay: 'rgba(20, 20, 19, 0.2)',
  backgroundShadow: 'rgba(20, 20, 19, 0.4)',
  backgroundOpaque96: 'rgba(20, 20, 19, 0.96)',
  backgroundOpaque98: 'rgba(20, 20, 19, 0.98)',
  backgroundSecondaryOpaque96: 'rgba(48, 48, 46, 0.96)',
  surfaceOpaque94: 'rgba(48, 48, 46, 0.94)',
  foregroundOverlay: 'rgba(250, 249, 245, 0.15)',
  foregroundSubtle: 'rgba(250, 249, 245, 0.35)',
  warningSubtle: 'rgba(217, 119, 87, 0.08)',
  warningLight12: 'rgba(217, 119, 87, 0.12)',
  warningBorder: 'rgba(217, 119, 87, 0.2)',
  warningBorder22: 'rgba(217, 119, 87, 0.22)',
  mutedLight: 'rgba(135, 134, 127, 0.15)',
  mutedMedium: 'rgba(135, 134, 127, 0.3)',
} as const;

// Resolve theme from system appearance
const scheme = Appearance.getColorScheme();
export const colors = scheme === 'light' ? lightColors : darkColors;
export const colorAlpha = scheme === 'light' ? lightAlpha : darkAlpha;

export { terminalTheme } from './colors.shared';
