import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    host: true,
    port: 5173,
  },
  plugins: [
    react(),
    tailwindcss(),
    // REMOVED: legacy plugin was adding 139KB of polyfills for Safari 13 (2019).
    // Modern warehouse PWA devices (iOS 15+, Chrome 90+) don't need these.
    // If legacy support is needed later, re-enable with narrower targets.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        // Precache only critical assets for fast initial load.
        // Route-specific chunks (admin, billing, etc.) load on-demand and get runtime-cached.
        globPatterns: [
          'index.html',
          'manifest.json',
          'icons/*.png',
          // Core app chunks (hashed names vary per build)
          'assets/index-*.js',
          'assets/index-*.css',
          'assets/router-*.js',
          'assets/query-*.js',
          'assets/supabase-*.js',
          // Picking flow chunks
          'assets/Picking*.js',
          'assets/QueuePage-*.js',
          'assets/PickPage-*.js',
          'assets/PickFlowExperience-*.js',
          'assets/PickPreview*.js',
          'assets/ActivePicks*.js',
          // Fonts (woff2 only - modern browsers)
          '**/*.woff2',
        ],
        globIgnores: [
          '**/models/**',
          // Don't precache heavy admin/billing/sales pages
          '**/Admin*.js',
          '**/Billing*.js',
          '**/Sales*.js',
          '**/Upload*.js',
          '**/Label*.js',
          '**/Purchase*.js',
          '**/Receiving*.js',
          '**/pdf-*.js',
          '**/purchasePoImporter-*.js',
        ],
        maximumFileSizeToCacheInBytes: 3000000,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    // Target modern browsers - iOS 15+ (2021), Chrome 90+ (2021).
    target: ['es2020', 'chrome90', 'safari15'],
    chunkSizeWarningLimit: 1500,
    reportCompressedSize: false,
    cssMinify: true,
    rollupOptions: {
      output: {
        // Function form: avoids empty `react` chunks when legacy splits the graph differently
        // than static `manualChunks` entries.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-router')) return 'router';
          if (id.includes('@tanstack/react-query')) return 'query';
          if (id.includes('@supabase')) return 'supabase';
        },
      },
    },
  },
  esbuild: {
    legalComments: 'none',
  },
});
