import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "url";

export default defineConfig({
  test: {
    include: ["packages/app/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@webmux/shared": fileURLToPath(new URL("packages/shared/src", import.meta.url)),
      "@": fileURLToPath(new URL("packages/app", import.meta.url)),
    },
  },
});
