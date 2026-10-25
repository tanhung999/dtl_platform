import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { renderThemeStyles } from './src/theme/catalog'
import { renderThemeBootstrap } from './src/theme/runtime'
import { legacyAssets } from './tooling/legacyAssets'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), legacyAssets(), {
    name: 'dtl-theme-catalog',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        { tag: 'style', attrs: { id: 'dtl-theme-tokens' }, children: renderThemeStyles(), injectTo: 'head-prepend' },
        { tag: 'script', attrs: { id: 'dtl-theme-bootstrap' }, children: renderThemeBootstrap(), injectTo: 'head-prepend' },
      ],
    },
  }],
  server: {
    port: 5173,
    watch: {
      usePolling: process.env.CHOKIDAR_USEPOLLING === 'true',
      interval: 1000,
    },
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:8000',
        changeOrigin: true,
      },
      // Keep every browser-facing identity route on the Platform origin.
      '/auth': {
        target: process.env.IDENTITY_PROXY_TARGET || 'http://localhost:8081',
        changeOrigin: false,
        xfwd: true,
      },
    },
  },
})
