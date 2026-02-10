# PRD: Supernote Sync & Obsidian Integration Overhaul

## Problem

The current supernote-sync workflow has several issues:
1. **Buffer bug:** Known notes re-appear in the buffer (timestamp comparison or mapping lookup issue).
2. **Fragile mapping:** `sync-mapping.json` lives in the skill directory — if lost, all file associations are gone. It's not backed up with the vault.
3. **Raw .note files in vault:** Obsidian can't render `.note` files. They're opaque blobs.
4. **Manual agent workflow:** The agent manually moves files with raw tool calls, which is error-prone and multi-step.
5. **No text extraction:** The agent can't read note contents for categorization without opening the file.

## Solution

Three-stage overhaul that converts .note files into Obsidian-native content (PDF + markdown) and gives the agent clean, single-call tools.

---

## Stage 1: Fix Sync, Move Mapping, Add Conversion

### 1.1 Fix Buffer Bug
- Audit `check-and-sync.sh` timestamp comparison logic (epoch conversion, mapping lookup)
- Ensure known files with unchanged `modifiedTime` are skipped entirely (no download, no buffer entry)
- Add logging for skip decisions to aid debugging

### 1.2 Move Mapping to Vault
- Move `sync-mapping.json` to `<vault>/metadata/supernote-sync-mapping.json`
- Vault path: `/mnt/c/Users/Jherr/Documents/remote-personal/metadata/`
- Create `metadata/` directory if it doesn't exist
- Update all references in `check-and-sync.sh` to use the new path
- Keep the `.bak` backup alongside it in `metadata/`
- This ensures the mapping is backed up with the vault (Obsidian vault has its own backup)

### 1.3 Install Conversion Tools
- **`supernote_pdf`** (Rust): Install via `cargo install supernote_pdf`. Converts .note → .pdf (raster page images, fast).
- **`supernote-tool`** (Python): Install via `pip install supernotelib`. Converts .note → .txt (extracts real-time recognized text from Supernote firmware).

### 1.4 Automatic Conversion in Sync Script
After downloading a .note file (both new AND updated), the sync script:

1. Creates a directory named after the note: `buffer/<NoteName>/`
2. Moves the .note file into it: `buffer/<NoteName>/<NoteName>.note`
3. Runs `supernote_pdf -i <note> -o <NoteName>.pdf` → `buffer/<NoteName>/<NoteName>.pdf`
4. Runs `supernote-tool convert -t txt -a <note> <NoteName>.txt` → `buffer/<NoteName>/<NoteName>.txt`
5. The manifest (.agent-pending) references the directory, not individual files

**This happens BEFORE the agent is woken.** By the time the interrupt fires, every note is a directory containing `.note`, `.pdf`, and `.txt` files.

For updated files (Path A), conversion also runs before copying to the mapped location.

---

## Stage 2: Obsidian-Native Storage & Scribe Integration

### 2.1 Document Protocol
Instead of storing raw .note files in the vault, follow the existing document protocol from obsidian-scribe:

**Per note, the vault gets:**
- `<PARA-path>/<NoteName>.md` — Markdown file containing the extracted text from the .txt file, with embedded links to the PDF
- `<PARA-path>/documents/<NoteName>.pdf` — The rendered PDF of the note pages

**Example:** A note called "Board Meeting 12.16" filed under `2-Areas/Home/`:
```
2-Areas/Home/Board Meeting 12.16.md          ← contains extracted text + PDF embed
2-Areas/Home/documents/Board Meeting 12.16.pdf  ← rendered pages
```

The .md file structure:
```markdown
---
tags: [supernote]
source: supernote-sync
fileId: <google-drive-file-id>
---

# Board Meeting 12.16

![[documents/Board Meeting 12.16.pdf]]

---

<extracted text content from .txt file>
```

### 2.2 Move Coordination with Obsidian Scribe
When a note's .md file is moved using `scribe_move`, any linked files in `/documents/` must also be moved to keep them co-located.

**Change to obsidian-scribe's move.js:**
- When moving a .md file, scan it for `![[documents/...]]` links
- For each linked file, move it from `<old-path>/documents/<file>` to `<new-path>/documents/<file>`
- Create destination `documents/` directory if needed

### 2.3 Updated Mapping Schema
The mapping now tracks the vault .md path (not the .note path):
```json
{
  "<fileId>": {
    "name": "Board Meeting 12.16.note",
    "mdPath": "/mnt/c/.../2-Areas/Home/Board Meeting 12.16.md",
    "pdfPath": "/mnt/c/.../2-Areas/Home/documents/Board Meeting 12.16.pdf",
    "modifiedTime": "2026-02-10T..."
  }
}
```

---

## Stage 3: Agent Tools & Streamlined Workflow

### 3.1 supernote-sync Tools (for the agent)

#### `get_new_notes`
Returns JSON array of new notes that need categorization:
```json
[
  {
    "fileId": "1XFK...",
    "name": "PRD Driven Design",
    "text": "<full extracted text from .txt>",
    "pdfPath": "/path/to/buffer/PRD Driven Design/PRD Driven Design.pdf",
    "modifiedTime": "2026-..."
  }
]
```

#### `get_updated_notes`
Returns JSON array of updated notes (already mapped, just refreshed):
```json
[
  {
    "fileId": "2YGL...",
    "name": "Journal Entry",
    "text": "<full extracted text>",
    "pdfPath": "/path/to/buffer/Journal Entry/Journal Entry.pdf",
    "mdPath": "/mnt/c/.../existing/path/Journal Entry.md",
    "modifiedTime": "2026-..."
  }
]
```

#### `store_markdown`
Takes a fileId and markdown content. Writes the .md file into the buffer directory alongside the PDF and .txt:
```
store_markdown --file-id <id> --content "<markdown>"
```
Writes to: `buffer/<NoteName>/<NoteName>.md`

#### `obsidian_migrate`
For each entry in the pending manifest:
1. Checks that a .md file has been generated (via `store_markdown`)
2. Reads the mapping to find the target vault path
3. Copies `.pdf` → `<vault-path>/documents/<NoteName>.pdf`
4. Copies `.md` → `<vault-path>/<NoteName>.md`
5. Updates `sync-mapping.json` with the new paths
6. Cleans up the buffer directory for that note
7. Removes the entry from `.agent-pending`

**For new notes:** The agent must first set the mapping (categorize) before calling migrate.

**For updated notes:** The mapping already exists; migrate overwrites in place.

### 3.2 Agent Workflow (documented in SKILL.md)

When woken by interrupt:

```
1. Call get_new_notes → see what's new
2. Call get_updated_notes → see what changed
3. For each NEW note:
   a. Read the text content
   b. Categorize into PARA location (ask user if uncertain)
   c. Set the mapping (vault destination)
   d. Call store_markdown with enriched .md content
4. For each UPDATED note:
   a. Read the text content
   b. Call store_markdown to refresh the .md
5. Call obsidian_migrate → moves everything to vault
6. Done. No manual file operations needed.
```

---

## Dependencies

| Tool | Install | Purpose |
|------|---------|---------|
| `supernote_pdf` | `cargo install supernote_pdf` | .note → .pdf (fast, Rust) |
| `supernote-tool` | `pip install supernotelib` | .note → .txt (text extraction) |

Both must be in PATH for the sync script.

## Files Changed

| File | Change |
|------|--------|
| `supernote-sync/check-and-sync.sh` | Fix buffer bug, move mapping path, add conversion step |
| `supernote-sync/get_new_notes.js` | NEW — Agent tool |
| `supernote-sync/get_updated_notes.js` | NEW — Agent tool |
| `supernote-sync/store_markdown.js` | NEW — Agent tool |
| `supernote-sync/obsidian_migrate.js` | NEW — Agent tool |
| `supernote-sync/SKILL.md` | Rewrite with new workflow |
| `obsidian-scribe/move.js` | Update to move linked /documents/ files |
| `<vault>/metadata/supernote-sync-mapping.json` | NEW location for mapping |
