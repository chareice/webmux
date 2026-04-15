import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["packages/app/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@webmux/shared": path.resolve(__dirname, "packages/shared/src"),
      "@": path.resolve(__dirname, "packages/app"),
    },
  },
});
