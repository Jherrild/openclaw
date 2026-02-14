#!/usr/bin/env bash
# log-sentinel.sh — Monitors OpenClaw gateway logs for API failure patterns.
# Designed to run every 5 minutes via systemd timer (task-orchestrator).
#
# Checks journalctl (openclaw-gateway) and flat log files for:
#   - FailoverError
#   - RESOURCE_EXHAUSTED
# Triggers an interrupt if >5 occurrences in the last 5 minutes.

set -euo pipefail

THRESHOLD=5
WINDOW_MINUTES=5
INTERRUPT_CLI="/home/jherrild/.openclaw/workspace/skills/interrupt-service/interrupt-cli.js"
SERVICE_UNIT="openclaw-gateway"
FLAT_LOG="/home/jherrild/.openclaw/logs/commands.log"
ACTIVE_DAILY_LOG="/tmp/openclaw/openclaw-$(date +%Y-%m-%d).log"
PATTERN='FailoverError|RESOURCE_EXHAUSTED'

count=0

# --- Source 1: journalctl (primary, handles rotation natively) ---
if systemctl --user is-active --quiet "$SERVICE_UNIT" 2>/dev/null; then
    journal_hits=$(journalctl --user -u "$SERVICE_UNIT" \
        --since "-${WINDOW_MINUTES}min" --no-pager -q 2>/dev/null \
        | grep -cE "$PATTERN" 2>/dev/null || true)
    count=$((count + journal_hits))
fi

# --- Source 2: Active Daily Log (Specific to current env) ---
if [[ -f "$ACTIVE_DAILY_LOG" ]]; then
    cutoff=$(date -d "-${WINDOW_MINUTES} minutes" '+%Y-%m-%dT%H:%M:%S' 2>/dev/null || true)
    if [[ -n "$cutoff" ]]; then
        active_hits=$(awk -v cutoff="$cutoff" '$0 >= cutoff' "$ACTIVE_DAILY_LOG" \
            | grep -cE "$PATTERN" 2>/dev/null || true)
    else
        active_hits=$(grep -cE "$PATTERN" "$ACTIVE_DAILY_LOG" 2>/dev/null || true)
    fi
    count=$((count + active_hits))
fi

# --- Source 3: flat log file (fallback / supplement) ---
if [[ -f "$FLAT_LOG" ]]; then
    cutoff=$(date -d "-${WINDOW_MINUTES} minutes" '+%Y-%m-%dT%H:%M:%S' 2>/dev/null || true)
    if [[ -n "$cutoff" ]]; then
        # Timestamps in ISO-8601 sort lexicographically; grab recent lines
        flat_hits=$(awk -v cutoff="$cutoff" '$0 >= cutoff' "$FLAT_LOG" \
            | grep -cE "$PATTERN" 2>/dev/null || true)
    else
        # date -d not available; scan entire file (safe but coarse)
        flat_hits=$(grep -cE "$PATTERN" "$FLAT_LOG" 2>/dev/null || true)
    fi
    count=$((count + flat_hits))
fi

# --- Handle rotated log files (e.g. commands.log.1, commands.log.2.gz) ---
for rotated in "${FLAT_LOG}".1 "${FLAT_LOG}".2; do
    [[ -f "$rotated" ]] || continue
    # Only check uncompressed rotated files within the time window
    if [[ -n "${cutoff:-}" ]]; then
        rot_hits=$(awk -v cutoff="$cutoff" '$0 >= cutoff' "$rotated" \
            | grep -cE "$PATTERN" 2>/dev/null || true)
    else
        rot_hits=$(grep -cE "$PATTERN" "$rotated" 2>/dev/null || true)
    fi
    count=$((count + rot_hits))
done

for rotated_gz in "${FLAT_LOG}".*.gz; do
    [[ -f "$rotated_gz" ]] || continue
    if [[ -n "${cutoff:-}" ]]; then
        gz_hits=$(zcat "$rotated_gz" 2>/dev/null \
            | awk -v cutoff="$cutoff" '$0 >= cutoff' \
            | grep -cE "$PATTERN" 2>/dev/null || true)
    else
        gz_hits=$(zgrep -cE "$PATTERN" "$rotated_gz" 2>/dev/null || true)
    fi
    count=$((count + gz_hits))
done

# --- Evaluate and trigger ---
if (( count > THRESHOLD )); then
    echo "[log-sentinel] ALERT: ${count} API failure pattern(s) in last ${WINDOW_MINUTES}m (threshold: ${THRESHOLD})"
    node "$INTERRUPT_CLI" trigger \
        --source "log-sentinel" \
        --data "{\"severity\":\"high\"}" \
        --message "High API failure rate detected in logs. ${count} occurrences of FailoverError/RESOURCE_EXHAUSTED in the last ${WINDOW_MINUTES} minutes."
    exit 0
fi

echo "[log-sentinel] OK: ${count} hit(s) in last ${WINDOW_MINUTES}m (threshold: ${THRESHOLD})"
exit 0
