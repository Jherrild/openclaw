#!/usr/bin/env bash
# Sentinel shell wrapper — activates venv and runs sentinel.py
# Designed for task-orchestrator / interrupt-wrapper.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/.venv/bin/activate"
exec python3 "$SCRIPT_DIR/sentinel.py" "$@"
