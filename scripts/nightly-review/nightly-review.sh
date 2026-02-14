#!/usr/bin/env bash
# nightly-review.sh — Spawns a Copilot instance to review OpenClaw for improvements.
# Designed to run via task-orchestrator + interrupt-wrapper at 2:00 AM daily.
#
# Uses copilot-lock.sh for mutex safety (won't collide with daytime sessions).
# Reads the review prompt from review-prompt.txt (editable without re-registering).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="$HOME/.openclaw/workspace"
LOCK_WRAPPER="$WORKSPACE/skills/copilot-delegate/copilot-lock.sh"
PROMPT_FILE="$SCRIPT_DIR/review-prompt.txt"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "ERROR: review-prompt.txt not found at $PROMPT_FILE" >&2
  exit 1
fi

REVIEW_PROMPT=$(cat "$PROMPT_FILE")
DATE=$(date +%Y-%m-%d)

# Run copilot with the review prompt via the lock wrapper
# The wrapper handles model selection, --allow-all, --share, and mutex
bash "$LOCK_WRAPPER" -p "Date: ${DATE}

${REVIEW_PROMPT}" \
  --add-dir "$HOME/.openclaw/agents/main/sessions"

# Check if the review produced a last-result.md
RESULT_FILE="$WORKSPACE/skills/copilot-delegate/last-result.md"
if [[ -f "$RESULT_FILE" ]]; then
  # Extract summary from last-result.md for the interrupt
  head -5 "$RESULT_FILE"
else
  echo "Nightly review completed but no last-result.md found."
fi
