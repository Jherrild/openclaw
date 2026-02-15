#!/usr/bin/env bash
# init.sh — Initialize copilot-daemon for a repository
# Creates required GitHub labels and validates auth.
#
# Usage: bash init.sh [--repo owner/repo]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_FLAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO_FLAG="--repo ${2:?--repo requires owner/repo}"; shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

log() { echo "[init] $*"; }

# Validate gh auth
if ! gh auth status &>/dev/null; then
  log "ERROR: gh is not authenticated. Run: gh auth login"
  exit 1
fi
log "✓ gh authenticated as $(gh api user -q .login)"

# Validate copilot CLI
COPILOT_CMD="${COPILOT_DAEMON_LOCK_CMD:-copilot}"
if ! command -v "$COPILOT_CMD" &>/dev/null; then
  log "ERROR: copilot CLI not found. Install: npm i -g @github/copilot"
  exit 1
fi
log "✓ copilot CLI available"

# Create labels (idempotent — gh label create skips if exists)
LABELS=(
  "copilot:draft-prd|Stage 1: Draft PRD|0E8A16"
  "copilot:review-prd|Stage 2: Self-review PRD|FBCA04"
  "copilot:ready|Stage 3: Awaiting human approval|D93F0B"
  "copilot:approved|Stage 4: Approved for implementation|1D76DB"
  "copilot:in-progress|Currently being worked on|BFD4F2"
  "copilot:blocked|Blocked — needs human input|B60205"
  "copilot:done|Work complete|0E8A16"
)

for entry in "${LABELS[@]}"; do
  IFS='|' read -r name desc color <<< "$entry"
  if gh label create "$name" --description "$desc" --color "$color" $REPO_FLAG 2>/dev/null; then
    log "✓ Created label: $name"
  else
    log "  Label exists: $name"
  fi
done

log ""
log "✓ Initialization complete. Create an issue with the 'copilot:draft-prd' label to start."
