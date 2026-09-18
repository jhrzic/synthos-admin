import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  // Read once: every switch below has to agree, and three separate reads of
  // the same variable is how they drift apart.
  const hmrDisabled = process.env.DISABLE_HMR === 'true';

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
      host: '0.0.0.0',
      allowedHosts: true as const,
      cors: true,
      // ALWAYS-ON RUNTIME — `hmr: false` alone does NOT stop Vite opening a
      // websocket server. In Vite 6 the only switch for that is
      // `server.ws: false` (vite/dist/node: createWebSocketServer returns a
      // no-op transport only when `config.server.ws === false`).
      //
      // With `hmr: false` and middleware mode, `wsServer` resolves to the
      // absent http server, so Vite creates its OWN listener on port 24678
      // with `host` undefined — which binds every interface. That was
      // observed: the admin itself was correctly on 127.0.0.1:3000 while a
      // websocket port sat open on the local network beside it.
      //
      // So DISABLE_HMR now turns off the socket as well as the client, and
      // when HMR IS wanted it is pinned to loopback rather than inheriting
      // the all-interfaces default.
      hmr: hmrDisabled ? false : { host: '127.0.0.1' },
      // Vite types this as `false | undefined` — the option exists only to
      // switch the socket off, so it is spread in rather than set to `true`.
      ...(hmrDisabled ? { ws: false as const } : {}),
      watch: hmrDisabled ? null : {},
    },
    // Vitest's default per-test timeout is 5s. This suite is not a typical unit
    // suite: several files spawn REAL production servers, run REAL concurrent
    // HTTP requests, build REAL tar archives and do REAL Ed25519 signing, all
    // across parallel workers. Under that load a correct test can exceed 5s
    // purely by waiting for CPU, which shows up as an intermittent failure in
    // whichever file happened to be unlucky — observed on the untouched
    // baseline as well, so it is not caused by any one file.
    //
    // This raises the time budget only. Every assertion is unchanged: a test
    // that genuinely hangs still fails, 20s later. The alternative — loosening
    // the concurrency assertions themselves — would have hidden real defects.
    test: {
      testTimeout: 20000,
      hookTimeout: 20000,
      // Runs before each test file's module graph is imported, which is the
      // only point early enough to set SYNTHOS_DB_PATH before lib/persistence
      // resolves it. Gives every test an isolated temporary SQLite file so no
      // test can reach the production database through the development
      // fallback. See test/setup/isolate-database.ts for why this is central
      // rather than repeated in each file.
      setupFiles: ['./test/setup/isolate-database.ts'],
    },
    preview: {
      port: 3000,
      host: '0.0.0.0',
      allowedHosts: true as const,
      cors: true,
    },
  };
});
