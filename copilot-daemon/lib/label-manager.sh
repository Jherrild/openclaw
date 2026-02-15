#!/usr/bin/env bash
# label-manager.sh — Manage GitHub issue labels for copilot-daemon
#
# The daemon owns ALL label transitions. Copilot never touches labels.
#
# Usage:
#   bash label-manager.sh set-stage <issue_num> <stage>
#   bash label-manager.sh post-run <issue_num> <previous_stage> <exit_code>
#   bash label-manager.sh check-human-comment <issue_num>
set -euo pipefail

REPO_FLAG="${COPILOT_DAEMON_REPO_FLAG:-}"

# Known bot authors that should NOT trigger human feedback detection
BOT_ALLOWLIST="${COPILOT_DAEMON_BOT_ALLOWLIST:-github-actions[bot],dependabot[bot],copilot[bot]}"

ALL_COPILOT_LABELS="copilot:draft-prd,copilot:review-prd,copilot:ready,copilot:approved,copilot:in-progress,copilot:blocked,copilot:done"

log() { echo "[label-manager] $*" >&2; }

# Remove all copilot: labels, then add the target one
set_stage() {
  local issue_num="$1"
  local target_stage="$2"
  local target_label="copilot:${target_stage}"

  # Remove existing copilot labels
  for label in $(echo "$ALL_COPILOT_LABELS" | tr ',' ' '); do
    gh issue edit "$issue_num" --remove-label "$label" $REPO_FLAG 2>/dev/null || true
  done

  # Add target label
  gh issue edit "$issue_num" --add-label "$target_label" $REPO_FLAG 2>/dev/null || true
  log "Issue #$issue_num → $target_label"
}

# After Copilot finishes, determine next stage based on previous stage + exit code
post_run() {
  local issue_num="$1"
  local prev_stage="$2"
  local exit_code="${3:-0}"

  # If Copilot crashed, set blocked
  if [[ "$exit_code" -ne 0 ]]; then
    set_stage "$issue_num" "blocked"
    gh issue comment "$issue_num" --body "🤖 Copilot session failed (exit code $exit_code). Stage: $prev_stage. Check last-result.md for details." $REPO_FLAG 2>/dev/null || true
    return
  fi

  # Determine next stage based on previous
  case "$prev_stage" in
    draft-prd)
      set_stage "$issue_num" "review-prd"
      ;;
    review-prd)
      # Check if the reviewer found major issues (look for keywords in latest comment)
      local latest_comment
      latest_comment=$(gh issue view "$issue_num" --json comments --jq '.comments[-1].body // ""' $REPO_FLAG 2>/dev/null || echo "")
      if echo "$latest_comment" | grep -qi "major issues\|not ready\|needs redesign\|back to draft"; then
        set_stage "$issue_num" "draft-prd"
        log "Review found major issues — cycling back to draft"
      else
        set_stage "$issue_num" "ready"
      fi
      ;;
    approved)
      # Check if Copilot reported blocked
      local latest_comment
      latest_comment=$(gh issue view "$issue_num" --json comments --jq '.comments[-1].body // ""' $REPO_FLAG 2>/dev/null || echo "")
      if echo "$latest_comment" | grep -qi "blocked\|cannot proceed\|need.*input\|need.*clarification"; then
        set_stage "$issue_num" "blocked"
      else
        set_stage "$issue_num" "done"
      fi
      ;;
    *)
      log "Unknown previous stage: $prev_stage"
      ;;
  esac
}

# Check if a human (non-bot) has commented since the last copilot comment
# Returns 0 if human comment found, 1 if not
check_human_comment() {
  local issue_num="$1"

  # Get the current gh user
  local gh_user
  gh_user=$(gh api user -q .login 2>/dev/null || echo "")

  # Get all comments
  local comments
  comments=$(gh issue view "$issue_num" --json comments --jq '.comments' $REPO_FLAG 2>/dev/null || echo "[]")

  # Find the last comment NOT from the gh user and NOT from a known bot
  local last_human_comment
  last_human_comment=$(echo "$comments" | jq -r --arg user "$gh_user" --arg bots "$BOT_ALLOWLIST" '
    [.[] |
      select(.author.login != $user) |
      select(($bots | split(",")) | any(. == .author.login) | not)
    ] | last // empty
  ')

  if [[ -n "$last_human_comment" ]]; then
    # Check if this comment is newer than the last copilot comment
    local last_bot_time last_human_time
    last_bot_time=$(echo "$comments" | jq -r --arg user "$gh_user" '[.[] | select(.author.login == $user)] | last.createdAt // "1970-01-01T00:00:00Z"')
    last_human_time=$(echo "$last_human_comment" | jq -r '.createdAt // "1970-01-01T00:00:00Z"')

    if [[ "$last_human_time" > "$last_bot_time" ]]; then
      echo "$last_human_comment" | jq -r '.body'
      return 0
    fi
  fi

  return 1
}

# Main dispatch
ACTION="${1:?Usage: label-manager.sh <set-stage|post-run|check-human-comment> <args>}"
shift
case "$ACTION" in
  set-stage) set_stage "$@" ;;
  post-run) post_run "$@" ;;
  check-human-comment) check_human_comment "$@" ;;
  *) echo "Unknown action: $ACTION" >&2; exit 1 ;;
esac
