import { defineConfig } from "astro/config";

// One page, no framework components, no client-side framework runtime.
// `astro build` writes a plain static directory to site/dist, which is what
// Cloudflare Pages serves.
export default defineConfig({
  site: "https://offdesk.dev",
  compressHTML: true,
});
