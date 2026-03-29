import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  important: "html",
  theme: {
    extend: {
      colors: {
        background: "#f8f5ed",
        surface: "#efe9de",
        "surface-light": "#e6e0d4",
        foreground: "#1a1a1a",
        "foreground-secondary": "#6b6b6b",
        accent: "#1a1a1a",
        green: "#1a1a1a",
        red: "#b44444",
        orange: "#b44444",
        yellow: "#6b6b6b",
        purple: "#1a1a1a",
        border: "#d5cfc4",
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
