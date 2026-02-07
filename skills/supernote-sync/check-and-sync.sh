#!/bin/bash
set -euo pipefail

SKILL_DIR="$HOME/.openclaw/workspace/skills/supernote-sync"
MAPPING_FILE="$SKILL_DIR/sync-mapping.json"
LOG_FILE="$SKILL_DIR/sync.log"
NODE_PATH_VAL="$HOME/.openclaw/workspace/skills/google-tasks/node_modules"

log() { echo "[$(date -Iseconds)] $*" >> "$LOG_FILE"; }

# Log rotation: keep last 500 lines
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 500 ]; then
  tail -n 500 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

# Initialize mapping if missing
[ -f "$MAPPING_FILE" ] || echo '{"files":[]}' > "$MAPPING_FILE"

# Fetch remote state using the custom authorized script
log "Fetching remote file list using authorized token..."
REMOTE=$(export NODE_PATH=$NODE_PATH_VAL && node "$SKILL_DIR/get_remote_state.js")

if [ -z "$REMOTE" ] || [ "$REMOTE" == "null" ]; then
  log "ERROR: Failed to fetch remote state"
  exit 1
fi

# Track new files
NEW_FILE_IDS=()
UPDATED=0

# Process each remote file
log "Processing remote files..."
while read -r file; do
  FILE_ID=$(echo "$file" | jq -r '.id')
  FILE_NAME=$(echo "$file" | jq -r '.name')
  REMOTE_TS=$(echo "$file" | jq -r '.modifiedTime')
  
  # Check if known in mapping
  LOCAL_ENTRY=$(jq -r --arg id "$FILE_ID" '.files[] | select(.fileId == $id)' "$MAPPING_FILE" 2>/dev/null || echo "")
  
  if [ -n "$LOCAL_ENTRY" ]; then
    # PATH A: Known file - check for updates
    LOCAL_TS=$(echo "$LOCAL_ENTRY" | jq -r '.lastModified')
    LOCAL_PATH=$(echo "$LOCAL_ENTRY" | jq -r '.localPath')
    
    # Convert to epoch for comparison
    REMOTE_EPOCH=$(date -d "$REMOTE_TS" +%s 2>/dev/null || echo 0)
    LOCAL_EPOCH=$(date -d "$LOCAL_TS" +%s 2>/dev/null || echo 0)
    
    if [ "$REMOTE_EPOCH" -gt "$LOCAL_EPOCH" ]; then
      log "PATH A: Updating known file: $FILE_NAME"
      mkdir -p "$(dirname "$LOCAL_PATH")"
      
      if export NODE_PATH=$NODE_PATH_VAL && node "$SKILL_DIR/download_file.js" "$FILE_ID" "$LOCAL_PATH"; then
        jq --arg id "$FILE_ID" --arg ts "$REMOTE_TS" \
          '(.files[] | select(.fileId == $id)).lastModified = $ts' \
          "$MAPPING_FILE" > "$MAPPING_FILE.tmp" && mv "$MAPPING_FILE.tmp" "$MAPPING_FILE"
        log "Updated: $FILE_NAME"
        echo "1" >> "$SKILL_DIR/.updated-count"
      else
        log "ERROR: Failed to download $FILE_NAME"
      fi
    fi
  else
    # PATH B: New file - queue for agent
    log "PATH B: New file detected: $FILE_NAME ($FILE_ID)"
    echo "$FILE_ID" >> "$SKILL_DIR/.new-files-buffer"
  fi
done < <(echo "$REMOTE" | jq -c '.[]')

# Read accumulated new files
if [ -f "$SKILL_DIR/.new-files-buffer" ]; then
  mapfile -t NEW_FILE_IDS < "$SKILL_DIR/.new-files-buffer"
  rm -f "$SKILL_DIR/.new-files-buffer"
fi

# Read updated count
UPDATED=0
if [ -f "$SKILL_DIR/.updated-count" ]; then
  UPDATED=$(wc -l < "$SKILL_DIR/.updated-count")
  rm -f "$SKILL_DIR/.updated-count"
fi

# Wake agent if new files found (with re-wake guard + staleness check)
LOCK_STALE_SECONDS=1800  # 30 minutes
if [ ${#NEW_FILE_IDS[@]} -gt 0 ]; then
  SHOULD_WAKE=false
  if [ -f "$SKILL_DIR/.agent-pending" ]; then
    LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$SKILL_DIR/.agent-pending") ))
    if [ "$LOCK_AGE" -gt "$LOCK_STALE_SECONDS" ]; then
      log "Stale .agent-pending lockfile (${LOCK_AGE}s old). Previous agent attempt likely failed. Re-waking."
      rm -f "$SKILL_DIR/.agent-pending"
      SHOULD_WAKE=true
    else
      log "Skipping agent wake: .agent-pending lockfile exists (${LOCK_AGE}s old, agent still processing)"
      log "New files waiting: ${#NEW_FILE_IDS[@]}"
    fi
  else
    SHOULD_WAKE=true
  fi
  if [ "$SHOULD_WAKE" = true ]; then
    log "Waking agent for ${#NEW_FILE_IDS[@]} new file(s)"
    IDS_JSON=$(printf '%s\n' "${NEW_FILE_IDS[@]}" | jq -R . | jq -s .)
    echo "$IDS_JSON" > "$SKILL_DIR/.agent-pending"
    openclaw system event --text "supernote-sync: new files $IDS_JSON" --mode now
    log "Agent wake triggered"
  fi
fi

log "Sync complete. Updated: $UPDATED, New: ${#NEW_FILE_IDS[@]}"
