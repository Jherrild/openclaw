#!/bin/bash
set -euo pipefail

SKILL_DIR="$HOME/.openclaw/workspace/skills/supernote-sync"
MAPPING_FILE="$SKILL_DIR/sync-mapping.json"
LOG_FILE="$SKILL_DIR/sync.log"
BUFFER_DIR="$SKILL_DIR/buffer"
NODE_PATH_VAL="$HOME/.openclaw/workspace/skills/google-tasks/node_modules"

log() { echo "[$(date -Iseconds)] $*" >> "$LOG_FILE"; }

# Log rotation: keep last 500 lines
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 500 ]; then
  tail -n 500 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

# Initialize mapping if missing
[ -f "$MAPPING_FILE" ] || echo '{}' > "$MAPPING_FILE"

# Backup mapping before each run (recoverable if corrupted)
cp "$MAPPING_FILE" "$MAPPING_FILE.bak" 2>/dev/null || true

# Create buffer directory
mkdir -p "$BUFFER_DIR"

# Fetch remote state using the custom authorized script
log "Fetching remote file list using authorized token..."
REMOTE=$(export NODE_PATH=$NODE_PATH_VAL && node "$SKILL_DIR/get_remote_state.js")

if [ -z "$REMOTE" ] || [ "$REMOTE" == "null" ]; then
  log "ERROR: Failed to fetch remote state"
  exit 1
fi

# Manifest accumulators (pipe-delimited: fileId|fileName|remoteTimestamp)
> "$SKILL_DIR/.new-files-buffer"
> "$SKILL_DIR/.updated-files-buffer"

# Process each remote file
log "Processing remote files..."
while read -r file; do
  FILE_ID=$(echo "$file" | jq -r '.id')
  FILE_NAME=$(echo "$file" | jq -r '.name')
  REMOTE_TS=$(echo "$file" | jq -r '.modifiedTime')
  
  # Check if known in mapping (flat key-value structure: fileId -> {localPath, modifiedTime})
  LOCAL_ENTRY=$(jq -r --arg id "$FILE_ID" '.[$id] // empty' "$MAPPING_FILE" 2>/dev/null || echo "")
  
  if [ -n "$LOCAL_ENTRY" ]; then
    # PATH A: Known file - check for updates
    LOCAL_TS=$(echo "$LOCAL_ENTRY" | jq -r '.modifiedTime')
    LOCAL_PATH=$(echo "$LOCAL_ENTRY" | jq -r '.localPath')
    
    # Convert to epoch for comparison
    REMOTE_EPOCH=$(date -d "$REMOTE_TS" +%s 2>/dev/null || echo 0)
    LOCAL_EPOCH=$(date -d "$LOCAL_TS" +%s 2>/dev/null || echo 0)
    
    if [ "$REMOTE_EPOCH" -gt "$LOCAL_EPOCH" ]; then
      log "PATH A: Updating known file: $FILE_NAME"
      
      # Download to buffer first
      if export NODE_PATH=$NODE_PATH_VAL && node "$SKILL_DIR/download_file.js" "$FILE_ID" "$BUFFER_DIR/$FILE_NAME"; then
        # Copy to mapped location
        mkdir -p "$(dirname "$LOCAL_PATH")"
        cp "$BUFFER_DIR/$FILE_NAME" "$LOCAL_PATH"
        # Update mapping timestamp (flat key-value structure)
        jq --arg id "$FILE_ID" --arg ts "$REMOTE_TS" \
          '.[$id].modifiedTime = $ts' \
          "$MAPPING_FILE" > "$MAPPING_FILE.tmp" && mv "$MAPPING_FILE.tmp" "$MAPPING_FILE"
        log "Updated: $FILE_NAME -> $LOCAL_PATH"
        echo "${FILE_ID}|${FILE_NAME}|${REMOTE_TS}|${LOCAL_PATH}" >> "$SKILL_DIR/.updated-files-buffer"
      else
        log "ERROR: Failed to download $FILE_NAME"
      fi
    fi
  else
    # PATH B: New file - download to buffer, queue for agent categorization
    log "PATH B: New file detected: $FILE_NAME ($FILE_ID)"
    if export NODE_PATH=$NODE_PATH_VAL && node "$SKILL_DIR/download_file.js" "$FILE_ID" "$BUFFER_DIR/$FILE_NAME"; then
      log "Downloaded new file to buffer: $FILE_NAME"
      echo "${FILE_ID}|${FILE_NAME}|${REMOTE_TS}" >> "$SKILL_DIR/.new-files-buffer"
    else
      log "ERROR: Failed to download new file $FILE_NAME"
    fi
  fi
done < <(echo "$REMOTE" | jq -c '.[]')

# Build manifest from accumulators
NEW_FILES=()
UPDATED_FILES=()
if [ -s "$SKILL_DIR/.new-files-buffer" ]; then
  mapfile -t NEW_FILES < "$SKILL_DIR/.new-files-buffer"
fi
if [ -s "$SKILL_DIR/.updated-files-buffer" ]; then
  mapfile -t UPDATED_FILES < "$SKILL_DIR/.updated-files-buffer"
fi
rm -f "$SKILL_DIR/.new-files-buffer" "$SKILL_DIR/.updated-files-buffer"

UPDATED=${#UPDATED_FILES[@]}
NEW=${#NEW_FILES[@]}

# Build JSON manifest
build_manifest_array() {
  local type="$1"
  shift
  local arr="$@"
  local json="[]"
  for entry in $arr; do
    local f_id=$(echo "$entry" | cut -d'|' -f1)
    local f_name=$(echo "$entry" | cut -d'|' -f2)
    local f_ts=$(echo "$entry" | cut -d'|' -f3)
    local f_path=$(echo "$entry" | cut -d'|' -f4)
    if [ -n "$f_path" ]; then
      json=$(echo "$json" | jq --arg id "$f_id" --arg name "$f_name" --arg ts "$f_ts" --arg path "$f_path" \
        '. += [{"fileId": $id, "name": $name, "modifiedTime": $ts, "localPath": $path}]')
    else
      json=$(echo "$json" | jq --arg id "$f_id" --arg name "$f_name" --arg ts "$f_ts" \
        '. += [{"fileId": $id, "name": $name, "modifiedTime": $ts}]')
    fi
  done
  echo "$json"
}

# Wake agent if new files found (with re-wake guard + staleness check)
LOCK_STALE_SECONDS=1800  # 30 minutes
if [ "$NEW" -gt 0 ]; then
  SHOULD_WAKE=false
  if [ -f "$SKILL_DIR/.agent-pending" ]; then
    LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$SKILL_DIR/.agent-pending") ))
    if [ "$LOCK_AGE" -gt "$LOCK_STALE_SECONDS" ]; then
      log "Stale .agent-pending lockfile (${LOCK_AGE}s old). Previous agent attempt likely failed. Re-waking."
      rm -f "$SKILL_DIR/.agent-pending"
      SHOULD_WAKE=true
    else
      log "Skipping agent wake: .agent-pending lockfile exists (${LOCK_AGE}s old, agent still processing)"
      log "New files waiting: $NEW"
    fi
  else
    SHOULD_WAKE=true
  fi
  if [ "$SHOULD_WAKE" = true ]; then
    log "Waking agent for $NEW new file(s), $UPDATED updated file(s)"
    # Build manifest
    NEW_JSON=$(build_manifest_array "new" "${NEW_FILES[@]}")
    UPDATED_JSON="[]"
    if [ "$UPDATED" -gt 0 ]; then
      UPDATED_JSON=$(build_manifest_array "updated" "${UPDATED_FILES[@]}")
    fi
    jq -n --argjson new "$NEW_JSON" --argjson updated "$UPDATED_JSON" \
      '{"new": $new, "updated": $updated}' > "$SKILL_DIR/.agent-pending"
    openclaw system event --text "supernote-sync: $NEW new file(s) downloaded to buffer, $UPDATED updated. Read .agent-pending for manifest." --mode now
    log "Agent wake triggered"
  fi
else
  # Clean up buffer if no new files (updated files already copied to their destinations)
  find "$BUFFER_DIR" -type f -name "*.note" | while read -r f; do
    FNAME=$(basename "$f")
    # Only remove files that were updated (already copied to localPath)
    if grep -q "$FNAME" "$SKILL_DIR/.updated-files-buffer" 2>/dev/null; then
      rm -f "$f"
    fi
  done
  # Remove updated files from buffer since they're already placed
  for entry in "${UPDATED_FILES[@]}"; do
    FNAME=$(echo "$entry" | cut -d'|' -f2)
    rm -f "$BUFFER_DIR/$FNAME"
  done
fi

log "Sync complete. Updated: $UPDATED, New: $NEW"
