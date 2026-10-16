import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        offscreen: resolve(__dirname, 'offscreen.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
