---
name: obsidian-scribe
description: The authoritative skill for creating and updating Obsidian notes in the user's Second Brain (PARA). Enforces formatting, linting, and structural rules automatically.
---

# Obsidian Scribe

Use this skill for ALL Obsidian note creation and updates. Do not use generic `write` or `edit` tools on Markdown files in the Obsidian vault (`/mnt/c/Users/Jherr/Documents/remote-personal/`).

## Delegation Protocol (Hybrid)

**Goal:** Minimize Main Session context bloat and optimize token costs.

### 1. Delegate to Sub-Agent (High-Context / Analysis)
**Trigger:** Any task that requires **Reading** file content, **Analyzing** structure, or **Deciding** a destination.
*   "Organize this unfiled note."
*   "Read this PDF/Image and create a note."
*   "Summary of X..."
*   "Where should I put...?"

**Action:** Spawn a sub-agent (`sessions_spawn`) to handle the heavy lifting.
**Why:** Keeps raw file content (junk data) out of the Main Session history and uses the cheaper model (Flash) for reading/processing.

### 2. Execute Directly (Atomic / Low-Context)
**Trigger:** Specific, "blind" operations where the **Target** and **Action** are already known/provided.
*   "Archive `2-Areas/Work/Broadcom.md`."
*   "Append 'Call Mom' to `Inbox.md`."
*   "Move `Draft.md` to `1-Projects/Beta/`."

**Action:** Call `scribe_*` tools directly from the Main Agent.
**Why:** Spawning a sub-agent (~1k+ tokens overhead) is wasteful for a ~50-token atomic action. Direct execution is faster and cheaper.

## Rules of Engagement (Mandatory)

1.  **Search First:** Before creating a new note, ALWAYS run `memory_search` (and/or `obsidian-cli search`) to see if a relevant note already exists.
2.  **PARA Structure:** Place new notes in the correct folder:
    *   `1-Projects/`: Active projects with a goal and deadline.
    *   `2-Areas/`: Ongoing responsibilities without a deadline (Health, Finance, Home).
    *   `3-Resources/`: Topics of interest or reference.
    *   `4-Archive/`: Completed projects or inactive areas.
3.  **Tags:** Always include relevant tags in the content (e.g., `#idea`, `#tech`). The linter will automatically move them to the frontmatter.
4.  **Knowledge Preservation (PRIME DIRECTIVE):**
    *   **NEVER DELETE:** Do not delete notes. Do not overwrite notes with `scribe_save` if they exist.
    *   **Archive:** If a note is obsolete, move it to `4-Archive/` using `scribe_archive`.
    *   **Append:** Use `scribe_append` to add new info.
5.  **Attachments (Co-location):**
    *   **Move:** If a note is based on an image/file, move the file to the **same directory** as the note.
    *   **Rename:** Rename the file meaningfully (e.g., `Brand_Label.jpg`, not `file_123...`).
    *   **Embed:** Embed it in the note content using wiki-link syntax: `![[Filename.ext]]`.
6.  **Subfolder Preference (Documents):**
    *   When filing **bills, receipts, PDFs, or scanned images**, use a `Documents/` subfolder for the *attachment only*.
    *   **Attachment:** Move the source file (PDF/JPG) into `.../Folder/Documents/`.
    *   **Markdown Note:** Create/Move the `.md` file in the parent folder `.../Folder/` (e.g., `2-Areas/Home/`), **NOT** inside `Documents/`.
    *   **Link:** The markdown file should link to the attachment in the subdirectory: `![[Documents/Filename.pdf]]`.
7.  **Ambiguity & Confirmation:**
    *   **Two Logical Places:** If a file could logically belong in multiple locations (e.g., `Finance/Medical/` vs `Health/`), **STOP and ASK** the user for clarification before filing.
    *   **Split Destinations:** If processing a batch of similar files results in them being split across different root folders (e.g., some to `Area A`, some to `Area B`), **STOP and ASK** to confirm the intent.
    *   **Do not assume** the user wants them split based on subtle metadata differences (like patient name) without checking.
8.  **Finance Preference:**
    *   **Rule:** Any document related to **bills, invoices, statements, taxes, or payments** MUST be filed in the `Finance` Area (e.g., `2-Areas/Finance/...`), even if it relates to another Area (like Health, House, or Car).
    *   **Logic:** Financial tracking takes precedence over subject matter.
    *   **Example:** A "Medical Bill" goes to `2-Areas/Finance/Medical/`, NOT `2-Areas/Health/`.

## Workflows

### Auto-Indexing (local-rag Integration)

After every file operation (`scribe_save`, `scribe_append`, `scribe_move`, `scribe_archive`), the **local-rag** skill is automatically triggered asynchronously to re-index the affected files. This means search results from `local-rag` stay up-to-date without any manual re-indexing step. You do not need to call local-rag yourself after writes — it happens in the background.

> **See also:** [`skills/local-rag/SKILL.md`](../local-rag/SKILL.md) — the companion search tool for querying Obsidian vault content and workspace files.

### The "Organize" Workflow
When asked to organize a note or file:
1.  **Inspect Content (Mandatory):**
    *   **Markdown:** Read the file content. Check frontmatter tags and body text.
    *   **PDF:** Use `scribe_read_pdf` to extract text. Look for dates (e.g., "Tax Year 2024"), entities ("E*TRADE"), and document types ("1099-B").
    *   **Image:** Use the `image` tool to describe the image content (e.g., "Receipt from Home Depot", "Screenshot of error").
2.  **Analyze** the content to determine the best PARA location.
    *   **Context First:** Prioritize the *content* (dates, topics) over the filename.
    *   **PARA Logic:**
        *   Project (Goal + Deadline)? -> `1-Projects/Name/...`
        *   Area (Standard of maintaining)? -> `2-Areas/Topic/...`
        *   Resource (Topic/Reference)? -> `3-Resources/Category/...`
3.  **Propose** the new path to the user (including any new subfolders).
4.  **Execute** using `scribe_move` upon approval.

## Companion Tool: local-rag

For **searching** Obsidian vault content, use the [`local-rag`](../local-rag/SKILL.md) skill. It provides semantic and keyword search across all indexed notes. Obsidian-scribe handles writes; local-rag handles reads/search.

## Tools

### scribe_save (Create Only)

Creates a NEW Obsidian note. Fails if the file already exists.

**Parameters:**
- `path`: Path to the file. Relative paths resolve to Vault Root (`/mnt/c/Users/Jherr/Documents/remote-personal/`).
- `content`: The full markdown content.

**Usage:**
```bash
node /home/jherrild/.openclaw/workspace/skills/obsidian-scribe/write.js "<path>" "<content>"
```

### scribe_append (Update/Log)

Appends text to the end of an existing note. Use for adding thoughts, logs, or new details to a running list.

**Parameters:**
- `path`: Path to the file. Relative paths resolve to Vault Root.
- `content`: The text to append (will be separated by a blank line).

**Behavior:**
1.  Reads existing file.
2.  Appends content with proper spacing.
3.  Runs the linter (updates `date modified`, merges new tags into frontmatter).

**Usage:**
```bash
node /home/jherrild/.openclaw/workspace/skills/obsidian-scribe/append.js "<path>" "<content>"
```

### scribe_move (Organize/Rename)

Moves a note to a new location. Creates destination directories if needed.

**Document co-movement:** When moving a `.md` file, `scribe_move` automatically scans for `![[documents/...]]` links in the content. Any linked files found in the source `documents/` subfolder are moved to `<destination>/documents/` alongside the note. Empty source `documents/` directories are cleaned up.

**Sync mapping update:** If the moved file is tracked by `supernote-sync`, the YAML mapping (`<vault>/metadata/supernote-sync-mapping.md`) is automatically updated with the new `mdPath` and `pdfPath`.

**Parameters:**
- `source`: Source file path (Relative to Vault or Absolute).
- `destination`: Destination path (Relative to Vault or Absolute).

**Usage:**
```bash
node /home/jherrild/.openclaw/workspace/skills/obsidian-scribe/move.js "<source>" "<destination>"
```

### scribe_archive (Move to Archive)

Moves a note to the `4-Archive` folder. Handles naming collisions automatically.

**Parameters:**
- `path`: Path to the file to be archived. Relative paths resolve to Vault Root.

**Usage:**
```bash
node /home/jherrild/.openclaw/workspace/skills/obsidian-scribe/archive.js "<path>"
```

### scribe_read_pdf (Extract Text)

Extracts text content from a PDF file. Use this during the "Organize" workflow to inspect PDF contents for context (dates, companies, types).

**Parameters:**
- `path`: Path to the PDF file. Relative paths resolve to Vault Root.

**Usage:**
```bash
node /home/jherrild/.openclaw/workspace/skills/obsidian-scribe/read_pdf.js "<path>"
```
