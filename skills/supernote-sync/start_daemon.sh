#!/bin/bash
# start_daemon.sh — Register and start the supernote-sync daemon via task-orchestrator.
#
# Usage: bash skills/supernote-sync/start_daemon.sh [--interval=5m]
#
# This registers check-and-sync.sh as a recurring task with the interrupt service,
# using obsidian_sync_prompt.md as the agent instruction file (editable without re-registering).

set -euo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SKILL_DIR="$(dirname "$SCRIPT_PATH")"
ORCHESTRATOR="$SKILL_DIR/../task-orchestrator/orchestrator.js"

# Parse interval from args (default 5m)
INTERVAL="5m"
for arg in "$@"; do
  case "$arg" in
    --interval=*) INTERVAL="${arg#*=}" ;;
  esac
done

# Remove existing task if present (idempotent re-registration)
node "$ORCHESTRATOR" remove supernote-sync 2>/dev/null || true

# Register with interrupt-file pointing at the agent prompt
node "$ORCHESTRATOR" add supernote-sync "$SKILL_DIR/check-and-sync.sh" \
  --interval="$INTERVAL" \
  --working-dir="$SKILL_DIR" \
  --interrupt-file="$SKILL_DIR/obsidian_sync_prompt.md"

echo "supernote-sync daemon registered (interval=$INTERVAL, interrupt-file=obsidian_sync_prompt.md)"
