import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  important: "html",
  theme: {
    extend: {
      colors: {
        background: "#1a1b26",
        surface: "#1f2335",
        "surface-light": "#292e42",
        foreground: "#c0caf5",
        "foreground-secondary": "#565f89",
        accent: "#7aa2f7",
        green: "#9ece6a",
        red: "#f7768e",
        orange: "#ff9e64",
        yellow: "#e0af68",
        purple: "#bb9af7",
        border: "#343a52",
      },
    },
  },
  plugins: [],
} satisfies Config;
