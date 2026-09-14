import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      port: 3000,
      // SECURITY — loopback by default, same rule as the Express listener in
      // server.ts. This governs the HMR websocket too, which was binding to
      // every interface independently of the HTTP server. Overridable for a
      // containerised deployment that genuinely needs 0.0.0.0.
      host: process.env.SYNTHOS_BIND_HOST || '127.0.0.1',
      allowedHosts: true as const,
      cors: true,
      // The HMR websocket runs its own listener and does NOT inherit
      // `host` in middleware mode — it was still binding to every interface
      // after the HTTP server was restricted. Bound explicitly here.
      hmr: process.env.DISABLE_HMR === 'true'
        ? false
        : { host: process.env.SYNTHOS_BIND_HOST || '127.0.0.1' },
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      port: 3000,
      host: process.env.SYNTHOS_BIND_HOST || '127.0.0.1',
      allowedHosts: true as const,
      cors: true,
    },
  };
});
