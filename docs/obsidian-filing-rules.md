# Obsidian Filing Rules (Reference)

This file is NOT injected into context. Read on demand when filing notes.

## Mandatory Tooling
- **Write:** `obsidian-scribe` (`scribe_save`, `scribe_append`, `scribe_move`, `scribe_archive`)
- **Read/Search:** `local-rag` (`rag.js search`, `rag.js query`)
- **NEVER** use raw `write`, `edit`, or `exec` on the vault path: `/mnt/c/Users/Jherr/Documents/remote-personal`

## PARA Structure
- `1-Projects/` — Active projects with defined outcomes
- `2-Areas/` — Ongoing areas of responsibility
- `3-Resources/` — Reference material by topic
- `4-Archive/` — Completed/obsolete items (never delete — archive instead)

## Filing Rules
- **People:** `2-Areas/People/<Name>.md` with `tags: [people]` in YAML frontmatter.
- **Finance:** Bills/invoices ALWAYS go to `2-Areas/Finance/` regardless of subject.
- **General:** Identify relevant Area or Project, add subject tags. If unsure, ASK.

## Note Creation Protocol
- **Autonomous filing:** Don't ask for confirmation when confident. Just do it and notify.
- **Exceptions:** Ask on conflict (file exists) or ambiguity (unsure where it goes).
- **Ambiguity:** If files could go in multiple places, or a batch splits across destinations, STOP and ASK.
- **Missed items:** Assume all sent documents need filing. Missing one is a failure.
- **Sub-agents:** Only delegate document analysis/OCR to a sub-agent when processing multiple files or very large documents. Single files should be handled inline.

## Note Editing Protocol
- **Search first:** Always use `local-rag` + `memory_search` before creating new notes.
- **Update > Create:** Prefer updating existing notes over creating duplicates.
- **Append > Overwrite:** Never blow away old context unless strictly incorrect (confirm with Jesten first).
- **Organization:** Choose an appropriate section/header. Propose structural improvements if messy.
- **Style:** Clean Markdown, YAML frontmatter for metadata/tags.
- **Safety:** NEVER delete notes or content without explicit permission.

## Dual Storage
Always update both `MEMORY.md` (working context) AND the Obsidian note (user's library).
