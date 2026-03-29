import type { Config } from "tailwindcss";

const colorVar = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  important: "html",
  theme: {
    extend: {
      colors: {
        background: colorVar("--color-background"),
        surface: colorVar("--color-surface"),
        "surface-light": colorVar("--color-surface-light"),
        foreground: colorVar("--color-foreground"),
        "foreground-secondary": colorVar("--color-foreground-secondary"),
        accent: colorVar("--color-accent"),
        green: colorVar("--color-green"),
        red: colorVar("--color-red"),
        orange: colorVar("--color-orange"),
        yellow: colorVar("--color-yellow"),
        purple: colorVar("--color-accent"),
        border: colorVar("--color-border"),
        white: "#ffffff",
      },
      fontFamily: {
        serif: ['Charter', 'Bitstream Charter', 'Sitka Text', 'Cambria', 'serif'],
        sans: ['system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'Cascadia Code', 'Source Code Pro', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        none: '0',
        sm: '0',
        DEFAULT: '0',
        md: '0',
        lg: '0',
        xl: '0',
        '2xl': '0',
        '3xl': '0',
        full: '9999px',
      },
    },
  },
  plugins: [],
} satisfies Config;
