#!/usr/bin/env bash
# Launch Chromium full-screen kiosk pointed at the local dashboard.
# Waits for the backend, disables screen blanking, and enables autoplay so the
# closing chimes can sound without user interaction.
set -e

export DISPLAY="${DISPLAY:-:0}"
# If the TV overscans (crops the edges), add ?inset=32 — or whatever the crop
# measures — to pull the whole layout inside the visible frame.
URL="${DASHBOARD_URL:-http://localhost:3000/}"

# Wait until the dashboard server is serving.
until curl -sf "$URL" >/dev/null 2>&1; do
  echo "waiting for dashboard at $URL ..."
  sleep 2
done

# Disable screen blanking / power management (best-effort).
xset s off || true
xset -dpms || true
xset s noblank || true

# Hide the mouse pointer when idle, if available.
if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 1 &
fi

# Find a Chromium/Chrome binary.
CHROME="$(command -v chromium-browser || command -v chromium || command -v google-chrome || command -v google-chrome-stable || true)"
if [ -z "$CHROME" ]; then
  echo "ERROR: no chromium/chrome binary found" >&2
  exit 1
fi

# A fresh profile dir avoids the "restore pages?" prompt after power loss.
PROFILE="${HOME}/.datalab-kiosk-profile"

exec "$CHROME" \
  --kiosk \
  --incognito \
  --noerrordialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=Translate,InfiniteSessionRestore \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  --user-data-dir="$PROFILE" \
  --app="$URL"
