# Copilot Instructions — OpenClaw Workspace

## Before You Start

**Read [OPENCLAW_SKILL_DEV_GUIDE.md](OPENCLAW_SKILL_DEV_GUIDE.md) first.** It contains critical architecture context, lessons learned, and common mistakes to avoid when working on OpenClaw skills. Skipping it will lead to the same bugs we've already fixed.

## What This Workspace Is

This is the shared workspace for **Magnus**, an OpenClaw AI agent. OpenClaw is a local agent framework that runs persistent agents communicating via Telegram, executing cron jobs, and maintaining memory across sessions. Magnus's workspace is at `~/.openclaw/workspace/`.

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
Synchronizes Supernote `.note` files from Google Drive to the Obsidian vault. Cron script handles all Google Drive access; agent only works with pre-downloaded local files.
- **Scripts:** `check-and-sync.sh` (cron target), `get_remote_state.js` (list files), `download_file.js` (download by ID)
- **Key data:** `sync-mapping.json` (file ID → vault path), `.agent-pending` (manifest/lockfile), `buffer/` (pre-downloaded files)
- **Dependencies:** `google-tasks` (node_modules), `google-docs` (OAuth token), `obsidian-scribe` (file placement), `local-rag` (vault search)

## Dependency Graph

```
google-tasks (standalone — owns credentials + node_modules)
    ↑
google-docs (uses google-tasks credentials)
    ↑
supernote-sync (uses google-docs token + google-tasks node_modules)
    ↓
obsidian-scribe (file placement) ← local-rag (vault search)
```

## Key Conventions

1. **SKILL.md is the agent's API contract.** If you change script behavior, update SKILL.md.
2. **Decouple IO from intelligence.** Scripts do API calls/downloads; agents work with local files.
3. **Lockfiles need staleness guards.** Never create a lockfile without a timeout mechanism.
4. **Use existing tools.** Check `obsidian-scribe` and `local-rag` before writing raw bash for vault operations. Prefer using local, existing tools- either MCP's via `MCPORTER`, or `CLI` tools, over direct API calls, or writing custom ones, for better error handling and consistency.
5. **Back up state files.** Any accumulating JSON should have automatic `.bak` before mutation.
6. **Test with `bash -n`** before committing shell scripts.
