import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The Vite HMR websocket is only needed by the dev server; keep it out of production CSP.
const devConnectSrc = (): Plugin => ({
  name: 'igchat-dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace("connect-src 'self'", "connect-src 'self' ws://localhost:*")
});

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [svelte(), devConnectSrc()]
  }
});
