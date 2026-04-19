// Platform-resolved module: Metro resolves to colors.web.ts or colors.native.ts at runtime.
// This file exists so TypeScript can resolve `@/lib/colors` for type-checking.
export { colors, colorAlpha, terminalTheme } from './colors.web';
