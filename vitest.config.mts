import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'tests/**/*.test.ts'],
    // Un solo archivo por vez: cada suite de integración levanta su
    // propio Postgres en WASM, y varios a la vez no entran en memoria.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 240_000,
  },
})
