# SynthOS Admin — production container image.
#
# Pass VII / Workstream N. This container is SynthOS Admin ONLY. It does not
# bundle Windmill, Hermes, or any other external runtime — those are
# separate deployments this application connects to over the network via
# WINDMILL_BASE_URL / HERMES_ADAPTER_BASE_URL, exactly as it does outside a
# container. See docs/OPERATOR-RUNBOOK.md for how to configure them.
#
# node:sqlite (this app's only database — see lib/persistence.ts) is a
# built-in Node module, not a native addon requiring a build toolchain, so a
# slim (not alpine/musl) Debian base is used for the broadest compatibility
# with any dependency that does need native compilation, without needing
# build-essential in the final image.

FROM node:22-slim AS builder
WORKDIR /app

# Install full dependencies (build tooling — vite/esbuild/typescript — is
# currently declared in "dependencies", not "devDependencies"; see
# docs/PRODUCTION-READINESS.md for the follow-up to move it).
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Runtime needs: the built client (dist/), the bundled server
# (dist/server.cjs), and node_modules for the packages esbuild left
# external (--packages=external — see package.json's build script:
# express, dotenv, tar, ws, @google/genai). Copying node_modules wholesale
# from the builder is simpler and more reliable than a second install pass
# and is the deliberate choice for this first production image.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Real, configurable data paths (Workstream O) — never hardcoded to a
# developer home directory. See lib/persistence.ts (SYNTHOS_DB_PATH),
# lib/backup.ts (BACKUP_ROOT, fixed at ./backups relative to WORKDIR),
# lib/vault.ts (VAULT_ROOT, fixed at ./vault relative to WORKDIR).
ENV SYNTHOS_DB_PATH=/app/data/synthos-admin.db
ENV SYNTHOS_SIGNING_KEY_DIR=/app/data/keys
RUN mkdir -p /app/data /app/vault /app/backups

# Everything durable lives under these three paths — mount all three or
# every restart is a fresh, empty deployment. See docs/OPERATOR-RUNBOOK.md.
VOLUME ["/app/data", "/app/vault", "/app/backups"]

EXPOSE 3000
ENV PORT=3000

# B1 liveness — no external dependency, no DB touch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.cjs"]
