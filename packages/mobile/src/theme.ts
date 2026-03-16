import { Platform, StyleSheet } from 'react-native';

export const colors = {
  background: '#1a1b26',
  surface: '#1f2335',
  surfaceLight: '#292e42',
  text: '#c0caf5',
  textSecondary: '#565f89',
  accent: '#7aa2f7',
  green: '#9ece6a',
  red: '#f7768e',
  orange: '#ff9e64',
  yellow: '#e0af68',
  purple: '#bb9af7',
  border: '#343a52',
} as const;

export const fonts = {
  mono: Platform.select({ ios: 'Menlo', android: 'monospace' }) as string,
} as const;

export const commonStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 6,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600' as const,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
  },
});

export function statusColor(status: string): string {
  switch (status) {
    case 'starting':
      return colors.yellow;
    case 'running':
      return colors.accent;
    case 'success':
      return colors.green;
    case 'failed':
      return colors.red;
    case 'interrupted':
      return colors.textSecondary;
    default:
      return colors.textSecondary;
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'starting':
      return 'Starting';
    case 'running':
      return 'Running';
    case 'success':
      return 'Success';
    case 'failed':
      return 'Failed';
    case 'interrupted':
      return 'Interrupted';
    default:
      return status;
  }
}

export function toolIcon(tool: string): string {
  return tool === 'codex' ? 'CX' : 'CC';
}
