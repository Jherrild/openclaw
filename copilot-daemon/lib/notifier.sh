#!/usr/bin/env bash
# notifier.sh — Optional notification hook for copilot-daemon
#
# Usage: bash notifier.sh <message>
#
# If COPILOT_DAEMON_NOTIFY_CMD is set, executes it with {{message}} replaced.
# Otherwise, does nothing (notifications are via GitHub issue comments only).
set -euo pipefail

MESSAGE="${1:-}"
if [[ -z "$MESSAGE" ]]; then
  exit 0
fi

NOTIFY_CMD="${COPILOT_DAEMON_NOTIFY_CMD:-}"
if [[ -z "$NOTIFY_CMD" ]]; then
  exit 0  # No notification hook configured
fi

# Replace {{message}} placeholder in the command
RESOLVED_CMD="${NOTIFY_CMD//\{\{message\}\}/$MESSAGE}"

eval "$RESOLVED_CMD" 2>/dev/null || true
