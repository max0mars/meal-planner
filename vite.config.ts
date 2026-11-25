import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Relative paths, so the built folder works at any address: the top of a site or a subfolder (GitHub Pages).
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      workbox: {
        // The starter recipes and foods are large lazy-loaded files. Cache them so the app works offline after first use.
        globPatterns: ['**/*.{js,css,html,svg,png,json,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // The receipt reader is about 15 MB. It is not downloaded with the app; it is fetched the first time you scan a receipt,
        // then kept so scanning works offline after that.
        globIgnores: ['ocr/**'],
        runtimeCaching: [
          { urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/ocr/'), handler: 'CacheFirst', options: { cacheName: 'receipt-reader', expiration: { maxEntries: 10 } } },
        ],
      },
      manifest: {
        id: './',
        name: 'Gentle Stomach Meal Planner',
        short_name: 'MealPlanner',
        description: 'Pantry, recipes, weekly plan and nutrition for a sensitive stomach',
        theme_color: '#2a6f37',
        background_color: '#f4ede3',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
