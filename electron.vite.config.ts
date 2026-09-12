import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {},
  preload: {
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: 'index.js' } } }
  },
  renderer: {
    plugins: [vue(), {
      name: 'production-csp', apply: 'build',
      transformIndexHtml: html => html
        .replace("style-src 'self' 'unsafe-inline'", "style-src 'self'")
        .replace("connect-src 'self' ws://localhost:* ws://127.0.0.1:*", "connect-src 'none'")
    }]
  }
})
