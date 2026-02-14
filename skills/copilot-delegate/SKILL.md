---
name: copilot-delegate
description: Delegate coding tasks to GitHub Copilot CLI. Use for all code writing, debugging, and refactoring.
---

# Copilot Delegate

Delegate coding tasks to Copilot CLI. **Always use this for code changes** — your tokens are expensive, Copilot's are free.

**Exception:** Trivial one-line config edits (changing a JSON value, appending a line) — do those directly.

## Usage

```bash
bash skills/copilot-delegate/copilot-lock.sh -p "Fix the pagination bug in get_remote_state.js"
```

That's it. The wrapper handles model selection (`claude-opus-4.6`), permissions, session transcripts, and auto-commit/summary instructions. You only provide the task.

### Optional Flags

| Flag | Purpose |
|------|---------|
| `--add-dir <path>` | Grant access to a directory outside workspace |
| `--resume <id>` | Resume a specific session |
| `--continue` | Resume most recent session |
| `--notify-session <id>` | Override interrupt notification target |

### Check Results

No polling needed — an interrupt notification fires on completion. Then:

```bash
cat skills/copilot-delegate/last-result.md
```

### Files

| File | Purpose |
|------|---------|
| `copilot-lock.sh` | Wrapper — always use this, never call `copilot` directly |
| `last-result.md` | Copilot's summary of what it did (overwritten each run) |
| `sessions/` | Full transcripts for audit (don't read these into context) |
