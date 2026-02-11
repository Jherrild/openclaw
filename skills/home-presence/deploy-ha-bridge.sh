#!/usr/bin/env bash
# deploy-ha-bridge.sh — Reload systemd and restart the ha-bridge service.
# Run after updating ha-bridge.js or ha-bridge.service.
set -euo pipefail

echo "==> Reloading systemd user daemon..."
systemctl --user daemon-reload

echo "==> Restarting ha-bridge.service..."
systemctl --user restart ha-bridge.service

echo "==> Waiting 3s for startup..."
sleep 3

echo "==> Service status:"
systemctl --user status ha-bridge.service --no-pager || true

echo ""
echo "==> Lockfile check:"
LOCK="/run/user/$(id -u)/ha-bridge/ha-bridge.lock"
if [ -f "$LOCK" ]; then
  echo "  Lockfile exists: $LOCK (PID=$(cat "$LOCK"))"
else
  echo "  WARNING: Lockfile not found at $LOCK"
fi

echo ""
echo "Done. Check logs with: journalctl --user -u ha-bridge.service -f"
