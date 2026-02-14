# Copilot Instructions — OpenClaw Workspace

## Before You Start

**Read [OPENCLAW_SKILL_DEV_GUIDE.md](OPENCLAW_SKILL_DEV_GUIDE.md) first.** It contains critical architecture context, lessons learned, and common mistakes to avoid when working on OpenClaw skills. Skipping it will lead to the same bugs we've already fixed.

## What This Workspace Is

This is the shared workspace for **Magnus**, an OpenClaw AI agent. OpenClaw is a local agent framework that runs persistent agents communicating via Telegram, executing cron jobs, and maintaining memory across sessions. Magnus's workspace is at `~/.openclaw/workspace/`. Feel free to include suggestions to Magnus in post work summaries about what you would consider changing or adding here to make it easier to work with.

Key workspace files (not skills):
- `AGENTS.md` — Agent behavior rules and conventions
- `SOUL.md` — Agent personality
- `USER.md` — Info about Jesten (the human)
- `MEMORY.md` — Long-term curated memory
- `HEARTBEAT.md` — Periodic task checklist
- `TOOLS.md` — Environment-specific notes (vault paths, SSH hosts, etc.)

## Skills Overview

All skills live under `skills/`. Each has a `SKILL.md` (the agent's operating instructions) and usually a `PRD.md` (design doc with status tracking).

### google-tasks
Google Tasks CLI for managing to-do lists.
- **Scripts:** `tasks.js` (add, list, complete tasks)
- **Key data:** Owns OAuth `credentials.json` and `token.json`; its `node_modules/` is shared by other skills via `NODE_PATH`
- **Dependencies:** None (self-contained)

### google-docs
CLI access to Google Docs and Drive APIs — create, read, search, append to documents.
- **Scripts:** `scripts/docs.js` (search, get, create, append)
- **Dependencies:** Reuses `google-tasks` credentials and `node_modules`; has its own `token.json` at `scripts/token.json`

### local-rag
Hybrid semantic + keyword search across the Obsidian vault using SQLite vectors and Ollama embeddings.
- **Scripts:** `rag.js` (index, search, query, check)
- **Dependencies:** Requires Ollama running locally (`http://localhost:11434`)
- **Used by:** `obsidian-scribe` and `supernote-sync` for de-duplication searches

### obsidian-scribe
The authoritative skill for all Obsidian vault operations — creating, moving, appending, archiving notes with PARA structure enforcement and automatic linting.
- **Scripts:** `write.js` (create), `append.js` (append + lint), `move.js` (relocate), `archive.js` (archive), `read_pdf.js` (PDF text extraction), `lint.js` (frontmatter/tag linting)
- **Dependencies:** `local-rag` for search-before-create
- **Vault path:** `/mnt/c/Users/Jherr/Documents/remote-personal/`

### supernote-sync
Synchronizes Supernote `.note` files from Google Drive to the Obsidian vault. Converts `.note` → PDF + extracted text, then stores as Obsidian-native markdown with embedded PDFs. Systemd timer script handles all Google Drive access; agent only works with pre-downloaded local files.
- **Scripts:** `check-and-sync.sh` (systemd timer target), `get_new_notes.js` (list new notes with text), `get_updated_notes.js` (list updated notes), `store_markdown.js` (write agent .md to buffer), `obsidian_migrate.js` (buffer → vault migration), `vault_update.js` (change vault root), `mapping-utils.js` (YAML mapping CLI + module)
- **Key data:** `<vault>/metadata/supernote-sync-mapping.md` (YAML mapping: file ID → vault paths), `.agent-pending` (manifest/lockfile), `buffer/` (pre-downloaded + converted note directories)
- **Dependencies:** `google-tasks` (node_modules), `google-docs` (OAuth token), `obsidian-scribe` (file placement), `local-rag` (vault search)

### copilot-delegate
Delegates coding tasks to GitHub Copilot CLI (this agent). Magnus uses this to hand off code writing, debugging, and refactoring to a specialized coding agent.
- **No scripts** — pure SKILL.md instructions for calling `copilot -p "..." --model claude-opus-4.6 --allow-all`
- **Key data:** `last-result.md` (outcome summary), `sessions/` (full transcripts for audit)
- **Dependencies:** Copilot CLI installed at `~/.npm-global/bin/copilot`

### home-presence
Gives Magnus a physical presence in the home — detects occupied rooms via Home Assistant sensors and speaks through local smart speakers using Google AI TTS.
- **Scripts:** `presence.js` (locate, announce, follow-and-speak, update-layout)
- **Key data:** Hardcoded area→speaker mappings with optional `layout.json` auto-discovery
- **Dependencies:** Home Assistant via `ha-stdio-final` MCP (bearer token from `config/mcporter.json`)

## Dependency Graph

```
google-tasks (standalone — owns credentials + node_modules)
    ↑
google-docs (uses google-tasks credentials)
    ↑
supernote-sync (uses google-docs token + google-tasks node_modules)
    ↓
obsidian-scribe (file placement) ← local-rag (vault search)

copilot-delegate (standalone — calls copilot CLI directly)

home-presence (standalone — calls Home Assistant API directly)
```

## Key Conventions

1. **SKILL.md is the agent's API contract.** If you change script behavior, update SKILL.md.
2. **Decouple IO from intelligence.** Scripts do API calls/downloads; agents work with local files.
3. **Lockfiles need staleness guards.** Never create a lockfile without a timeout mechanism.
4. **Use existing tools.** Check `obsidian-scribe` and `local-rag` before writing raw bash for vault operations. Prefer using local, existing tools- either MCP's via `MCPORTER`, or `CLI` tools, over direct API calls, or writing custom ones, for better error handling and consistency.
5. **Back up state files.** Any accumulating JSON should have automatic `.bak` before mutation.
6. **Test with `bash -n`** before committing shell scripts.
7. **Magnus never codes directly.** All code writing, debugging, and refactoring must be delegated to Copilot via `copilot-delegate`. Magnus's tokens are expensive; Copilot's are free.

## PRD-Driven Design

PRDs (Product Requirements Documents) are **mandatory** for all skills and projects in this workspace. They are living documents that track requirements, status, design decisions, and change history.

### Rules

1. **Always use a PRD.** If you're directed to work on a skill and no PRD exists, **write one before making changes.** Even small features benefit from a lightweight PRD that captures intent and tracks progress.

2. **PRDs go in `/prd/`.** New PRDs should be created inside a `prd/` subfolder within the relevant skill or project directory:
   ```
   skills/my-skill/
   ├── prd/
   │   ├── initial-design.md
   │   └── v2-refactor.md
   ├── SKILL.md
   └── ...
   ```
   If you find an existing PRD outside of `prd/` (e.g., `PRD.md` at skill root), that's fine — use it where it is. But create new ones in `prd/`.

3. **PRDs are living documents.** They are not write-once artifacts. Follow this lifecycle:
   - **Before starting work:** Read the PRD. Understand what's been done, what's changed, what's still open.
   - **During work:** Update the PRD as you make design decisions, discover issues, or change approach.
   - **After finishing work:** Update the PRD with what was completed, any new bugs found, and remaining TODOs.

### What a Good PRD Tracks

- **Implementation status** — what's done, what's in progress, what's blocked
- **Changed from original design** — what diverged and why
- **Decided NOT to do** — ideas rejected with rationale (saves future you from re-exploring dead ends)
- **Bug fixes applied** — numbered table with description, fix, and date
- **Still TODO** — open items with priority
- **Design decisions** — Q&A or rationale for non-obvious choices
