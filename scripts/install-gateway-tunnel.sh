#!/bin/zsh
# Install (or re-install) the launchd job that keeps the gateway tunnel up.
# Usage: scripts/install-gateway-tunnel.sh        Uninstall: --uninstall
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.synthos.gateway-tunnel.plist"
LABEL="gui/$(id -u)/com.synthos.gateway-tunnel"
if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "$LABEL" 2>/dev/null || true; rm -f "$PLIST"; echo "uninstalled"; exit 0
fi
GCLOUD="$(command -v gcloud)"; [[ -x "$GCLOUD" ]] || { echo "gcloud not found on PATH" >&2; exit 2; }
mkdir -p "$HOME/Library/Logs/synthos" "$HOME/Library/LaunchAgents"
sed -e "s|__REPO__|$REPO|g" -e "s|__GCLOUD__|$GCLOUD|g" -e "s|__GCLOUD_DIR__|$(dirname "$GCLOUD")|g" -e "s|__HOME__|$HOME|g" \
  "$REPO/scripts/launchd/com.synthos.gateway-tunnel.plist.template" > "$PLIST"
plutil -lint "$PLIST" >/dev/null
launchctl bootout "$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $PLIST"
