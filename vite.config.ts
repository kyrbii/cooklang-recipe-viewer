import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import wasmModule from 'vite-plugin-wasm'

// The package ships CommonJS typings, at runtime the import is the plugin function itself
const wasm = ((wasmModule as { default?: unknown }).default ?? wasmModule) as () => PluginOption

// https://vite.dev/config/
export default defineConfig({
  server: {
    host: true,
    allowedHosts: true
  },
  plugins: [
    wasm(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'pwa-icon.svg', 'pwa-maskable.svg'],
      manifest: {
        name: 'stir',
        short_name: 'stir',
        description: 'stir – deine Rezepte in Cooklang',
        theme_color: '#FAF8F5',
        background_color: '#FAF8F5',
        display: 'standalone',
        orientation: 'portrait',
        share_target: {
          action: '/',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' }
        },
        icons: [
          {
            src: '/pwa-icon.svg',
            sizes: '192x192 512x512',
            type: 'image/svg+xml',
            purpose: 'any'
          },
          {
            src: '/pwa-maskable.svg',
            sizes: '192x192 512x512',
            type: 'image/svg+xml',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
        // config.js is written per installation when the container starts, so it must not be
        // precached with the build's version. Network first, the cached copy only when offline.
        globIgnores: ['config.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname === '/config.js',
            handler: 'NetworkFirst',
            options: { cacheName: 'stir-config', networkTimeoutSeconds: 3 }
          }
        ]
      }
    })
  ]
})
