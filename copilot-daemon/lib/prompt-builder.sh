#!/usr/bin/env bash
# prompt-builder.sh — Build a tier-specific prompt from issue data + template
#
# Usage: bash prompt-builder.sh <issue_number> <stage> [--repo owner/repo]
#
# Reads the issue, selects the appropriate template, interpolates variables,
# truncates comments, and wraps content in delimiters for safety.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAEMON_DIR="$(dirname "$SCRIPT_DIR")"
PROMPTS_DIR="${DAEMON_DIR}/prompts"
REPO_FLAG="${COPILOT_DAEMON_REPO_FLAG:-}"

MAX_COMMENT_CHARS="${COPILOT_DAEMON_MAX_COMMENT_CHARS:-8000}"
MAX_COMMENTS="${COPILOT_DAEMON_MAX_COMMENTS:-5}"

ISSUE_NUM="${1:?Usage: prompt-builder.sh <issue_number> <stage>}"
STAGE="${2:?Usage: prompt-builder.sh <issue_number> <stage>}"
HUMAN_COMMENT=""

log() { echo "[prompt-builder] $*" >&2; }

# Fetch issue data
ISSUE_JSON=$(gh issue view "$ISSUE_NUM" --json number,title,body,comments $REPO_FLAG 2>/dev/null)
if [[ -z "$ISSUE_JSON" ]]; then
  log "ERROR: Could not fetch issue #$ISSUE_NUM"
  exit 1
fi

NUMBER=$(echo "$ISSUE_JSON" | jq -r '.number')
TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')
BODY=$(echo "$ISSUE_JSON" | jq -r '.body // ""')

# Truncate comments: last N comments, max total chars
COMMENTS=$(echo "$ISSUE_JSON" | jq -r --argjson max "$MAX_COMMENTS" '
  [.comments[-$max:][]] |
  map("[\(.author.login) at \(.createdAt)]:\n\(.body)") |
  join("\n\n---\n\n")
')
# Truncate to max chars
if [[ ${#COMMENTS} -gt $MAX_COMMENT_CHARS ]]; then
  COMMENTS="[...truncated to last ${MAX_COMMENT_CHARS} chars...]\n\n${COMMENTS: -$MAX_COMMENT_CHARS}"
fi

# Select template based on stage
case "$STAGE" in
  draft-prd)
    TEMPLATE_FILE="${PROMPTS_DIR}/draft-prd.md"
    ;;
  review-prd)
    # Check if there's a human comment (revision request) on a copilot:ready issue
    HUMAN_COMMENT=""
    if bash "${SCRIPT_DIR}/label-manager.sh" check-human-comment "$ISSUE_NUM" > /tmp/daemon-human-comment.txt 2>/dev/null; then
      HUMAN_COMMENT=$(cat /tmp/daemon-human-comment.txt)
      TEMPLATE_FILE="${PROMPTS_DIR}/revision.md"
      log "Human feedback detected — using revision template"
    else
      TEMPLATE_FILE="${PROMPTS_DIR}/review-prd.md"
    fi
    ;;
  approved)
    TEMPLATE_FILE="${PROMPTS_DIR}/implement.md"
    ;;
  *)
    log "ERROR: Unknown stage: $STAGE"
    exit 1
    ;;
esac

if [[ ! -f "$TEMPLATE_FILE" ]]; then
  log "ERROR: Template not found: $TEMPLATE_FILE"
  exit 1
fi

# Read template and interpolate
PROMPT=$(cat "$TEMPLATE_FILE")
PROMPT="${PROMPT//\{\{NUMBER\}\}/$NUMBER}"
PROMPT="${PROMPT//\{\{TITLE\}\}/$TITLE}"
PROMPT="${PROMPT//\{\{BODY\}\}/$BODY}"
PROMPT="${PROMPT//\{\{COMMENTS\}\}/$COMMENTS}"
PROMPT="${PROMPT//\{\{HUMAN_COMMENT\}\}/$HUMAN_COMMENT}"

# Clean up
rm -f /tmp/daemon-human-comment.txt

echo "$PROMPT"
