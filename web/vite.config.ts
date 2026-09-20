import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

// The backend port, so the dev proxy points at the right place.
// scripts/run-dev exports these from your .env file.
const API_PORT = process.env.PORT || '5000';
const DEV_PORT = Number(process.env.WEB_DEV_PORT || 5173);

export default defineConfig({
  plugins: [
    react(),
    legacy({
      // TV browsers lag desktop Chrome by years; this ships an ES5 bundle
      // alongside the modern one so old smart TVs can still run the app.
      targets: ['chrome >= 47'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
    }),
  ],
  server: {
    // Bind every interface so a TV or phone on the same Wi-Fi can load the
    // dev server, not just localhost.
    host: true,
    port: DEV_PORT,
    proxy: {
      // In dev the frontend and backend are separate processes, so forward
      // API calls to Express. In production Express serves the built app and
      // no proxy is involved.
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    cssTarget: 'chrome47',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
