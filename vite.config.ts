import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

// Repository site: https://emirozyilmaz.github.io/gida-pusulasi/
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/gida-pusulasi/' : '/',
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Gıda Pusulası - Etiket ve Barkod Analizi',
        short_name: 'Gıda Pusulası',
        description: 'Barkod ve etiket fotoğrafından anlaşılır gıda içeriği analizi',
        lang: 'tr',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f6f8f5',
        theme_color: '#164e42',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }
        ]
      },
      workbox: {
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        cleanupOutdatedCaches: true
      }
    })
  ]
});
