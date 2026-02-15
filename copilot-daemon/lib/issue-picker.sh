#!/usr/bin/env bash
# issue-picker.sh — Find the next actionable issue for copilot-daemon
#
# Outputs JSON: { "number": N, "title": "...", "stage": "draft-prd|review-prd|approved", "body": "..." }
# Outputs nothing if no actionable issue found.
#
# Usage: bash issue-picker.sh [--repo owner/repo]
set -euo pipefail

REPO_FLAG="${COPILOT_DAEMON_REPO_FLAG:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO_FLAG="--repo ${2:?--repo requires owner/repo}"; shift 2 ;;
    *) shift ;;
  esac
done

# Validate auth first
if ! gh auth status &>/dev/null; then
  echo "[issue-picker] ERROR: gh auth expired" >&2
  exit 1
fi

# Query all issues with actionable copilot labels, assigned to current user
ISSUES=$(gh issue list \
  --assignee @me \
  --state open \
  --json number,title,labels,body,comments \
  --limit 50 \
  $REPO_FLAG 2>/dev/null || echo "[]")

if [[ "$ISSUES" == "[]" || -z "$ISSUES" ]]; then
  exit 0  # Nothing to do
fi

# Find the oldest issue with an actionable label
# Priority: copilot:approved > copilot:review-prd > copilot:draft-prd
# (Higher stages first — don't start new work when existing work needs finishing)
RESULT=$(echo "$ISSUES" | jq -r '
  [.[] | 
    {
      number: .number,
      title: .title,
      body: .body,
      comments: (.comments // []),
      labels: [.labels[].name],
      stage: (
        if [.labels[].name] | any(. == "copilot:approved") then "approved"
        elif [.labels[].name] | any(. == "copilot:review-prd") then "review-prd"
        elif [.labels[].name] | any(. == "copilot:draft-prd") then "draft-prd"
        else null
        end
      )
    } | select(.stage != null)
    # Skip in-progress and blocked
    | select([.labels[] | select(. == "copilot:in-progress" or . == "copilot:blocked")] | length == 0)
  ]
  # Sort: approved first, then review-prd, then draft-prd. Within same stage, oldest first.
  | sort_by(
      (if .stage == "approved" then 0 elif .stage == "review-prd" then 1 else 2 end),
      .number
    )
  | .[0] // empty
')

if [[ -n "$RESULT" ]]; then
  echo "$RESULT"
fi
