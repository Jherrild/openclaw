# Supernote Google Drive Sync Skill

Synchronizes `.note` files from Google Drive (Supernote backup folder) to the Obsidian vault with intelligent PARA categorization.

## Overview

- **check-and-sync.sh** runs every 10 minutes via cron and handles ALL Google Drive access
- **Path A (Updated files):** Script downloads and places them at their mapped vault path automatically. Listed in manifest for your awareness — no action needed.
- **Path B (New files):** Script downloads them to `buffer/` directory. **You** categorize and place them.
- **You never need Google Drive auth.** All files are local by the time you're woken.

## Triggers

System event matching: `supernote-sync: ... new file(s) downloaded to buffer`

When you receive this event, follow the **New File Processing** workflow below.

## New File Processing Workflow

### 1. Read the Manifest

The file `.agent-pending` contains a JSON manifest with two sections:
```json
{
  "new": [
    {"fileId": "1XFK...", "name": "PRD Driven Design.note", "modifiedTime": "2026-..."}
  ],
  "updated": [
    {"fileId": "2YGL...", "name": "Journal.note", "modifiedTime": "2026-...", "localPath": "/path/in/vault/..."}
  ]
}
```

- **`new`** — Files that need your categorization. Already downloaded to `~/.openclaw/workspace/skills/supernote-sync/buffer/`
- **`updated`** — Files already refreshed at their existing vault paths by the script. **No action needed** — informational only.

```bash
SKILL_DIR="$HOME/.openclaw/workspace/skills/supernote-sync"
cat "$SKILL_DIR/.agent-pending" | jq .
ls "$SKILL_DIR/buffer/"
```

### 2. Categorize Each NEW File

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

### 3. Update Mapping

For each processed file, add it to `sync-mapping.json` using the `fileId` and `modifiedTime` from the manifest:
```bash
SKILL_DIR="$HOME/.openclaw/workspace/skills/supernote-sync"
jq --arg id "$FILE_ID" \
   --arg name "$REMOTE_NAME" \
   --arg path "$DEST_PATH" \
   --arg ts "$MODIFIED_TIME" \
   '.files += [{"fileId": $id, "remoteName": $name, "localPath": $path, "lastModified": $ts}]' \
   "$SKILL_DIR/sync-mapping.json" > "$SKILL_DIR/sync-mapping.tmp" && \
   mv "$SKILL_DIR/sync-mapping.tmp" "$SKILL_DIR/sync-mapping.json"
```

### 4. Place in Vault (Using Obsidian Scribe)

**IMPORTANT — Search before filing:** Use the `local-rag` skill to search the vault for an existing file with the same name before categorizing:

```bash
node ~/.openclaw/workspace/skills/local-rag/rag.js search "<filename without extension>" /mnt/c/Users/Jherr/Documents/remote-personal
```

- **If found:** Use that existing path as `DEST_PATH`. Skip the move — just update the mapping (step 3) so it's tracked going forward.
- **If NOT found:** Use `scribe_move` (from `obsidian-scribe`) to place the file from the buffer into its PARA destination:

```bash
node ~/.openclaw/workspace/skills/obsidian-scribe/move.js "$HOME/.openclaw/workspace/skills/supernote-sync/buffer/$FILENAME" "$DEST_PATH"
```

This ensures directories are created and the move follows vault conventions.

**Recovery note:** If the mapping was lost, check for `sync-mapping.json.bak` first — the cron script backs up the mapping before each run.

### 5. Cleanup & Release Lock

After processing ALL new files:
```bash
SKILL_DIR="$HOME/.openclaw/workspace/skills/supernote-sync"
rm -rf "$SKILL_DIR/buffer"
rm -f "$SKILL_DIR/.agent-pending"
```

**IMPORTANT:** Always remove `.agent-pending` when done, otherwise the cron script won't wake you for future new files.

## Error Handling

- **Categorization uncertain:** Default to Inbox path, log for review
- **Move fails:** Create parent dirs with `mkdir -p`, retry once
- **Always clean up:** Even on partial failure, remove `.agent-pending` lockfile so future runs aren't blocked

---

## Operational Reference

### Auth & Token

The sync script uses a shared Google OAuth token. You don't need this for normal operation (files are pre-downloaded), but if you're debugging script failures:

- **Token location:** `~/.openclaw/workspace/skills/google-docs/scripts/token.json`
- **Credentials:** `~/.openclaw/workspace/skills/google-tasks/credentials.json`
- **Node modules:** `~/.openclaw/workspace/skills/google-tasks/node_modules` (set via `NODE_PATH`)
- **Google account:** `jestenh@gmail.com`
- **Drive folder ID:** `19NabfLOmVIvqNZmI0PJYOwSLcPUSiLkK`

### Common Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Script logs `ERROR: Failed to fetch remote state` | OAuth token expired or Ollama/Node not available | Check token: `cat ~/.openclaw/workspace/skills/google-docs/scripts/token.json`. If expired, re-auth via the google-docs skill's token refresh flow. |
| Script runs but no system event fires | No new/updated files on Drive, or `.agent-pending` lockfile blocking | Check `sync.log` for details. If lock is stale: `rm -f ~/.openclaw/workspace/skills/supernote-sync/.agent-pending` |
| Buffer is empty when you're woken | Script failed mid-download (network error, disk full) | Check `sync.log` for download errors. Re-run manually: `bash ~/.openclaw/workspace/skills/supernote-sync/check-and-sync.sh` |
| `sync-mapping.json` is empty/corrupted | File was wiped or malformed JSON | Restore from backup: `cp ~/.openclaw/workspace/skills/supernote-sync/sync-mapping.json.bak ~/.openclaw/workspace/skills/supernote-sync/sync-mapping.json` |
| You keep getting woken for the same files | You didn't remove `.agent-pending` after processing | Always `rm -f .agent-pending` in cleanup step, even on partial failure |
| `scribe_move` fails with "file exists" | File already in vault (mapping was lost) | Use the existing vault path in the mapping instead of moving. Search with `local-rag` first. |
| Cron job not firing | Cron disabled or gateway restarted without cron resuming | Check: `openclaw cron list`. Re-enable if needed (see below). |

### Cron Job

The cron job ID is `de964491-7282-4832-84c7-ffed7027dd5c`.

Current config:
- **Schedule:** Every 10 minutes (`everyMs: 600000`)
- **Session:** Isolated (doesn't pollute main session history)
- **Delivery:** `none` (silent — no message to user unless the script wakes you via system event)

**Check status:**
```bash
openclaw cron list
```

**Re-create if missing:**
```bash
openclaw cron add \
  --name "supernote-sync" \
  --every "10m" \
  --message "bash ~/.openclaw/workspace/skills/supernote-sync/check-and-sync.sh"
```

**Enable/disable:**
```bash
openclaw cron enable de964491-7282-4832-84c7-ffed7027dd5c
openclaw cron disable de964491-7282-4832-84c7-ffed7027dd5c
```

### Manual Commands

**Trigger sync manually:**
```bash
bash ~/.openclaw/workspace/skills/supernote-sync/check-and-sync.sh
```

**Clear agent lock (if stuck):**
```bash
rm -f ~/.openclaw/workspace/skills/supernote-sync/.agent-pending
```

**View recent log:**
```bash
tail -20 ~/.openclaw/workspace/skills/supernote-sync/sync.log
```

**Restore mapping from backup:**
```bash
cp ~/.openclaw/workspace/skills/supernote-sync/sync-mapping.json.bak ~/.openclaw/workspace/skills/supernote-sync/sync-mapping.json
```

## Files

| File | Purpose |
|------|---------|
| `check-and-sync.sh` | Cron script: downloads all files, updates known ones, buffers new ones |
| `get_remote_state.js` | Node.js: lists remote `.note` files via googleapis (paginated) |
| `download_file.js` | Node.js: downloads a file by ID via googleapis |
| `sync-mapping.json` | Persistent file mapping (fileId → localPath) |
| `sync-mapping.json.bak` | Auto-backup before each cron run |
| `buffer/` | Pre-downloaded new files (created by script, cleaned up by you) |
| `.agent-pending` | JSON manifest + lockfile (created by script, deleted by you) |
| `sync.log` | Rolling log (auto-rotates at 500 lines) |
| `SKILL.md` | This file — your operating instructions |
| `PRD.md` | Full requirements, design decisions, and change history |
