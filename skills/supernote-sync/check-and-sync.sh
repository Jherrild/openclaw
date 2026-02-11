#!/bin/bash
set -euo pipefail

# Ensure linuxbrew tools (jq, node) and npm-global (openclaw) are in PATH for systemd
export PATH="/home/linuxbrew/.linuxbrew/bin:/home/jherrild/.npm-global/bin:$PATH"
source "$HOME/.cargo/env" 2>/dev/null || true

# Derive SKILL_DIR from script's own location (works reliably under systemd)
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SKILL_DIR="$(dirname "$SCRIPT_PATH")"
WORKSPACE_DIR="$(dirname "$(dirname "$SKILL_DIR")")"

# Read config
CONFIG_FILE="$SKILL_DIR/config.json"
VAULT_ROOT=$(jq -r '.vault_root' "$CONFIG_FILE")
SUPERNOTE_PDF_BIN=$(jq -r '.supernote_pdf_bin' "$CONFIG_FILE")
SUPERNOTE_TOOL_BIN=$(jq -r '.supernote_tool_bin' "$CONFIG_FILE")

# All paths are now absolute based on script location
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

# Create buffer directory
mkdir -p "$BUFFER_DIR"

# Fetch remote state using the custom authorized script
log "Fetching remote file list using authorized token..."
REMOTE=$(export NODE_PATH=$NODE_PATH_VAL && node "$SKILL_DIR/get_remote_state.js")

if [ -z "$REMOTE" ] || [ "$REMOTE" == "null" ]; then
  log "ERROR: Failed to fetch remote state"
  exit 1
fi

# Read current mapping via mapping-utils.js
MAPPING_JSON=$(export NODE_PATH=$NODE_PATH_VAL && node "$SKILL_DIR/mapping-utils.js" read)

# Manifest accumulators (pipe-delimited)
> "$NEW_FILES_BUFFER"
> "$UPDATED_FILES_BUFFER"

# Convert a downloaded .note file: create note directory, produce PDF + text
convert_note() {
  local buffer_dir="$1"
  local file_name="$2"
  local note_name="${file_name%.note}"
  local note_dir="$buffer_dir/$note_name"

  mkdir -p "$note_dir"
  mv "$buffer_dir/$file_name" "$note_dir/$file_name"

  # Convert to PDF
  if $SUPERNOTE_PDF_BIN -i "$note_dir/$file_name" -o "$note_dir/$note_name.pdf" 2>/dev/null; then
    log "Converted $file_name → PDF"
  else
    log "WARNING: PDF conversion failed for $file_name"
  fi

  # Extract text
  if $SUPERNOTE_TOOL_BIN convert -t txt -a "$note_dir/$file_name" "$note_dir/$note_name.txt" 2>/dev/null; then
    log "Extracted text from $file_name"
  else
    log "WARNING: Text extraction failed for $file_name"
  fi
}

# Process each remote file
log "Processing remote files..."
while read -r file; do
  FILE_ID=$(echo "$file" | jq -r '.id')
  FILE_NAME=$(echo "$file" | jq -r '.name')
  REMOTE_TS=$(echo "$file" | jq -r '.modifiedTime')
  NOTE_NAME="${FILE_NAME%.note}"

  # Look up in mapping via mapping-utils.js
  LOCAL_ENTRY=$(export NODE_PATH=$NODE_PATH_VAL && node "$SKILL_DIR/mapping-utils.js" get "$FILE_ID" 2>/dev/null || echo "")

  if [ -n "$LOCAL_ENTRY" ]; then
    # PATH A: Known file - check for updates
    LOCAL_TS=$(echo "$LOCAL_ENTRY" | jq -r '.modifiedTime')
    LOCAL_PATH=$(echo "$LOCAL_ENTRY" | jq -r '.localPath')

    # Convert to epoch for comparison (empty/null/missing timestamps force resync)
    REMOTE_EPOCH=$(date -d "$REMOTE_TS" +%s 2>/dev/null || echo 0)
    if [ -z "$LOCAL_TS" ] || [ "$LOCAL_TS" = "null" ] || [ "$LOCAL_TS" = "" ]; then
      LOCAL_EPOCH=0
    else
      LOCAL_EPOCH=$(date -d "$LOCAL_TS" +%s 2>/dev/null || echo 0)
    fi

    if [ "$REMOTE_EPOCH" -gt "$LOCAL_EPOCH" ]; then
      log "PATH A: Updating known file: $FILE_NAME"

      # Download to buffer
      if export NODE_PATH=$NODE_PATH_VAL && node "$SKILL_DIR/download_file.js" "$FILE_ID" "$BUFFER_DIR/$FILE_NAME"; then
        log "Downloaded updated file to buffer: $FILE_NAME"

        # Convert .note → directory with PDF + text
        convert_note "$BUFFER_DIR" "$FILE_NAME"

        # Update mapping timestamp via mapping-utils.js
        export NODE_PATH=$NODE_PATH_VAL && node "$SKILL_DIR/mapping-utils.js" set "$FILE_ID" \
          "$(jq -n --arg name "$FILE_NAME" --arg lp "$LOCAL_PATH" --arg ts "$REMOTE_TS" \
            '{"name":$name,"localPath":$lp,"modifiedTime":$ts}')"

        log "Updated mapping timestamp: $FILE_NAME (remote=$REMOTE_TS)"
        echo "${FILE_ID}|${FILE_NAME}|${NOTE_NAME}|${REMOTE_TS}|${LOCAL_PATH}" >> "$UPDATED_FILES_BUFFER"
      else
        log "ERROR: Failed to download $FILE_NAME"
      fi
    else
      log "SKIP: $FILE_NAME (unchanged, remote=$REMOTE_TS == local=$LOCAL_TS)"
    fi
  else
    # PATH B: New file - download to buffer, queue for agent categorization
    log "PATH B: New file detected: $FILE_NAME ($FILE_ID)"
    if export NODE_PATH=$NODE_PATH_VAL && node "$SKILL_DIR/download_file.js" "$FILE_ID" "$BUFFER_DIR/$FILE_NAME"; then
      log "Downloaded new file to buffer: $FILE_NAME"

      # Convert .note → directory with PDF + text
      convert_note "$BUFFER_DIR" "$FILE_NAME"

      echo "${FILE_ID}|${FILE_NAME}|${NOTE_NAME}|${REMOTE_TS}" >> "$NEW_FILES_BUFFER"
    else
      log "ERROR: Failed to download new file $FILE_NAME"
    fi
  fi
done < <(echo "$REMOTE" | jq -c '.[]')

# Build JSON manifest from pipe-delimited buffer files via jq
build_new_manifest() {
  local file="$1"
  if [ ! -s "$file" ]; then
    echo "[]"
    return
  fi
  jq -R -s --arg buf "$BUFFER_DIR" '
    split("\n") | map(select(length > 0)) | map(
      split("|") |
      {"fileId": .[0], "name": .[1], "noteName": .[2], "dir": ($buf + "/" + .[2]), "modifiedTime": .[3]}
    )
  ' < "$file"
}

build_updated_manifest() {
  local file="$1"
  if [ ! -s "$file" ]; then
    echo "[]"
    return
  fi
  jq -R -s --arg buf "$BUFFER_DIR" '
    split("\n") | map(select(length > 0)) | map(
      split("|") |
      {"fileId": .[0], "name": .[1], "noteName": .[2], "dir": ($buf + "/" + .[2]), "localPath": .[4], "modifiedTime": .[3]}
    )
  ' < "$file"
}

NEW_JSON=$(build_new_manifest "$NEW_FILES_BUFFER")
UPDATED_JSON=$(build_updated_manifest "$UPDATED_FILES_BUFFER")
rm -f "$NEW_FILES_BUFFER" "$UPDATED_FILES_BUFFER"

NEW=$(echo "$NEW_JSON" | jq 'length')
UPDATED=$(echo "$UPDATED_JSON" | jq 'length')

# Wake agent if new or updated files found (with re-wake guard + staleness check)
LOCK_STALE_SECONDS=1800  # 30 minutes
if [ "$NEW" -gt 0 ] || [ "$UPDATED" -gt 0 ]; then
  SHOULD_WAKE=false
  if [ -f "$AGENT_PENDING" ]; then
    LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$AGENT_PENDING") ))
    if [ "$LOCK_AGE" -gt "$LOCK_STALE_SECONDS" ]; then
      log "Stale .agent-pending lockfile (${LOCK_AGE}s old). Previous agent attempt likely failed. Re-waking."
      rm -f "$AGENT_PENDING"
      SHOULD_WAKE=true
    else
      log "Skipping agent wake: .agent-pending lockfile exists (${LOCK_AGE}s old, agent still processing)"
      log "Files waiting: $NEW new, $UPDATED updated"
    fi
  else
    SHOULD_WAKE=true
  fi
  if [ "$SHOULD_WAKE" = true ]; then
    log "Waking agent for $NEW new file(s), $UPDATED updated file(s)"
    jq -n --argjson new "$NEW_JSON" --argjson updated "$UPDATED_JSON" \
      '{"new": $new, "updated": $updated}' > "$AGENT_PENDING"
    echo "supernote-sync: $NEW new file(s) downloaded to buffer, $UPDATED updated."
    log "Agent wake triggered via stdout (task-orchestrator)"
  fi
else
  log "No changes detected (0 new, 0 updated)"
fi

log "Sync complete. Updated: $UPDATED, New: $NEW"
