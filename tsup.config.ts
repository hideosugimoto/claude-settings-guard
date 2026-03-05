import { defineConfig } from 'tsup'
import { cpSync } from 'node:fs'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  onSuccess: async () => {
    cpSync('templates', 'dist/templates', { recursive: true })
  },
})
