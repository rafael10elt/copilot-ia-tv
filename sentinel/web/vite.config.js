import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'images/logo_cop_sem_fundo.png'],
      manifest: {
        name: 'Lumi Copilot',
        short_name: 'LumiCopilot',
        description: 'Cockpit Institucional de Trading para NASDAQ',
        theme_color: '#030712',
        background_color: '#030712',
        display: 'standalone',
        orientation: 'portrait-primary',
        icons: [
          {
            src: '/images/pwa/android/android-launchericon-192-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/images/pwa/android/android-launchericon-512-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/images/pwa/android/android-launchericon-512-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
});