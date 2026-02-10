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

### 1.2 Move Mapping to Vault (YAML in Markdown)
- Migrate `sync-mapping.json` to `<vault>/metadata/supernote-sync-mapping.md`
- Vault path: `/mnt/c/Users/Jherr/Documents/remote-personal/metadata/`
- **Format change:** Store as YAML inside a `.md` file, not JSON. Obsidian renders YAML natively, and it's human-readable/editable from the vault.
- Create `metadata/` directory if it doesn't exist
- Update all references in `check-and-sync.sh` and agent tools to read/write YAML
- Keep the `.bak` backup alongside it in `metadata/`
- This ensures the mapping is backed up with the vault (Obsidian vault has its own backup)

**File structure (`supernote-sync-mapping.md`):**
```markdown
---
description: Supernote file sync mappings (auto-managed by supernote-sync)
---

- fileId: "1xyj92mjwGo..."
  name: "Board Meeting 12.16.note"
  mdPath: "2-Areas/Home/Board Meeting 12.16.md"
  pdfPath: "2-Areas/Home/documents/Board Meeting 12.16.pdf"
  modifiedTime: "2026-01-31T17:56:27.577Z"

- fileId: "1Zq_GR7HUGKj..."
  name: "Taxes 2024.note"
  mdPath: "2-Areas/Finance/Taxes/Taxes 2024.md"
  pdfPath: "2-Areas/Finance/Taxes/documents/Taxes 2024.pdf"
  modifiedTime: "2026-01-31T17:56:29.595Z"
```

Paths in the YAML are **relative to the vault root** for portability.

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
When a note's .md file is moved using `scribe_move`, two things must happen:

**A. Move linked documents:**
- Scan the .md file for `![[documents/...]]` links
- For each linked file, move it from `<old-path>/documents/<file>` to `<new-path>/documents/<file>`
- Create destination `documents/` directory if needed

**B. Update sync mapping:**
- After moving, check `<vault>/metadata/supernote-sync-mapping.md` for any entry whose `mdPath` or `pdfPath` matches the old location
- If found, update both `mdPath` and `pdfPath` to reflect the new location
- This keeps the mapping in sync without requiring the agent to manually update it

This means the mapping file is **always correct** regardless of whether files are moved by the agent, by the user reorganizing their vault, or by any scribe operation.

### 2.3 Updated Mapping Schema
The mapping now uses YAML in a `.md` file (see §1.2). Each entry tracks the vault .md and .pdf paths (not the .note path):
```yaml
- fileId: "1xyj92mjwGo..."
  name: "Board Meeting 12.16.note"
  mdPath: "2-Areas/Home/Board Meeting 12.16.md"
  pdfPath: "2-Areas/Home/documents/Board Meeting 12.16.pdf"
  modifiedTime: "2026-01-31T17:56:27.577Z"
```
Paths are relative to vault root for portability.

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
| `supernote-sync/check-and-sync.sh` | Fix buffer bug, new mapping path (YAML), add conversion step |
| `supernote-sync/get_new_notes.js` | NEW — Agent tool |
| `supernote-sync/get_updated_notes.js` | NEW — Agent tool |
| `supernote-sync/store_markdown.js` | NEW — Agent tool |
| `supernote-sync/obsidian_migrate.js` | NEW — Agent tool |
| `supernote-sync/SKILL.md` | Rewrite with new workflow |
| `obsidian-scribe/move.js` | Move linked /documents/ files + update sync mapping |
| `<vault>/metadata/supernote-sync-mapping.md` | NEW — YAML mapping in vault |
