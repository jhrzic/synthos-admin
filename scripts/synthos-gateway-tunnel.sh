#!/bin/zsh
# ---------------------------------------------------------------------------
# Gateway tunnel: the canonical control plane (this Mac) opens an OUTBOUND,
# authenticated SSH connection to the gateway VM and exposes ONLY its own
# loopback Admin port (127.0.0.1:3000) as 127.0.0.1:18080 on the VM, where
# Caddy (admin.getsynthos.com) proxies to it.
#
# Security: SSH provides mutual authentication (the VM's host key is pinned by
# gcloud; this user's key is authorised by OS Login), encryption and replay
# protection for every byte. Nothing on the Mac listens on a public interface.
# The Admin still authenticates every request itself (session + workspace
# authorization + same-origin checks + rate limits + audit).
#
# Run by launchd (scripts/launchd/com.synthos.gateway-tunnel.plist), which
# restarts it; ExitOnForwardFailure makes a stale forward a restart, not a
# silent half-open tunnel.
# ---------------------------------------------------------------------------
set -u
VM="${SYNTHOS_GATEWAY_VM:-synthos-core-01}"
ZONE="${SYNTHOS_GATEWAY_ZONE:-us-east1-b}"
PROJECT="${SYNTHOS_GATEWAY_PROJECT:-gen-lang-client-0269921691}"
LOCAL_PORT="${PORT:-3000}"
REMOTE_PORT="${SYNTHOS_GATEWAY_REMOTE_PORT:-18080}"
GCLOUD="${SYNTHOS_GCLOUD_BIN:-$(command -v gcloud || echo /opt/homebrew/bin/gcloud)}"
echo "[$(date -u +%FT%TZ)] tunnel ${VM}:127.0.0.1:${REMOTE_PORT} -> 127.0.0.1:${LOCAL_PORT}"
exec "${GCLOUD}" compute ssh "${VM}" --zone "${ZONE}" --project "${PROJECT}" --quiet -- \
  -N -T \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o BatchMode=yes \
  -R "127.0.0.1:${REMOTE_PORT}:127.0.0.1:${LOCAL_PORT}"
