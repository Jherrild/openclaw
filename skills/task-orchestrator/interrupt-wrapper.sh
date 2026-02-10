#!/bin/bash
# interrupt-wrapper.sh — Wraps a task script and fires an interrupt if it produces stdout.
#
# Usage: interrupt-wrapper.sh <task-name> <interrupt-mode> <interrupt-value> <script> [args...]
#
# Arguments:
#   task-name        Task name (used as interrupt source: task.<name>)
#   interrupt-mode   "inline" or "file"
#   interrupt-value  The inline "level: instruction" string, OR path to interrupt file
#   script           The actual script to run
#   args...          Arguments to pass to the script
#
# Contract:
#   - Exit 0 + stdout has content  → fire interrupt with stdout as message
#   - Exit 0 + no stdout           → stay silent (nothing happened)
#   - Exit non-zero                → script failed, log to stderr, do NOT fire interrupt
#
# The interrupt instruction is read at trigger time (not registration time),
# so modifying the interrupt-file changes behavior of already-registered tasks.

set -uo pipefail

# Ensure linuxbrew tools (jq, node) and npm-global (openclaw CLI) are in PATH for systemd
export PATH="/home/linuxbrew/.linuxbrew/bin:/home/jherrild/.npm-global/bin:$PATH"

TASK_NAME="$1"
INTERRUPT_MODE="$2"
INTERRUPT_VALUE="$3"
shift 3
SCRIPT="$1"
shift

# Resolve interrupt-cli.js path (relative to this wrapper)
WRAPPER_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
INTERRUPT_CLI="$(dirname "$WRAPPER_DIR")/interrupt-service/interrupt-cli.js"

# Run the actual script, capturing stdout (stderr passes through to journal)
STDOUT_FILE=$(mktemp)
trap 'rm -f "$STDOUT_FILE"' EXIT

# Run script, tee stdout to capture file while also sending to journal
"$SCRIPT" "$@" > "$STDOUT_FILE" 2>&1
EXIT_CODE=$?

# Also echo captured output to journal for visibility
if [ -s "$STDOUT_FILE" ]; then
  cat "$STDOUT_FILE"
fi

# Only fire interrupt on success + non-empty stdout
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "[interrupt-wrapper] Script exited with code $EXIT_CODE — no interrupt fired" >&2
  exit "$EXIT_CODE"
fi

if [ ! -s "$STDOUT_FILE" ]; then
  # Success but no output — nothing to report
  exit 0
fi

# Read interrupt config
LEVEL="alert"
INSTRUCTION=""

if [ "$INTERRUPT_MODE" = "file" ]; then
  if [ ! -f "$INTERRUPT_VALUE" ]; then
    echo "[interrupt-wrapper] WARNING: interrupt file not found: $INTERRUPT_VALUE" >&2
    exit 0
  fi
  CONTENT=$(cat "$INTERRUPT_VALUE")
  # Parse "level: instruction" format
  if echo "$CONTENT" | grep -q '^[a-z]*:'; then
    LEVEL=$(echo "$CONTENT" | head -1 | cut -d: -f1 | tr -d ' ')
    INSTRUCTION=$(echo "$CONTENT" | head -1 | cut -d: -f2- | sed 's/^ *//')
    # If file has more lines, append them to instruction
    REST=$(echo "$CONTENT" | tail -n +2)
    if [ -n "$REST" ]; then
      INSTRUCTION="$INSTRUCTION
$REST"
    fi
  else
    INSTRUCTION="$CONTENT"
  fi
elif [ "$INTERRUPT_MODE" = "inline" ]; then
  # Parse "level: instruction" format
  if echo "$INTERRUPT_VALUE" | grep -q '^[a-z]*:'; then
    LEVEL=$(echo "$INTERRUPT_VALUE" | cut -d: -f1 | tr -d ' ')
    INSTRUCTION=$(echo "$INTERRUPT_VALUE" | cut -d: -f2- | sed 's/^ *//')
  else
    INSTRUCTION="$INTERRUPT_VALUE"
  fi
fi

# Build the message from script stdout
MESSAGE=$(cat "$STDOUT_FILE")

# Build data payload with instruction if present
if [ -n "$INSTRUCTION" ]; then
  DATA=$(jq -n --arg msg "$MESSAGE" --arg inst "$INSTRUCTION" '{"message": $msg, "instruction": $inst}')
else
  DATA=$(jq -n --arg msg "$MESSAGE" '{"message": $msg}')
fi

# Fire the interrupt
node "$INTERRUPT_CLI" trigger \
  --source "task.${TASK_NAME}" \
  --data "$DATA" \
  --level "$LEVEL"

echo "[interrupt-wrapper] Interrupt fired for task.${TASK_NAME} (level=$LEVEL)"
