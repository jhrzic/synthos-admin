#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deploy the hosted SynthOS Admin: https://admin.getsynthos.com
#   GCE VM synthos-core-01 (us-east1-b, project gen-lang-client-0269921691),
#   docker compose project "synthos-admin" in ~/synthos-admin, Caddy in front.
#
# Builds EXACTLY one pushed commit from `git archive <commit>` on the VM — the
# VM checkout's local compose/Caddy edits are deployment config, never part
# of the image — and stamps that commit into the image (lib/build-info.ts:
# TREE=CLEAN, SOURCE=DEPLOY_ARCHIVE). The previous image is kept as
# synthos-admin-synthos-admin:previous for rollback. Data volumes are not
# touched; the database migrates itself on start (lib/persistence.ts).
#
# Usage:  scripts/deploy-admin-vm.sh [commit]         (default: HEAD, must be pushed)
#         scripts/deploy-admin-vm.sh --rollback
# ---------------------------------------------------------------------------
set -euo pipefail
VM=synthos-core-01; ZONE=us-east1-b; PROJECT=gen-lang-client-0269921691
DEPLOYMENT_NAME="admin.getsynthos.com (gce synthos-core-01)"
IMAGE=synthos-admin-synthos-admin
ssh_vm() { gcloud compute ssh "$VM" --zone "$ZONE" --project "$PROJECT" --quiet --command "$1"; }

if [[ "${1:-}" == "--rollback" ]]; then
  ssh_vm "set -euo pipefail; cd ~/synthos-admin; sudo docker image inspect $IMAGE:previous >/dev/null; sudo docker tag $IMAGE:previous $IMAGE:latest; sudo docker compose up -d --no-build synthos-admin"
  exit 0
fi

COMMIT="$(git rev-parse --verify "${1:-HEAD}^{commit}")"
REF="$(git rev-parse --abbrev-ref HEAD)"
git fetch -q origin
[[ -n "$(git branch -r --contains "$COMMIT")" ]] || { echo "REFUSED: $COMMIT is not on any remote branch; push it first." >&2; exit 2; }
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

ssh_vm "set -euo pipefail
cd ~/synthos-admin
git fetch -q origin
git cat-file -e $COMMIT^{commit}
SRC=\$(mktemp -d /tmp/synthos-build-XXXX)
git archive $COMMIT | tar -x -C \"\$SRC\"
if sudo docker image inspect $IMAGE:latest >/dev/null 2>&1; then sudo docker tag $IMAGE:latest $IMAGE:previous; fi
sudo docker build -q -t $IMAGE:latest -t $IMAGE:$COMMIT \
  --build-arg SYNTHOS_BUILD_SHA=$COMMIT --build-arg SYNTHOS_BUILD_TIME=$BUILT_AT --build-arg SYNTHOS_BUILD_REF=$REF \
  --build-arg SYNTHOS_BUILD_TREE=CLEAN --build-arg SYNTHOS_BUILD_SOURCE=DEPLOY_ARCHIVE \
  --build-arg 'SYNTHOS_DEPLOYMENT_NAME=$DEPLOYMENT_NAME' --build-arg SYNTHOS_ENVIRONMENT=production \"\$SRC\"
rm -rf \"\$SRC\"
sudo docker compose up -d --no-build synthos-admin
for i in \$(seq 1 40); do s=\$(sudo docker inspect -f '{{.State.Health.Status}}' synthos-admin-synthos-admin-1 2>/dev/null || true); [ \"\$s\" = healthy ] && break; sleep 3; done
sudo docker inspect -f 'container {{.State.Health.Status}} image {{.Image}}' synthos-admin-synthos-admin-1"

echo "verify: curl -s https://admin.getsynthos.com/api/ready | jq .version"
