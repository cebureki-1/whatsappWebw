import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: resolve(__dirname, 'src/content/content-script.ts'),
      name: 'WhatsAppChatArchiveContent',
      formats: ['iife'],
      fileName: () => 'content-script.js',
    },
    rollupOptions: {
      output: {
        extend: true,
        inlineDynamicImports: true,
      },
    },
  },
})
