import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['images/logo_cop_sem_fundo.png'],
      manifest: {
        id: '/',
        start_url: '/',
        scope: '/',
        name: 'Lumi Copilot',
        short_name: 'LumiCopilot',
        description: 'Cockpit Institucional de Trading para NASDAQ',
        theme_color: '#030712',
        background_color: '#030712',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'portrait-primary',
        icons: [
          {
            src: '/images/pwa/android/launchericon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/images/pwa/android/launchericon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/images/pwa/android/launchericon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
});