#!/usr/bin/env bash
# copilot-lock.sh — Mutex wrapper for Copilot CLI
# Ensures only one Copilot CLI instance runs at a time via lock file.
# All arguments are passed through to the copilot CLI.
#
# Usage: bash copilot-lock.sh [copilot args...]
# Example: bash copilot-lock.sh -p "Fix the bug" --model claude-opus-4.6 --allow-all

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCKFILE="${SCRIPT_DIR}/.copilot.lock"
COPILOT_BIN="${COPILOT_BIN:-copilot}"

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

cleanup() {
  local exit_code=$?
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

# Execute copilot with all passed arguments
log "Executing: $COPILOT_BIN $*"
"$COPILOT_BIN" "$@"
