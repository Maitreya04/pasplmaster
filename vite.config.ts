import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    legacy({
      // Support a wide span of modern browsers, including older Safari / iOS Safari.
      targets: ['defaults', 'safari >= 13'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      renderLegacyChunks: true,
      modernPolyfills: true,
    }),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm,woff2,woff,webmanifest}'],
        globIgnores: ['**/models/**'],
        maximumFileSizeToCacheInBytes: 8000000,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    // Let @vitejs/plugin-legacy own modern vs legacy targets (avoids override warning).
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
