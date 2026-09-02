import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// One page, no framework components, no client-side framework runtime.
// Tailwind runs at build time only; `astro build` writes a plain static
// directory to site/dist, which is what Cloudflare Pages serves.
export default defineConfig({
  site: "https://offdesk.dev",
  compressHTML: true,
  vite: { plugins: [tailwindcss()] },
});
