#!/bin/zsh
# ---------------------------------------------------------------------------
# SynthOS Admin — always-on local runtime launcher.
#
# Run by launchd (~/Library/LaunchAgents/com.synthos.admin.plist), never by a
# human directly and never by an IDE. Its whole job is to make the difference
# between "crashed" and "misconfigured" visible to launchd, because launchd
# cannot tell them apart on its own and will happily restart a misconfigured
# service forever.
#
#   exit 0        — a precondition is not met. launchd is configured with
#                   KeepAlive={SuccessfulExit:false}, so it does NOT restart.
#                   No restart loop, and the reason is in the log.
#   exec node     — the server becomes this process. If it dies abnormally,
#                   launchd restarts it after ThrottleInterval (30s).
#
# Secrets are read from a 0600 env file and exported here, so they never
# appear in the plist, in `ps`, or in any argv.
# ---------------------------------------------------------------------------

set -u

REPO="/Users/hrzic/synthos/synthos-admin"
NODE_BIN="/Users/hrzic/.local/bin/node"
ENV_FILE="${HOME}/.synthos/synthos-admin.env"
LOG_DIR="${HOME}/Library/Logs/synthos"

stamp() { date "+%Y-%m-%dT%H:%M:%S%z"; }
say()   { print -r -- "[$(stamp)] [service] $*"; }
refuse() {
  say "REFUSING TO START: $*"
  say "This is a configuration problem, not a crash. launchd will NOT retry."
  say "Fix the above, then: launchctl kickstart -k gui/$(id -u)/com.synthos.admin"
  exit 0
}

mkdir -p "${LOG_DIR}" 2>/dev/null

say "--- SynthOS Admin service start ---"

# --- Preconditions -------------------------------------------------------
[[ -x "${NODE_BIN}" ]] || refuse "Node runtime not found or not executable at ${NODE_BIN}"
[[ -d "${REPO}" ]]     || refuse "Canonical repository directory is missing: ${REPO}"

cd "${REPO}" || refuse "Cannot enter canonical working directory ${REPO}"

# One normalized runtime, recorded at every start so a silent version change
# is visible in the log instead of being inferred from a later failure.
NODE_VERSION="$(${NODE_BIN} -v 2>/dev/null)"
NODE_REAL="$(cd "$(dirname "$(readlink "${NODE_BIN}" || print -r -- "${NODE_BIN}")")" 2>/dev/null && pwd)/node"
say "node ${NODE_VERSION} (${NODE_BIN} -> ${NODE_REAL})"
say "cwd  $(pwd)"

# --- Configuration (secrets stay out of argv and out of the plist) -------
if [[ -f "${ENV_FILE}" ]]; then
  perms="$(stat -f '%Lp' "${ENV_FILE}")"
  if [[ "${perms}" != "600" ]]; then
    say "WARNING: ${ENV_FILE} is mode ${perms}, expected 600. Tightening it."
    chmod 600 "${ENV_FILE}" 2>/dev/null
  fi
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
  say "loaded configuration from ${ENV_FILE} (values not logged)"
else
  refuse "Missing configuration file ${ENV_FILE}. Copy it from docs/deploy/ALWAYS-ON-LOCAL-RUNTIME.md."
fi

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3000}"
export HOST PORT

# --- Canonical database --------------------------------------------------
# Resolved and checked here rather than discovered at first write, so a
# wrong or unwritable path is a refusal at startup instead of a subsystem
# that reports healthy until the first real writeback.
DB_PATH="${SYNTHOS_DB_PATH:-${REPO}/data/synthos-admin.db}"
DB_DIR="$(dirname "${DB_PATH}")"
[[ -d "${DB_DIR}" ]] || refuse "Database directory does not exist: ${DB_DIR}"
[[ -w "${DB_DIR}" ]] || refuse "Database directory is not writable: ${DB_DIR}"
if [[ -e "${DB_PATH}" && ! -w "${DB_PATH}" ]]; then
  refuse "Database exists but is not writable: ${DB_PATH}"
fi
say "database ${DB_PATH}"

# --- Single instance -----------------------------------------------------
# launchd already guarantees one copy of THIS job. The real duplicate risk is
# a second admin started some other way (npm run dev in a terminal, an IDE
# task, or another project on the same port) — two processes writing the same
# SQLite file and both running the scheduler. Refuse rather than race.
HOLDER="$(lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t 2>/dev/null | head -1)"
if [[ -n "${HOLDER}" ]]; then
  HOLDER_CMD="$(ps -p "${HOLDER}" -o command= 2>/dev/null)"
  HOLDER_CWD="$(lsof -a -p "${HOLDER}" -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2-)"
  refuse "Port ${PORT} is already held by PID ${HOLDER} (cwd ${HOLDER_CWD:-unknown}): ${HOLDER_CMD}"
fi

# --- Execution mode ------------------------------------------------------
# Default is the development server with HMR and file watching switched OFF:
# no websocket port, no watcher, and identical auth behaviour to the way this
# app is already run by hand — which is the configuration actually proven on
# this machine.
#
# SYNTHOS_SERVICE_MODE=production serves the prebuilt bundle in dist/ instead.
# That is leaner, but NODE_ENV=production also makes the session cookie
# Secure, and a Secure cookie over plain http://127.0.0.1 is accepted by
# Chrome and Firefox but not reliably by every browser. Switch to it only
# after confirming you can still log in.
MODE="${SYNTHOS_SERVICE_MODE:-development}"

# --- Running-version evidence (reported by /api/ready) -------------------
# Stamped here, from the exact code about to run, never by the server:
#   production  — the manifest `npm run build` wrote next to the bundle;
#   development — this checkout, with a SHA ONLY if `git status` is clean.
# Only validated SYNTHOS_BUILD_* lines are exported. Anything missing reads
# UNKNOWN in /api/ready; nothing is inferred.
unset SYNTHOS_BUILD_SHA SYNTHOS_BUILD_TIME SYNTHOS_BUILD_REF SYNTHOS_BUILD_TREE SYNTHOS_BUILD_SOURCE
if [[ "${MODE}" == "production" ]]; then
  BUILD_LINES="$("${NODE_BIN}" "${REPO}/scripts/write-build-info.mjs" --from dist/build-info.json --shell 2>/dev/null)"
else
  BUILD_LINES="$(PATH="/usr/bin:${PATH}" "${NODE_BIN}" "${REPO}/scripts/write-build-info.mjs" --shell 2>/dev/null)"
fi
for line in ${(f)BUILD_LINES}; do
  if [[ "${line}" =~ '^SYNTHOS_BUILD_(SHA|TIME|REF|TREE|SOURCE)=[A-Za-z0-9._:/-]+$' ]]; then
    export "${line}"
  fi
done
say "version commit=${SYNTHOS_BUILD_SHA:-UNKNOWN} tree=${SYNTHOS_BUILD_TREE:-UNKNOWN} ref=${SYNTHOS_BUILD_REF:-UNKNOWN}"

if [[ "${MODE}" == "production" ]]; then
  [[ -f "${REPO}/dist/server.cjs" ]] || refuse "SYNTHOS_SERVICE_MODE=production but dist/server.cjs is missing. Run: npm run build"
  [[ -f "${REPO}/dist/index.html" ]] || refuse "SYNTHOS_SERVICE_MODE=production but dist/index.html is missing. Run: npm run build"
  export NODE_ENV=production
  say "mode production — serving ${REPO}/dist, listening on ${HOST}:${PORT}"
  exec "${NODE_BIN}" "${REPO}/dist/server.cjs"
fi

[[ -f "${REPO}/server.ts" ]] || refuse "server.ts is missing from ${REPO}"
[[ -f "${REPO}/node_modules/tsx/dist/cli.mjs" ]] || refuse "tsx is not installed in ${REPO}/node_modules. Run: npm install"

unset NODE_ENV
export DISABLE_HMR=true
say "mode development (HMR and file watching disabled) — listening on ${HOST}:${PORT}"
exec "${NODE_BIN}" "${REPO}/node_modules/tsx/dist/cli.mjs" "${REPO}/server.ts"
