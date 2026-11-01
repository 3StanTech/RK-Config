import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// No public site is chosen yet. Set SITE_URL (e.g. https://example.org) only for a
// deployment you own; canonical and structured URL metadata are emitted only then.
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
