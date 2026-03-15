import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node20',
  banner: {
    js: '#!/usr/bin/env node',
  },
})
