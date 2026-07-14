#!/usr/bin/env bash
# Boot the server and hit a few endpoints — catches broken requires, bad wiring,
# native-module (better-sqlite3) load failures, and a version mismatch between
# the running app and package.json.
set -euo pipefail

node server.js &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

# Wait for the server to answer (up to ~30s), failing fast if it dies on boot.
for _ in $(seq 1 30); do
  if curl -sf http://localhost:5000/api/version >/dev/null 2>&1; then break; fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "::error::Server process exited during boot"
    exit 1
  fi
  sleep 1
done

VERSION=$(curl -sf http://localhost:5000/api/version \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).version))")
EXPECTED=$(node -p "require('./package.json').version")
echo "server reports version: $VERSION (package.json: $EXPECTED)"
[ "$VERSION" = "$EXPECTED" ] || { echo "::error::version mismatch"; exit 1; }

# Core read-only endpoints should respond.
curl -sf http://localhost:5000/api/model/status >/dev/null || { echo "::error::/api/model/status failed"; exit 1; }
curl -sf http://localhost:5000/api/jobs         >/dev/null || { echo "::error::/api/jobs failed"; exit 1; }

echo "smoke test passed"
