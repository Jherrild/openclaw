#!/usr/bin/env bash
# run-once.sh — Process the next actionable issue and exit
#
# Usage: bash run-once.sh [--repo owner/repo] [--dry-run]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/lib"

# Default copilot wrapper — configurable via env
COPILOT_CMD="${COPILOT_DAEMON_LOCK_CMD:-copilot}"
DRY_RUN=false

# Parse args
export COPILOT_DAEMON_REPO_FLAG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      export COPILOT_DAEMON_REPO_FLAG="--repo ${2:?--repo requires owner/repo}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

log() { echo "[run-once] $(date '+%H:%M:%S') $*"; }

# 1. Validate auth
if ! gh auth status &>/dev/null; then
  log "ERROR: gh is not authenticated"
  exit 1
fi

# 2. Find next actionable issue
log "Looking for actionable issues..."
ISSUE=$(bash "${LIB_DIR}/issue-picker.sh")

if [[ -z "$ISSUE" ]]; then
  log "No actionable issues found."
  exit 0
fi

ISSUE_NUM=$(echo "$ISSUE" | jq -r '.number')
ISSUE_TITLE=$(echo "$ISSUE" | jq -r '.title')
STAGE=$(echo "$ISSUE" | jq -r '.stage')

log "Found issue #${ISSUE_NUM}: \"${ISSUE_TITLE}\" (stage: ${STAGE})"

# 3. Verify issue still exists and is open
if ! gh issue view "$ISSUE_NUM" --json state -q '.state' $COPILOT_DAEMON_REPO_FLAG 2>/dev/null | grep -q OPEN; then
  log "Issue #${ISSUE_NUM} is no longer open — skipping"
  exit 0
fi

# 4. Build prompt
log "Building prompt for stage: ${STAGE}..."
PROMPT=$(bash "${LIB_DIR}/prompt-builder.sh" "$ISSUE_NUM" "$STAGE")

if [[ -z "$PROMPT" ]]; then
  log "ERROR: prompt-builder returned empty prompt"
  exit 1
fi

# Dry run: print prompt and exit
if [[ "$DRY_RUN" == "true" ]]; then
  log "DRY RUN — would process issue #${ISSUE_NUM} (stage: ${STAGE})"
  echo ""
  echo "=== PROMPT ==="
  echo "$PROMPT"
  echo "=== END PROMPT ==="
  exit 0
fi

# 5. Set in-progress label
bash "${LIB_DIR}/label-manager.sh" set-stage "$ISSUE_NUM" "in-progress"

# 6. Comment on issue that work is starting
gh issue comment "$ISSUE_NUM" --body "🤖 Copilot picking up this issue (stage: ${STAGE}). Started at $(date -u '+%Y-%m-%dT%H:%M:%SZ')" $COPILOT_DAEMON_REPO_FLAG 2>/dev/null || true

# 7. Notify via hook (if configured)
bash "${LIB_DIR}/notifier.sh" "Copilot picked up issue #${ISSUE_NUM}: ${ISSUE_TITLE} (stage: ${STAGE})"

# 8. Delegate to Copilot
log "Delegating to Copilot..."
EXIT_CODE=0
$COPILOT_CMD -p "$PROMPT" --model claude-opus-4.6 --allow-all || EXIT_CODE=$?

log "Copilot exited with code: ${EXIT_CODE}"

# 9. Post-run: daemon owns label transition
bash "${LIB_DIR}/label-manager.sh" post-run "$ISSUE_NUM" "$STAGE" "$EXIT_CODE"

# 10. Notify completion
if [[ "$EXIT_CODE" -eq 0 ]]; then
  bash "${LIB_DIR}/notifier.sh" "Copilot completed issue #${ISSUE_NUM}: ${ISSUE_TITLE} (stage: ${STAGE})"
else
  bash "${LIB_DIR}/notifier.sh" "Copilot failed on issue #${ISSUE_NUM}: ${ISSUE_TITLE} (exit: ${EXIT_CODE})"
fi

log "Done."
