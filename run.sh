#!/usr/bin/env sh
# Linux/macOS launcher: ensures Node.js >= 20.12 (installs it via brew / NodeSource if missing),
# then hands over to bin/cli.js (dependencies, build, .env checks).
# Usage: ./run.sh [server|cmd|generate-all|purge-plaintext|check|prepare]
# All launcher output goes to stderr: stdout is reserved for the MCP JSON-RPC stream.
set -e
cd "$(dirname "$0")"

log() { echo "[mcp-pr-companion] $*" >&2; }

node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=12)?0:1)" 2>/dev/null
}

if ! node_ok; then
  log "Node.js >= 20.12 not found. Installing Node.js 22 LTS..."
  SUDO=""
  [ "$(id -u)" -ne 0 ] && SUDO="sudo"
  if command -v brew >/dev/null 2>&1; then
    brew install node@22 >&2 && brew link --overwrite --force node@22 >&2
  elif command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update >&2 && $SUDO apt-get install -y curl ca-certificates >&2
    curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash - >&2
    $SUDO apt-get install -y nodejs >&2
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | $SUDO bash - >&2
    $SUDO dnf install -y nodejs >&2
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | $SUDO bash - >&2
    $SUDO yum install -y nodejs >&2
  else
    log "No supported package manager (brew/apt-get/dnf/yum). Install Node.js 22 LTS from https://nodejs.org and run again."
    exit 1
  fi
  if ! node_ok; then
    log "Node.js installation failed. Install Node.js 22 LTS from https://nodejs.org and run again."
    exit 1
  fi
fi

exec node bin/cli.js "$@"
