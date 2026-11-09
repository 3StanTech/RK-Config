import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// Set SITE_URL for the deployment you own (production: https://rk-config.pages.dev).
// Canonical and structured URL metadata are emitted only when it is set.
const siteUrl = process.env.SITE_URL || undefined;

// https://astro.build/config
export default defineConfig({
  integrations: [
    react(),
  ],
  output: 'static',
  site: siteUrl,
  base: '/',
  server: {
    port: 5173,
    // Loopback only: dev and preview servers are not exposed on the local network.
    host: '127.0.0.1',
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      https: process.env.HTTPS === 'true',
    },
    resolve: {
      alias: {
        '@': path.resolve('./src'),
      },
    },
  },
});
