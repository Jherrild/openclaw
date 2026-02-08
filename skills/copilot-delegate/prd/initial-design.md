# PRD: Copilot Delegate Skill

> **Last updated:** 2026-02-08
> **Status:** Mutex lock wrapper implemented

## Goal

Give Magnus a way to delegate coding tasks to GitHub Copilot CLI (which runs a full-context AI coding agent). This ensures complex code work is handled by a purpose-built coding agent with file access, while Magnus focuses on orchestration, categorization, and user interaction.

## Design Principles

1. **Concurrency-safe via mutex lock.** A wrapper script (`copilot-lock.sh`) serializes all Copilot CLI invocations using a lock file with PID tracking, stale lock detection, and trap-based cleanup.
2. **Minimal token cost to Magnus.** Magnus gets results via a small summary file (~100 tokens), not the full session transcript.
3. **Full audit trail for the human.** Session transcripts are saved for review but never loaded into Magnus's context.
4. **Workspace-anchored.** Always run from `~/.openclaw/workspace/` so Copilot picks up `copilot-instructions.md`.
5. **Auto-commit on success.** Copilot commits its own changes after a successful task, using conventional commit messages. Commit instructions are embedded in the prompt directive.

## Architecture

```
Magnus (OpenClaw agent)
  │
  ├─ Writes prompt with task + context
  ├─ Calls: bash copilot-lock.sh -p "..." --model claude-opus-4.6 --allow-all --share <transcript>
  │         ↓
  │   copilot-lock.sh:
  │     1. Check for existing .copilot.lock
  │     2. If locked: check PID alive + age → stale? remove : wait (exp backoff, 10min max)
  │     3. Acquire lock atomically (mkdir + write PID/timestamp)
  │     4. Execute: copilot "$@"
  │     5. Release lock (trap EXIT/INT/TERM/HUP guarantees cleanup)
  │
  ├─ Checks: $? for exit code
  ├─ Reads: last-result.md (~100 tokens) for outcome summary
  └─ Optionally: grep transcript for specific details
```

### Lock File Format (`.copilot.lock`)

```
pid=<owner PID>
ts=<unix timestamp>
session=<session ID or "unknown">
```

### Concurrency Behavior

| Scenario | Behavior |
|----------|----------|
| No lock exists | Acquire immediately, run task |
| Lock held by live process | Wait with exponential backoff (2s→4s→8s→...→30s cap) up to 10 min |
| Lock held by dead PID | Clear stale lock, acquire, run task |
| Lock older than 5 min | Clear stale lock regardless of PID status |
| Lock file malformed | Treat as stale, clear and acquire |
| Task exits/crashes/interrupted | Trap releases lock automatically |
| Timeout exceeded | Exit with error code 1 |

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Magnus's operating instructions |
| `copilot-lock.sh` | Mutex wrapper script — serializes Copilot CLI access |
| `.copilot.lock` | Lock file (auto-managed — contains PID, timestamp, session ID) |
| `last-result.md` | Summary written by Copilot after each task (overwritten each run) |
| `sessions/` | Full session transcripts (`--share` output) for human audit |
| `prd/initial-design.md` | This document |

## Decided NOT To Do

| Idea | Reason |
|------|--------|
| Parse Copilot output programmatically | Output format isn't stable; summary file convention is simpler and reliable |
| Automatic retry on failure | Too risky without human judgment; Magnus should report failure and let user decide |
| flock-based locking | Not portable across all environments; `mkdir` atomicity is POSIX-guaranteed and simpler |
| Separate lock daemon | Over-engineered; a simple lock file with PID tracking is sufficient for single-machine use |

## Implementation Status

### Done
- [x] SKILL.md with full workflow, tools, and rules
- [x] Session marker convention (`.copilot-session` per skill)
- [x] Summary file convention (`last-result.md` overwritten each run)
- [x] Session transcript archival (`--share` to `sessions/`)
- [x] Concurrency guard — mutex lock via `copilot-lock.sh` wrapper (replaces old `pgrep` approach)
- [x] Stale lock detection (dead PID check + age timeout)
- [x] Exponential backoff with configurable max wait
- [x] Trap-based lock cleanup (EXIT/INT/TERM/HUP)
- [x] Atomic lock acquisition via `mkdir`
- [x] Session cleanup policy (keep newest 5, prune excess >30 days)
- [x] Post-task auto-commit: Copilot auto-commits changes after successful tasks via prompt directive

### Still TODO

- [ ] Test end-to-end: Magnus delegates a simple task, reads result, verifies auto-commit
- [ ] Consider adding MCP server configs if Copilot needs access to specific tools
