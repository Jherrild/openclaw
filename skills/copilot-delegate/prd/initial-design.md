# PRD: Copilot Delegate Skill

> **Last updated:** 2026-02-08
> **Status:** Auto-commit feature added

## Goal

Give Magnus a way to delegate coding tasks to GitHub Copilot CLI (which runs a full-context AI coding agent). This ensures complex code work is handled by a purpose-built coding agent with file access, while Magnus focuses on orchestration, categorization, and user interaction.

## Design Principles

1. **No wrapper scripts.** The Copilot CLI is already well-designed — SKILL.md documents the calling conventions.
2. **Minimal token cost to Magnus.** Magnus gets results via a small summary file (~100 tokens), not the full session transcript.
3. **Full audit trail for the human.** Session transcripts are saved for review but never loaded into Magnus's context.
4. **Workspace-anchored.** Always run from `~/.openclaw/workspace/` so Copilot picks up `copilot-instructions.md`.
5. **Auto-commit on success.** Copilot commits its own changes after a successful task, using conventional commit messages. Commit instructions are embedded in the prompt directive — no wrapper script needed.

## Architecture

```
Magnus (OpenClaw agent)
  │
  ├─ Writes prompt with task + context
  ├─ Calls: copilot -p "..." --model claude-opus-4.6 --allow-all --share <transcript>
  ├─ Checks: $? for exit code
  ├─ Reads: last-result.md (~100 tokens) for outcome summary
  └─ Optionally: grep transcript for specific details
```

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Magnus's operating instructions |
| `last-result.md` | Summary written by Copilot after each task (overwritten each run) |
| `sessions/` | Full session transcripts (`--share` output) for human audit |
| `prd/initial-design.md` | This document |

## Decided NOT To Do

| Idea | Reason |
|------|--------|
| Wrapper shell script | CLI already has clean flags; wrapper adds maintenance burden and failure modes |
| Parse Copilot output programmatically | Output format isn't stable; summary file convention is simpler and reliable |
| Automatic retry on failure | Too risky without human judgment; Magnus should report failure and let user decide |

## Implementation Status

### Done
- [x] SKILL.md with full workflow, tools, and rules
- [x] Session marker convention (`.copilot-session` per skill)
- [x] Summary file convention (`last-result.md` overwritten each run)
- [x] Session transcript archival (`--share` to `sessions/`)
- [x] Concurrency guard (`pgrep` check before invocation)
- [x] Session cleanup policy (keep newest 5, prune excess >30 days)
- [x] Process detection pattern tested (`pgrep -f "node.*\.npm-global/bin/copilot"`)
- [x] Post-task auto-commit: Copilot auto-commits changes after successful tasks via prompt directive

### Still TODO

- [ ] Test end-to-end: Magnus delegates a simple task, reads result, verifies auto-commit
- [ ] Consider adding MCP server configs if Copilot needs access to specific tools
