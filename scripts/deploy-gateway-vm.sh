#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Make admin.getsynthos.com a GATEWAY to the canonical control plane.
#   * copies docs/deploy/gateway/* from ONE pushed commit to ~/synthos-gateway
#   * stops (does not delete) the archived Admin instance and its Caddy in
#     ~/synthos-admin — its volumes are kept untouched as an archive
#   * starts the gateway Caddy (host network, same TLS certificate volumes)
# Usage: scripts/deploy-gateway-vm.sh [commit]
# ---------------------------------------------------------------------------
set -euo pipefail
VM=synthos-core-01; ZONE=us-east1-b; PROJECT=gen-lang-client-0269921691
COMMIT="$(git rev-parse --verify "${1:-HEAD}^{commit}")"
git fetch -q origin
[[ -n "$(git branch -r --contains "$COMMIT")" ]] || { echo "REFUSED: $COMMIT is not pushed" >&2; exit 2; }
gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet --command "set -euo pipefail
cd ~/synthos-admin && git fetch -q origin && git cat-file -e $COMMIT^{commit}
mkdir -p ~/synthos-gateway
git archive $COMMIT docs/deploy/gateway | tar -x --strip-components=3 -C ~/synthos-gateway
echo $COMMIT > ~/synthos-gateway/COMMIT
grep -q '^SYNTHOS_DOMAIN=' ~/synthos-gateway/.env 2>/dev/null || echo SYNTHOS_DOMAIN=admin.getsynthos.com > ~/synthos-gateway/.env
sudo docker run --rm -e SYNTHOS_DOMAIN=admin.getsynthos.com -v ~/synthos-gateway/Caddyfile.gateway:/etc/caddy/Caddyfile:ro caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
cd ~/synthos-admin && sudo docker compose stop caddy synthos-admin
cd ~/synthos-gateway && sudo docker compose -p synthos-gateway -f docker-compose.gateway.yml up -d
sleep 3; sudo docker ps --format '{{.Names}} {{.Status}}'"
echo "verify: curl -s https://admin.getsynthos.com/__gateway ; curl -s https://admin.getsynthos.com/api/authority"
