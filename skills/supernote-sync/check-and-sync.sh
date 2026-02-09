#!/bin/bash
set -euo pipefail

# Ensure linuxbrew tools (jq, node) and npm-global (openclaw) are in PATH for systemd
export PATH="/home/linuxbrew/.linuxbrew/bin:/home/jherrild/.npm-global/bin:$PATH"

# Derive SKILL_DIR from script's own location (works reliably under systemd)
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SKILL_DIR="$(dirname "$SCRIPT_PATH")"
WORKSPACE_DIR="$(dirname "$(dirname "$SKILL_DIR")")"

# All paths are now absolute based on script location
MAPPING_FILE="$SKILL_DIR/sync-mapping.json"
LOG_FILE="$SKILL_DIR/sync.log"
BUFFER_DIR="$SKILL_DIR/buffer"
NEW_FILES_BUFFER="$SKILL_DIR/.new-files-buffer"
UPDATED_FILES_BUFFER="$SKILL_DIR/.updated-files-buffer"
AGENT_PENDING="$SKILL_DIR/.agent-pending"
NODE_PATH_VAL="$WORKSPACE_DIR/skills/google-tasks/node_modules"

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
> "$NEW_FILES_BUFFER"
> "$UPDATED_FILES_BUFFER"

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
        echo "${FILE_ID}|${FILE_NAME}|${REMOTE_TS}|${LOCAL_PATH}" >> "$UPDATED_FILES_BUFFER"
      else
        log "ERROR: Failed to download $FILE_NAME"
      fi
    fi
  else
    # PATH B: New file - download to buffer, queue for agent categorization
    log "PATH B: New file detected: $FILE_NAME ($FILE_ID)"
    if export NODE_PATH=$NODE_PATH_VAL && node "$SKILL_DIR/download_file.js" "$FILE_ID" "$BUFFER_DIR/$FILE_NAME"; then
      log "Downloaded new file to buffer: $FILE_NAME"
      echo "${FILE_ID}|${FILE_NAME}|${REMOTE_TS}" >> "$NEW_FILES_BUFFER"
    else
      log "ERROR: Failed to download new file $FILE_NAME"
    fi
  fi
done < <(echo "$REMOTE" | jq -c '.[]')

# Build JSON manifest directly from pipe-delimited buffer files via jq
# Avoids bash word-splitting issues with filenames containing spaces
build_manifest_from_file() {
  local file="$1"
  if [ ! -s "$file" ]; then
    echo "[]"
    return
  fi
  jq -R -s '
    split("\n") | map(select(length > 0)) | map(
      split("|") |
      if length >= 4 then
        {"fileId": .[0], "name": .[1], "modifiedTime": .[2], "localPath": .[3]}
      else
        {"fileId": .[0], "name": .[1], "modifiedTime": .[2]}
      end
    )
  ' < "$file"
}

NEW_JSON=$(build_manifest_from_file "$NEW_FILES_BUFFER")
UPDATED_JSON=$(build_manifest_from_file "$UPDATED_FILES_BUFFER")
rm -f "$NEW_FILES_BUFFER" "$UPDATED_FILES_BUFFER"

NEW=$(echo "$NEW_JSON" | jq 'length')
UPDATED=$(echo "$UPDATED_JSON" | jq 'length')

# Wake agent if new files found (with re-wake guard + staleness check)
LOCK_STALE_SECONDS=1800  # 30 minutes
if [ "$NEW" -gt 0 ]; then
  SHOULD_WAKE=false
  if [ -f "$AGENT_PENDING" ]; then
    LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$AGENT_PENDING") ))
    if [ "$LOCK_AGE" -gt "$LOCK_STALE_SECONDS" ]; then
      log "Stale .agent-pending lockfile (${LOCK_AGE}s old). Previous agent attempt likely failed. Re-waking."
      rm -f "$AGENT_PENDING"
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
    jq -n --argjson new "$NEW_JSON" --argjson updated "$UPDATED_JSON" \
      '{"new": $new, "updated": $updated}' > "$AGENT_PENDING"
    openclaw system event --text "supernote-sync: $NEW new file(s) downloaded to buffer, $UPDATED updated. Read .agent-pending for manifest." --mode now
    log "Agent wake triggered"
  fi
else
  # Clean up updated files from buffer (already copied to destinations)
  if [ "$UPDATED" -gt 0 ]; then
    echo "$UPDATED_JSON" | jq -r '.[].name' | while IFS= read -r fname; do
      rm -f "$BUFFER_DIR/$fname"
    done
  fi
fi

log "Sync complete. Updated: $UPDATED, New: $NEW"
