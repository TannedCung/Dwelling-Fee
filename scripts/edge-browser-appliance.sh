#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISPLAY_ID="${EDGE_DISPLAY:-:99}"
VNC_PORT="${EDGE_VNC_PORT:-5900}"
NOVNC_PORT="${EDGE_NOVNC_PORT:-6080}"
TS_IP="${EDGE_TAILSCALE_IP:-}"
PROFILE_DIR="${EDGE_PROFILE_DIR:-$ROOT_DIR/.edge-profile/default}"
SOLVE_TIMEOUT_MS="${EDGE_SOLVE_TIMEOUT_MS:-900000}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need Xvfb
need x11vnc
need websockify

BIND_IP="${EDGE_BIND_HOST:-${EDGE_TAILSCALE_IP:-}}"
if [[ -z "$BIND_IP" ]]; then
  if command -v tailscale >/dev/null 2>&1; then
    BIND_IP="$(tailscale ip -4 2>/dev/null | head -n 1 || true)"
  fi
fi
if [[ -z "$BIND_IP" ]]; then
  BIND_IP="0.0.0.0"
fi


NOVNC_WEB="${EDGE_NOVNC_WEB:-}"
if [[ -z "$NOVNC_WEB" ]]; then
  for candidate in /usr/share/novnc /usr/share/novnc/www /usr/share/novnc/app; do
    if [[ -f "$candidate/vnc.html" ]]; then
      NOVNC_WEB="$candidate"
      break
    fi
  done
fi
if [[ -z "$NOVNC_WEB" || ! -f "$NOVNC_WEB/vnc.html" ]]; then
  echo "Could not find noVNC web files. Set EDGE_NOVNC_WEB=/path/to/novnc." >&2
  exit 1
fi

if [[ -z "${EDGE_DEVICE_ID:-}" || -z "${EDGE_DEVICE_SECRET:-}" ]]; then
  echo "EDGE_DEVICE_ID and EDGE_DEVICE_SECRET are required." >&2
  echo "Register a device in /collect, then export the one-time credentials." >&2
  exit 1
fi

mkdir -p "$PROFILE_DIR"

PIDS=()

cleanup() {
  if [[ ${#PIDS[@]} -gt 0 ]]; then
    kill "${PIDS[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

echo "Starting virtual display $DISPLAY_ID"
Xvfb "$DISPLAY_ID" -screen 0 "${EDGE_SCREEN:-1365x768x24}" -nolisten tcp &
PIDS+=("$!")
sleep 1

echo "Starting VNC on localhost:$VNC_PORT"
x11vnc -display "$DISPLAY_ID" -localhost -rfbport "$VNC_PORT" -forever -shared -quiet -nopw &
PIDS+=("$!")
sleep 1

echo "Starting noVNC on $BIND_IP:$NOVNC_PORT"
websockify --web "$NOVNC_WEB" "$BIND_IP:$NOVNC_PORT" "127.0.0.1:$VNC_PORT" &
PIDS+=("$!")
sleep 1

export DISPLAY="$DISPLAY_ID"
export EDGE_HEADLESS=false
export EDGE_PROFILE_DIR="$PROFILE_DIR"
export EDGE_SOLVE_TIMEOUT_MS="$SOLVE_TIMEOUT_MS"
export EDGE_REMOTE_BROWSER_URL="${EDGE_REMOTE_BROWSER_URL:-http://$BIND_IP:$NOVNC_PORT/vnc.html?autoconnect=1&resize=remote}"

echo "Remote browser URL: $EDGE_REMOTE_BROWSER_URL"
echo "Starting edge worker"
cd "$ROOT_DIR"
npm run edge:worker &
PIDS+=("$!")
wait "${PIDS[-1]}"
