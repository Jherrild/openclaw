#!/usr/bin/env bash
# copilot-lock.sh — Mutex wrapper for Copilot CLI (v3)
# Ensures only one Copilot CLI instance runs at a time.
# Hardcodes model, flags, and session transcript. Magnus only provides -p "task".
#
# Usage: bash copilot-lock.sh -p "Fix the bug"
#        bash copilot-lock.sh -p "Fix the bug" --add-dir /path/to/repo
#        bash copilot-lock.sh --continue
#        bash copilot-lock.sh --resume <session-id>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$HOME/.openclaw/workspace"
LOCKFILE="${SCRIPT_DIR}/.copilot.lock"
COPILOT_BIN="${COPILOT_BIN:-copilot}"
INTERRUPT_CLI="${SCRIPT_DIR}/../interrupt-service/interrupt-cli.js"
SESSION_DIR="${SCRIPT_DIR}/sessions"

# --- Hardcoded defaults (not overridable by Magnus) ---
MODEL="claude-opus-4.6"
SHARE_PATH="${SESSION_DIR}/$(date +%s).md"

# --- Suffix appended to every prompt ---
SUFFIX='
When finished, overwrite skills/copilot-delegate/last-result.md with a brief summary (keep under 300 words — Magnus has limited context):
- What you understood the task to be
- What you did
- Status: Success/Partial/Failed
- Follow-up items

Auto-commit changed files with conventional commit messages.'

# --- Parse arguments ---
NOTIFY_SESSION="${OPENCLAW_SESSION_ID:-main}"
COPILOT_EXECUTED=false
USER_PROMPT=""
PASSTHROUGH_ARGS=()
IS_RESUME=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --notify-session)
      NOTIFY_SESSION="${2:?--notify-session requires a session ID}"
      shift 2
      ;;
    -p)
      USER_PROMPT="${2:?-p requires a prompt}"
      shift 2
      ;;
    --resume)
      IS_RESUME=true
      PASSTHROUGH_ARGS+=("$1" "${2:?--resume requires a session ID}")
      shift 2
      ;;
    --continue)
      IS_RESUME=true
      PASSTHROUGH_ARGS+=("$1")
      shift
      ;;
    --add-dir)
      PASSTHROUGH_ARGS+=("$1" "${2:?--add-dir requires a path}")
      shift 2
      ;;
    *)
      PASSTHROUGH_ARGS+=("$1")
      shift
      ;;
  esac
done

# Validate: need either a prompt or a resume flag
if [[ -z "$USER_PROMPT" && "$IS_RESUME" != "true" ]]; then
  echo "Error: Provide -p \"task\" or --resume/--continue" >&2
  exit 1
fi

# Build the copilot arguments
COPILOT_ARGS=(--model "$MODEL" --allow-all --share "$SHARE_PATH")

if [[ -n "$USER_PROMPT" ]]; then
  export COPILOT_MODE="delegated"
  COPILOT_ARGS+=(-p "${USER_PROMPT}

${SUFFIX}")
fi

COPILOT_ARGS+=("${PASSTHROUGH_ARGS[@]}")

# --- Configuration ---
MAX_WAIT_SECS="${COPILOT_LOCK_TIMEOUT:-600}"   # 10 min max wait
INITIAL_BACKOFF=2                               # Start at 2s
MAX_BACKOFF=30                                  # Cap at 30s
STALE_AGE_SECS="${COPILOT_LOCK_STALE:-300}"    # 5 min stale threshold

# --- Helpers ---
log() { echo "[copilot-lock] $(date '+%H:%M:%S') $*" >&2; }

is_pid_alive() {
  kill -0 "$1" 2>/dev/null
}

lock_is_stale() {
  local lock_pid lock_ts now age
  if [[ ! -f "$LOCKFILE" ]]; then
    return 0
  fi
  lock_pid=$(head -1 "$LOCKFILE" 2>/dev/null | cut -d= -f2)
  lock_ts=$(sed -n '2p' "$LOCKFILE" 2>/dev/null | cut -d= -f2)

  # If lock file is malformed, treat as stale
  if [[ -z "$lock_pid" || -z "$lock_ts" ]]; then
    log "Lock file malformed — treating as stale"
    return 0
  fi

  # If owning PID is dead, lock is stale
  if ! is_pid_alive "$lock_pid"; then
    log "Lock owner PID $lock_pid is dead — stale lock"
    return 0
  fi

  # If lock is older than threshold, treat as stale
  now=$(date +%s)
  age=$(( now - lock_ts ))
  if (( age > STALE_AGE_SECS )); then
    log "Lock age ${age}s exceeds stale threshold ${STALE_AGE_SECS}s — stale lock"
    return 0
  fi

  return 1
}

acquire_lock() {
  # Atomic lock: mkdir is atomic on POSIX filesystems
  # We use a .lock directory for atomicity, then write metadata inside it
  local lock_dir="${LOCKFILE}.d"

  if mkdir "$lock_dir" 2>/dev/null; then
    # Won the race — write lock metadata
    echo "pid=$$" > "$LOCKFILE"
    echo "ts=$(date +%s)" >> "$LOCKFILE"
    echo "session=${COPILOT_SESSION_ID:-unknown}" >> "$LOCKFILE"
    rmdir "$lock_dir"
    return 0
  fi
  # Someone else holds it (or dir already exists from a crash)
  # Clean up stale mkdir lock too
  if [[ -d "$lock_dir" ]]; then
    local dir_age
    dir_age=$(( $(date +%s) - $(stat -c %Y "$lock_dir" 2>/dev/null || echo 0) ))
    if (( dir_age > 10 )); then
      rmdir "$lock_dir" 2>/dev/null || true
    fi
  fi
  return 1
}

release_lock() {
  if [[ -f "$LOCKFILE" ]]; then
    local lock_pid
    lock_pid=$(head -1 "$LOCKFILE" 2>/dev/null | cut -d= -f2)
    # Only remove if we own it
    if [[ "$lock_pid" == "$$" ]]; then
      rm -f "$LOCKFILE"
      log "Lock released"
    fi
  fi
  # Clean up atomic dir if it exists (crash recovery)
  rmdir "${LOCKFILE}.d" 2>/dev/null || true
}

# --- Interrupt Notification ---
notify_completion() {
  local exit_code="$1"

  # Only notify if copilot was actually executed
  if [[ "$COPILOT_EXECUTED" != "true" ]]; then
    return 0
  fi

  local status="Success"
  local level="info"
  if [[ "$exit_code" -ne 0 ]]; then
    status="Failure"
    level="warn"
  fi

  if ! command -v node &>/dev/null || [[ ! -f "$INTERRUPT_CLI" ]]; then
    log "Interrupt CLI not available — skipping notification"
    return 0
  fi

  local msg="[copilot-delegate] ${status} (exit ${exit_code}). See skills/copilot-delegate/last-result.md"

  # Add a one-off rule targeting the notify session, then trigger the event
  node "$INTERRUPT_CLI" add \
    --source copilot.task_complete \
    --session-id "$NOTIFY_SESSION" \
    --one-off \
    --action message \
    --message "$msg" \
    --label "Copilot ${status}" \
    --skip-validation 2>/dev/null || true

  node "$INTERRUPT_CLI" trigger \
    --source copilot.task_complete \
    --message "$msg" \
    --level "$level" 2>/dev/null || true

  log "Interrupt sent (${status}, session: ${NOTIFY_SESSION})"
}

cleanup() {
  local exit_code=$?
  notify_completion "$exit_code"
  release_lock
  exit "$exit_code"
}

# --- Main ---

# Trap ensures lock is ALWAYS released on exit, error, or signal
trap cleanup EXIT INT TERM HUP

waited=0
backoff=$INITIAL_BACKOFF

while true; do
  # Clear stale locks before attempting acquisition
  if [[ -f "$LOCKFILE" ]] && lock_is_stale; then
    log "Removing stale lock"
    rm -f "$LOCKFILE"
  fi

  if acquire_lock; then
    log "Lock acquired (PID $$)"
    break
  fi

  # Lock is held by a live process — wait with backoff
  if (( waited >= MAX_WAIT_SECS )); then
    log "ERROR: Timed out after ${waited}s waiting for lock"
    log "Lock contents:"
    cat "$LOCKFILE" >&2 2>/dev/null || true
    exit 1
  fi

  lock_pid=$(head -1 "$LOCKFILE" 2>/dev/null | cut -d= -f2 || echo "unknown")
  log "Waiting for lock (held by PID $lock_pid) — backoff ${backoff}s (${waited}/${MAX_WAIT_SECS}s elapsed)"
  sleep "$backoff"
  waited=$(( waited + backoff ))
  backoff=$(( backoff * 2 ))
  if (( backoff > MAX_BACKOFF )); then
    backoff=$MAX_BACKOFF
  fi
done

# Execute copilot from workspace directory (required for copilot-instructions.md)
mkdir -p "$SESSION_DIR"
COPILOT_EXECUTED=true
log "Executing: $COPILOT_BIN ${COPILOT_ARGS[*]:-}"
cd "$WORKSPACE_DIR"
"$COPILOT_BIN" "${COPILOT_ARGS[@]}"
