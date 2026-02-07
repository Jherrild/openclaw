# Supernote Google Drive Sync Skill

Synchronizes `.note` files from Google Drive (Supernote backup folder) to the Obsidian vault with intelligent PARA categorization.

## Overview

- **check-and-sync.sh** runs every 10 minutes via cron
- **Path A (Bash + Node.js):** Known files update automatically (zero tokens)
- **Path B (Agent):** New files trigger Magnus for PARA categorization
- **Auth:** Uses shared OAuth token at `../google-docs/scripts/token.json` via `googleapis` Node.js library

## Triggers

System event matching: `supernote-sync: new files [...]`

When you receive this event, follow the **New File Processing** workflow below.

## New File Processing Workflow

When triggered by `supernote-sync: new files ["id1", "id2", ...]`:

### 1. Parse File IDs
```bash
# Extract JSON array from event text
FILE_IDS=$(echo "$EVENT_TEXT" | grep -oP '\[.*\]')
```

### 2. Download to Buffer
```bash
SKILL_DIR="$HOME/.openclaw/workspace/skills/supernote-sync"
NODE_PATH_VAL="$HOME/.openclaw/workspace/skills/google-tasks/node_modules"
mkdir -p /tmp/supernote-buffer
for id in $(echo "$FILE_IDS" | jq -r '.[]'); do
  export NODE_PATH=$NODE_PATH_VAL && node "$SKILL_DIR/download_file.js" "$id" "/tmp/supernote-buffer/${id}.note"
done
```

### 3. Categorize Each File

Apply PARA heuristics based on filename and contents. For example:

| Pattern | Destination | Justification |
|---------|-------------|---------------|
| `Meeting*` | `.../2-Areas/meetings/` | Meetings and notes related to meetings |
| `Board Meeting*` | `.../2-Areas/Home/` | This LOOKS like it's just a meeting, but because it mentions Board, you should reference what you know about Jesten. He's on the home owners board, so this is probably related to that, and should go in the 'Home' area |
| `Bus renovation`, `Floor Install` | `.../1-Projects/Bus Renovation/` OR `.../2-Areas/Bus Renovation/` | This is tricky- Bus renovation sounds like a specific project, so it could go in Projects- but based on content, it could also be a generic reference for HOW to renovate a bus. Investigate content, and figure out which you think it is, asking for clarification in the main channel if you can't decide |
| `Floor Install` | `.../1-Projects/Bus Renovation/` OR `.../2-Areas/Bus Renovation/` | Just like he example above, this is tricky- it sounds like a specific project, so it could go in Projects- but based on content, it could also be a generic reference for HOW to install a floor. Investigate content, and figure out which you think it is, asking for clarification in the main channel if you can't decide |
| `Journal*`, `Daily*` | `.../2-Areas/Journal/YYYY/` | Daily or journal entries are a broad area |
| `Draft*`, `Writing*` | `.../1-Projects/Writing/Drafts/` | Drafts or work-in-progress documents are probably writing related |
| `Reference <AREA>*`, `Cheatsheet <AREA>*` | `.../3-Resources/<AREA>` | Reference materials and cheatsheets are resources. Words that imply a resource should also be filed into categories under resources |
| `Interview*`, `Onboarding*` | `.../2-Areas/Career/` | Words semantically related to career or job probably go under 'Career' |
| `GitHub <AREA>*` | `.../2-Areas/Career/` OR `.../1-Projects/GitHub/<AREA>` | GitHub is tricky- I work there, so it could be a career related area content, or an active project |

**If uncertain:** Do your best to figure out where this might live based on filename and content. Use the PARA acronym to decide- if the title or contents are semantically similar to a project, file it under projects. If it's more of a general area of focus, file it under areas. If it's a reference material, file it under resources. If you can't decide, default to `.../3-Resources/Supernote/Inbox/` and log the file for later review:

> "New Supernote file: `<filename>`. Where should I file it? (default: Inbox)"

### 4. Update Mapping

For each processed file:
```bash
SKILL_DIR="$HOME/.openclaw/workspace/skills/supernote-sync"
jq --arg id "$FILE_ID" \
   --arg name "$REMOTE_NAME" \
   --arg path "$DEST_PATH" \
   --arg ts "$(date -Iseconds)" \
   '.files += [{"fileId": $id, "remoteName": $name, "localPath": $path, "lastModified": $ts}]' \
   "$SKILL_DIR/sync-mapping.json" > "$SKILL_DIR/sync-mapping.tmp" && \
   mv "$SKILL_DIR/sync-mapping.tmp" "$SKILL_DIR/sync-mapping.json"
```

### 5. Move to Final Destination
```bash
mkdir -p "$(dirname "$DEST_PATH")"
mv "/tmp/supernote-buffer/$FILENAME" "$DEST_PATH"
```

### 6. Cleanup & Release Lock
```bash
rm -rf /tmp/supernote-buffer
rm -f "$SKILL_DIR/.agent-pending"
```

**IMPORTANT:** Always remove `.agent-pending` when done (step 6), otherwise the cron script won't wake the agent for future new files.

## Error Handling

- **Download fails:** Log error, skip file, continue with others
- **Categorization uncertain:** Default to Inbox path, log for review
- **Move fails:** Create parent dirs with `mkdir -p`, retry once
- **Always clean up:** Even on partial failure, remove `.agent-pending` lockfile so future runs aren't blocked

## Files

| File | Purpose |
|------|---------|
| `check-and-sync.sh` | Cron script for updates and new file detection |
| `get_remote_state.js` | Node.js: lists remote `.note` files via googleapis |
| `download_file.js` | Node.js: downloads a file by ID via googleapis |
| `sync-mapping.json` | Persistent file mapping (fileId → localPath) |
| `sync.log` | Rolling log of sync operations (auto-rotates at 500 lines) |
| `PRD.md` | Requirements and status document |

## Manual Commands

### List remote files
```bash
export NODE_PATH="$HOME/.openclaw/workspace/skills/google-tasks/node_modules"
node ~/.openclaw/workspace/skills/supernote-sync/get_remote_state.js
```

### Download a file manually
```bash
export NODE_PATH="$HOME/.openclaw/workspace/skills/google-tasks/node_modules"
node ~/.openclaw/workspace/skills/supernote-sync/download_file.js "<file-id>" "/path/to/dest.note"
```

### Trigger sync manually
```bash
bash ~/.openclaw/workspace/skills/supernote-sync/check-and-sync.sh
```

### Clear agent lock (if stuck)
```bash
rm -f ~/.openclaw/workspace/skills/supernote-sync/.agent-pending
```

## Cron Job

Added via:
```bash
openclaw cron add \
  --name "supernote-sync" \
  --every "10m" \
  --system-event "Running supernote sync check" \
  --message "bash ~/.openclaw/workspace/skills/supernote-sync/check-and-sync.sh"
```

Check status:
```bash
openclaw cron list
```
