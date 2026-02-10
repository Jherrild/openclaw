# Supernote Google Drive Sync Skill

Synchronizes `.note` files from Google Drive (Supernote backup folder) to the Obsidian vault with intelligent PARA categorization. Notes are converted to PDF + extracted text, then stored as Obsidian-native markdown with embedded PDFs.

## Overview

- **check-and-sync.sh** runs every 10 minutes via systemd timer and handles ALL Google Drive access
- **Path A (Updated files):** Script downloads, converts, and refreshes the buffer. Agent regenerates .md if needed.
- **Path B (New files):** Script downloads and converts to `buffer/<NoteName>/`. Agent categorizes and files them.
- **You never need Google Drive auth.** All files are local by the time you're woken.

## Triggers

System event matching: `supernote-sync: ... new file(s) downloaded to buffer`

When you receive this event, follow the **Agent Workflow** below.

## Agent Workflow

### 1. Check What's New

```bash
SKILL_DIR="$HOME/.openclaw/workspace/skills/supernote-sync"

# Get new notes (need categorization)
node "$SKILL_DIR/get_new_notes.js"

# Get updated notes (already mapped, refreshed content)
node "$SKILL_DIR/get_updated_notes.js"
```

Both return JSON arrays with `fileId`, `name`, `text` (extracted content), `pdfPath`, and `modifiedTime`.
Updated notes also include `mdPath` (existing vault location).

### 2. Process NEW Notes

For each new note:
1. **Read the text** — full extracted text is in the `text` field
2. **Search the vault** for existing files with the same name:
   ```bash
   node ~/.openclaw/workspace/skills/local-rag/rag.js search "<note name>" /mnt/c/Users/Jherr/Documents/remote-personal
   ```
3. **Categorize** into a PARA location (see Categorization Heuristics below)
4. **Set the mapping** with the chosen vault destination:
   ```bash
   node "$SKILL_DIR/mapping-utils.js" set "<fileId>" '{"name":"<Name>.note","mdPath":"<PARA-path>/<Name>.md","pdfPath":"<PARA-path>/documents/<Name>.pdf","modifiedTime":"<ts>"}'
   ```
5. **Generate markdown** with frontmatter, PDF embed, and extracted text:
   ```bash
   node "$SKILL_DIR/store_markdown.js" --file-id "<fileId>" --content "<markdown>"
   ```

   The .md file should follow this structure:
   ```markdown
   ---
   tags: [supernote]
   source: supernote-sync
   fileId: <google-drive-file-id>
   ---

   # <Note Name>

   ![[documents/<Note Name>.pdf]]

   ---

   <extracted text content>
   ```

### 3. Process UPDATED Notes

For each updated note:
1. **Read the text** — check if content has meaningfully changed
2. **Generate markdown** with the updated text:
   ```bash
   node "$SKILL_DIR/store_markdown.js" --file-id "<fileId>" --content "<markdown>"
   ```

### 4. Migrate to Vault

Once all notes have .md files in the buffer, migrate everything in one call:

```bash
node "$SKILL_DIR/obsidian_migrate.js"
```

This command:
- Copies `.pdf` → `<vault-path>/documents/<NoteName>.pdf`
- Copies `.md` → `<vault-path>/<NoteName>.md`
- Updates the YAML mapping with `mdPath` + `pdfPath`
- Cleans up buffer directories
- Removes processed entries from `.agent-pending`

**Dry run first** (optional): `node "$SKILL_DIR/obsidian_migrate.js" --dry-run`

### 5. Done

If all items migrated successfully, `.agent-pending` is automatically removed.
If some items were skipped (missing .md or mapping), they remain in `.agent-pending` for the next run.

## Categorization Heuristics

Apply PARA heuristics based on filename and text content:

| Pattern | Destination | Justification |
|---------|-------------|---------------|
| `Meeting*`, `Board Meeting*` | `.../2-Areas/Home/` or `.../2-Areas/meetings/` | Board = HOA board (Jesten is on it) |
| `Journal*`, `Daily*` | `.../2-Areas/Journal/YYYY/` | Daily or journal entries |
| `Interview*`, `Onboarding*` | `.../2-Areas/Career/` | Career-related content |
| `GitHub*` | `.../2-Areas/Career/` or `.../1-Projects/GitHub/` | Jesten works at GitHub |
| `Draft*`, `Writing*` | `.../1-Projects/Writing/Drafts/` | Work-in-progress documents |
| `Reference*`, `Cheatsheet*` | `.../3-Resources/<Area>/` | Reference materials |
| Uncertain | `.../3-Resources/Supernote/Inbox/` | Default; ask user for review |

**If uncertain:** Default to Inbox and ask: "New Supernote file: `<filename>`. Where should I file it?"

## Tools Reference

| Tool | Usage | Purpose |
|------|-------|---------|
| `get_new_notes.js` | `node get_new_notes.js` | List new notes with text + PDF paths |
| `get_updated_notes.js` | `node get_updated_notes.js` | List updated notes with text + vault paths |
| `store_markdown.js` | `node store_markdown.js --file-id <id> --content "..."` | Write .md to buffer |
| `obsidian_migrate.js` | `node obsidian_migrate.js [--dry-run]` | Move buffer → vault + update mapping |
| `vault_update.js` | `node vault_update.js --path <root>` | Change vault root in config |
| `mapping-utils.js` | `node mapping-utils.js <cmd> [args]` | Read/write/set/remove mapping entries |

## Operational Reference

### Auth & Token

The sync script uses a shared Google OAuth token. You don't need this for normal operation (files are pre-downloaded), but if debugging:

- **Token:** `~/.openclaw/workspace/skills/google-docs/scripts/token.json`
- **Credentials:** `~/.openclaw/workspace/skills/google-tasks/credentials.json`
- **Node modules:** `~/.openclaw/workspace/skills/google-tasks/node_modules` (set via `NODE_PATH`)
- **Drive folder ID:** `19NabfLOmVIvqNZmI0PJYOwSLcPUSiLkK`

### Common Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `get_new_notes` returns empty | No `.agent-pending` or no new files | Check `sync.log` for details |
| `obsidian_migrate` skips items | Missing .md in buffer or no mapping entry | Run `store_markdown` and/or `mapping-utils.js set` first |
| Script logs `ERROR: Failed to fetch remote state` | OAuth token expired | Re-auth via google-docs token refresh |
| `.agent-pending` stale | Previous agent attempt failed | `rm -f .agent-pending` to unblock |
| Mapping lost | File corruption | Check `supernote-sync-mapping.md.bak` in vault `metadata/` |

### Manual Commands

```bash
SKILL_DIR="$HOME/.openclaw/workspace/skills/supernote-sync"

# Trigger sync manually
bash "$SKILL_DIR/check-and-sync.sh"

# Clear stale agent lock
rm -f "$SKILL_DIR/.agent-pending"

# View recent log
tail -20 "$SKILL_DIR/sync.log"

# Check mapping
node "$SKILL_DIR/mapping-utils.js" read | jq .
```

## Files

| File | Purpose |
|------|---------|
| `check-and-sync.sh` | Systemd timer script: download, convert, buffer, wake agent |
| `get_new_notes.js` | Agent tool: list new notes with text content |
| `get_updated_notes.js` | Agent tool: list updated notes with vault paths |
| `store_markdown.js` | Agent tool: write generated .md to buffer |
| `obsidian_migrate.js` | Agent tool: migrate buffer → vault |
| `vault_update.js` | Agent tool: update vault root path |
| `mapping-utils.js` | YAML mapping read/write (CLI + module) |
| `get_remote_state.js` | Node.js: list remote .note files via googleapis |
| `download_file.js` | Node.js: download file by ID via googleapis |
| `config.json` | Skill config (vault_root, tool paths) |
| `buffer/` | Pre-downloaded + converted notes (temporary) |
| `.agent-pending` | JSON manifest + lockfile (created by script, cleaned by migrate) |
| `sync.log` | Rolling log (auto-rotates at 500 lines) |
