# PRD: Supernote Google Drive Sync (v3 - Hybrid Intelligent Sync)

> **Last updated:** 2026-02-07
> **Status:** Operational with fixes applied. Initial sync of 25 files pending agent categorization.

## Goal
Automate the synchronization of `.note` files from Google Drive to the Obsidian vault with intelligent, agent-assisted placement for new files and low-overhead updates for known files.

---

## Implementation Status

### Done
- [x] `check-and-sync.sh` — cron target, discovers remote files, detects new vs. known
- [x] `get_remote_state.js` — Node.js script using googleapis to list `.note` files
- [x] `download_file.js` — Node.js script using googleapis to download files by ID
- [x] `sync-mapping.json` — persistent mapping store (schema working)
- [x] `sync.log` — rolling log with timestamps
- [x] `SKILL.md` — agent instructions for Path B (new file categorization)
- [x] Cron job registered (`openclaw cron add`)
- [x] End-to-end test: 25 files discovered, agent woken successfully

### Changed from Original Design
| Original (v2 PRD) | Actual Implementation | Reason |
|----|----|----|
| `gog` CLI for Drive access | Node.js `googleapis` library | Shared OAuth token with google-docs/google-tasks skills; `gog` auth was a separate flow |
| `gog drive ls` for discovery | `get_remote_state.js` | Same — uses existing token at `../google-docs/scripts/token.json` |
| `gog drive download` for files | `download_file.js` | Same |
| PRD code blocks as implementation | Separate `.sh` / `.js` files | Better maintainability |

### Decided NOT To Do
| Idea | Reason |
|------|--------|
| Pattern B deferred batch (pending-new.json + separate cron) | Unnecessary complexity — 10-minute cron already provides natural batching |
| Content-based keyword scanning of `.note` files | `.note` is a proprietary binary format (Supernote); not trivially parseable as text. Filename heuristics are sufficient for now. |
| Sub-agent (Flash) for bulk categorization | Overkill for current volume (~25 files). Magnus handles it directly. |

### Bug Fixes Applied (v3)
| # | Bug | Fix | Date |
|---|-----|----|------|
| 1 | `download_file.js` TOKEN_PATH used absolute path inside `path.join()`, resolving to garbage | Changed to relative path `../google-docs/scripts/token.json` | 2026-02-07 |
| 2 | No re-wake guard — every cron run re-detected all 25 files and fired another agent event | Added `.agent-pending` lockfile; skip wake if pending | 2026-02-07 |
| 3 | `download_file.js` file descriptor leak via `fs.open()` + `createWriteStream({fd})` | Replaced with `fs.createWriteStream(destPath)` directly | 2026-02-07 |
| 4 | `CREDENTIALS_PATH` declared but unused in both JS files | Removed dead code | 2026-02-07 |
| 5 | `SKILL.md` referenced `gog` CLI but implementation uses Node.js | Updated SKILL.md to reference `node download_file.js` | 2026-02-07 |
| 6 | `sync.log` grows unbounded | Added log rotation (keep last 500 lines) at script start | 2026-02-07 |
| 7 | `.agent-pending` lockfile created a deadlock — if agent failed, lock stayed forever and no re-wake would occur | Added 30-minute staleness check; stale locks are deleted and agent is re-woken | 2026-02-07 |
| 8 | `get_remote_state.js` didn't paginate — would silently miss files beyond the first 100 | Added `nextPageToken` loop to fetch all pages | 2026-02-07 |
| 9 | SKILL.md categorization rules were too generic | Enriched with context-aware heuristics (e.g., "Board Meeting" → Home area, not generic meetings) | 2026-02-07 |

### Still TODO
- [ ] Magnus needs to process the initial 25 files (categorize + populate mapping)
- [ ] Token refresh — `google.auth.fromJSON()` doesn't auto-refresh expired OAuth tokens. When the token expires, all syncs will silently fail. Consider migrating to full OAuth2 client with refresh token support.
- [ ] Extract shared `lib/auth.js` — both JS files have identical `loadSavedCredentialsIfExist()`. Low priority but would DRY it up.
- [ ] Centralize config constants (Drive folder ID, account email) into a `config.json` instead of hardcoding across files.

---

## Requirements
1.  **Frequency:** Check for changes every 10 minutes via cron.
2.  **Filter:** Only sync files with the `.note` extension.
3.  **Discovery (Bash + Node.js):**
    - `check-and-sync.sh` calls `get_remote_state.js` to index all remote `.note` files in source folder (`19NabfLOmVIvqNZmI0PJYOwSLcPUSiLkK`).
    - Compares against `sync-mapping.json` containing `fileId`, `remoteName`, `localPath`, and `lastModified`.
4.  **Path A: Non-Intelligent Update (Bash + Node.js, zero tokens):**
    - If a file is **KNOWN** (exists in mapping) but **UPDATED** (remote timestamp > local timestamp):
      - Download it directly to its mapped `localPath` using `node download_file.js`.
      - Update the timestamp in the mapping.
      - **Zero token cost.**
5.  **Path B: Intelligent Filing (Agent Assisted):**
    - If a file is **NEW** (not in mapping):
      - **Wake up Magnus (the Agent)** via `openclaw system event`.
      - Magnus downloads the new file(s) using `node download_file.js`.
      - Magnus categorizes by filename heuristics into the PARA structure.
      - Magnus adds the new mapping(s) to `sync-mapping.json`.
      - Magnus moves files to final destination.
      - Magnus removes `.agent-pending` lockfile on completion.
      - **Optimized:** Batch multiple new files into a single agent turn.
      - **Guard:** Won't re-wake if `.agent-pending` lockfile exists (<30 min old). Stale locks are auto-cleared.
6.  **Reliability:** Log all sync activities; handle network/auth errors gracefully. Log auto-rotates at 500 lines.

---

## Technical Design

### Data Structure: `sync-mapping.json`
```json
{
  "files": [
    {
      "fileId": "1XFK...",
      "remoteName": "PRD Driven Design.note",
      "localPath": "/path/to/vault/1-Projects/Supernote/PRD Driven Design.note",
      "lastModified": "2026-02-07T05:31:50.651Z"
    }
  ]
}
```

### Script 1: `check-and-sync.sh` (The Cron Target)

**Prerequisites:**
- Node.js with `googleapis` available (via `NODE_PATH` pointing to `google-tasks/node_modules`)
- OAuth token at `../google-docs/scripts/token.json`
- `jq` installed for JSON parsing
- Skill directory: `~/.openclaw/workspace/skills/supernote-sync/`

**Key behaviors:**
- Fetches remote file list via `node get_remote_state.js`
- Path A: downloads known-but-updated files via `node download_file.js`, updates mapping timestamp
- Path B: accumulates new file IDs, wakes agent once with the full batch
- Re-wake guard: writes `.agent-pending` lockfile when waking; skips wake if lockfile <30 min old; auto-clears stale locks and re-wakes
- Log rotation: trims `sync.log` to 500 lines at script start

### Script 2: `get_remote_state.js`

Lists all `.note` files in the configured Drive folder. Paginates automatically (100 per page) to handle any folder size. Outputs JSON array to stdout:
```json
[{"id": "...", "name": "File.note", "modifiedTime": "2026-..."}]
```

### Script 3: `download_file.js`

Downloads a single file by ID:
```bash
node download_file.js <fileId> <destPath>
```

### Magnus's Role (Path B — The Intelligent Handshake)

**Trigger:** System event matching pattern `supernote-sync: new files [...]`

**Event Payload Format:**
```
supernote-sync: new files ["1XFK...", "2YGL..."]
```

**Processing Steps:**

1. **Parse Event:** Extract file IDs from the event text.
2. **Download to Buffer:**
   ```bash
   SKILL_DIR="$HOME/.openclaw/workspace/skills/supernote-sync"
   NODE_PATH="$HOME/.openclaw/workspace/skills/google-tasks/node_modules"
   mkdir -p /tmp/supernote-buffer
   for id in $(echo "$FILE_IDS" | jq -r '.[]'); do
     export NODE_PATH && node "$SKILL_DIR/download_file.js" "$id" "/tmp/supernote-buffer/$id.note"
   done
   ```
3. **Categorize Files** using PARA heuristics (see below).
4. **Update Mapping** in `sync-mapping.json`.
5. **Move to Final Destination** and `mkdir -p` parent dirs.
6. **Cleanup:** `rm -rf /tmp/supernote-buffer`
7. **Remove lockfile:** `rm -f "$SKILL_DIR/.agent-pending"`

**Error Handling:**
- If download fails: Log error, skip file, continue with others.
- If categorization uncertain: Default to inbox path, log for review.
- If move fails (permissions, path doesn't exist): Create parent dirs, retry once.

---

## Files

| File | Purpose | Status |
|------|---------|--------|
| `check-and-sync.sh` | Cron target: updates + new file detection | ✅ Working |
| `get_remote_state.js` | Node.js: list remote `.note` files | ✅ Working |
| `download_file.js` | Node.js: download file by ID | ✅ Fixed (v3) |
| `sync-mapping.json` | Persistent file mapping (fileId → localPath) | ✅ Schema ready, empty pending agent |
| `sync.log` | Rolling log of sync operations | ✅ Auto-rotating |
| `SKILL.md` | Agent instructions for Path B | ✅ Updated (v3) |
| `PRD.md` | This document | ✅ Current |

---

## PARA Categorization Rules

Canonical rules live in `SKILL.md` (Magnus's reference). Summary below; see SKILL.md for full context-aware examples.

| Filename Pattern | Destination | Notes |
|------------------|-------------|-------|
| `Meeting*`, `Notes - Meeting*` | `2-Areas/Meetings/` | Meeting notes |
| `Board Meeting*` | `2-Areas/Home/` | HOA board — context-dependent, not generic meetings |
| `Bus renovation*`, `Floor Install*` | `1-Projects/Bus Renovation/` or `2-Areas/Bus Renovation/` | Investigate content to decide project vs. area |
| `Journal*`, `Daily*` | `2-Areas/Journal/YYYY/` | Date-based journaling |
| `Draft*`, `Writing*` | `1-Projects/Writing/Drafts/` | Work in progress |
| `Reference*`, `Cheatsheet*` | `3-Resources/<AREA>/` | Reference material, categorized |
| `Interview*`, `Onboarding*` | `2-Areas/Career/` | Work/career related |
| `GitHub*` | `2-Areas/Career/` or `1-Projects/GitHub/<AREA>` | Could be career area or active project |
| `<Ambiguous>` | `3-Resources/Supernote/Inbox/` | Default inbox for triage |

**Key principle:** Use PARA semantics — if it's an active effort with a deadline, it's a Project. If it's an ongoing area of responsibility, it's an Area. If it's reference material, it's a Resource. When uncertain, ask Jesten or default to Inbox.

---

## Design Decisions (Q&A Archive)

### Q1: How should the shell script notify OpenClaw to "wake" the agent?

**Decision:** Use `openclaw system event --mode now`. Enqueues a system event that triggers a heartbeat turn. The event text becomes context for Magnus.

### Q2: Robust ISO 8601 timestamp comparison in Bash?

**Decision:** `date -d "$TS" +%s` with `|| echo 0` fallback for malformed timestamps (treats as "always sync").

### Q3: Batching logic to avoid multiple agent wakes?

**Decision:** Single-pass accumulation (Pattern A). The 10-minute cron interval already provides natural batching. Added `.agent-pending` lockfile as a re-wake guard with 30-minute staleness timeout — prevents redundant wakes while ensuring a failed agent attempt doesn't permanently block future wakes.

