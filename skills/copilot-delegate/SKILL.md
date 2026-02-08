---
name: copilot-delegate
description: Delegate coding tasks to GitHub Copilot CLI. Magnus should ALWAYS use this for code writing, debugging, and refactoring — never attempt coding tasks directly.
---

# Copilot Delegate

Delegate coding tasks to GitHub Copilot CLI — a full-context AI coding agent that can read, write, and modify files.

## MANDATORY: Always Delegate Code

**You (Magnus) must NEVER write, debug, or refactor code yourself.** Always delegate to Copilot via this skill. Reasons:
- Copilot has **unlimited tokens** (Jesten's GitHub employee benefit) — you do not
- Copilot is a purpose-built coding agent with full file access and context
- Your tokens are expensive and should be spent on orchestration, categorization, and user interaction

The only exception is trivial one-line config edits (changing a value in JSON, appending a line). Anything involving logic, control flow, or multi-file changes goes to Copilot.

## When to Use This

- Writing or modifying code (scripts, Node.js, Python, etc.)
- Debugging errors in existing scripts
- Refactoring or restructuring files
- Code review or analysis that requires reading many files
- Creating new skills or tools
- Any task involving programming logic

**Do NOT use for:** simple file moves, appending text, quick config value changes — do those directly.

## Configuration

- **CLI Path:** `~/.npm-global/bin/copilot` (also in `$PATH` as `copilot`)
- **Working Directory:** Always `cd ~/.openclaw/workspace` before invoking (picks up `copilot-instructions.md`)
- **Default Model:** `claude-opus-4.6`
- **Session Transcripts:** `~/.openclaw/workspace/skills/copilot-delegate/sessions/`
- **Result Summary:** `~/.openclaw/workspace/skills/copilot-delegate/last-result.md`

## Tools

### copilot_delegate

Run a coding task in non-interactive mode. Copilot reads files, makes changes, and writes a summary when done.

**Parameters:**
- `prompt`: (Required) Detailed task description. Must end with the summary directive.
- `--model`: (Required) **You must always specify this flag.** The CLI does not default to a good model. Use `claude-opus-4.6` unless you have a specific reason to choose another (see model table below, or use the `copilot_models` tool to check available models).
- `--add-dir`: (Optional) Additional directory access beyond workspace. Repeatable.

**Usage:**
```bash
cd ~/.openclaw/workspace
copilot -p "<your detailed prompt here>

When finished, write a 2-3 sentence summary of what you did, what succeeded, and any issues to skills/copilot-delegate/last-result.md" \
  --model claude-opus-4.6 \
  --allow-all \
  --share "skills/copilot-delegate/sessions/$(date +%s).md"
```

Then check the result:
```bash
echo "Exit code: $?"
cat ~/.openclaw/workspace/skills/copilot-delegate/last-result.md
```

### copilot_resume

Resume a previously interrupted session.

**Usage:**
```bash
cd ~/.openclaw/workspace
copilot --continue --allow-all
```

### copilot_models

Check which models are currently available.

**Usage:**
```bash
copilot --help 2>&1 | grep -A10 '\-\-model'
```
```

## Step-by-Step Workflow

### 1. Always Start from Workspace Root if you're working on something in your workspace

```bash
cd ~/.openclaw/workspace
```

This ensures Copilot picks up `copilot-instructions.md` which contains the dev guide, skill overview, and project conventions. **Never skip this.**

### 2. Craft a Good Prompt

Include these in every delegation prompt:

- **What to do** — specific task description
- **Which files** — exact paths to read/modify (Copilot works faster with explicit paths)
- **Expected outcome** — what "done" looks like
- **Constraints** — things NOT to do, files NOT to touch
- **Summary directive** — always end with the summary instruction

**Good prompt example:**
```
Fix the pagination bug in skills/supernote-sync/get_remote_state.js.
The Drive API files.list call should loop using nextPageToken until all pages are fetched.
Read the current implementation first, then fix it.
Do not modify any other files.

When finished, write a 2-3 sentence summary of what you did, what succeeded, and any issues to skills/copilot-delegate/last-result.md
```

**Bad prompt example:**
```
Fix the sync script
```
(Too vague — no files, no expected outcome, no summary directive)

### 3. Choose a Model

**Default: `claude-opus-4.6`** — best coding model, use for anything non-trivial.

**Check available models:**
```bash
copilot --help 2>&1 | grep -A10 '\-\-model'
```

**Current model choices (as of 2026-02-07):**

| Model | Use When |
|-------|----------|
| `claude-opus-4.6` | Default. Complex code, multi-file changes, architecture decisions |
| `claude-opus-4.6-fast` | Same quality, faster. Good for time-sensitive tasks |
| `claude-sonnet-4.5` | Simpler tasks where opus is overkill (single-file fixes, small scripts) |
| `claude-haiku-4.5` | Very simple tasks, quick lookups. Cheapest option |
| `gpt-5.2-codex` | Alternative for code-heavy tasks if Claude is unavailable |

**Override model:**
```bash
copilot -p "..." --model claude-sonnet-4.5 --allow-all --share "..."
```

### 4. Handle Paths Outside Workspace

If the task involves files outside `~/.openclaw/workspace/` (e.g., the Obsidian vault), add explicit directory access:

```bash
copilot -p "..." \
  --model claude-opus-4.6 \
  --allow-all \
  --add-dir /mnt/c/Users/Jherr/Documents/remote-personal \
  --share "skills/copilot-delegate/sessions/$(date +%s).md"
```

Common extra paths:
- **Obsidian vault:** `--add-dir /mnt/c/Users/Jherr/Documents/remote-personal`
- **Temp files:** `--add-dir /tmp`

### 5. Read the Result

**Do NOT read the full session transcript.** It will be thousands of tokens and will bloat your context.

Instead:

```bash
# Quick outcome (always do this)
cat ~/.openclaw/workspace/skills/copilot-delegate/last-result.md

# If you need specific details, grep the transcript
grep -i "error\|failed\|bug\|created\|modified" skills/copilot-delegate/sessions/<timestamp>.md | head -20

# Check which files were changed
grep -E "^(Created|Modified|Deleted|Edited)" skills/copilot-delegate/sessions/<timestamp>.md
```

### 6. Handle Failures

**Exit code non-zero or `last-result.md` not updated:**

1. Check if the task partially completed:
   ```bash
   grep -i "error\|failed" skills/copilot-delegate/sessions/<latest>.md | tail -10
   ```

2. **Resume the session** if it was interrupted:
   ```bash
   copilot --continue --allow-all
   ```

3. If the task fully failed, **report to Jesten** with the error context. Don't retry blindly — coding failures often need human judgment.

## Important Rules

1. **One at a time.** Never run multiple `copilot` instances simultaneously. They may conflict on file writes.

2. **Always include the summary directive.** Without it, you have no cheap way to know what happened.

3. **Don't read transcripts into your context.** Use `grep` for specifics. The transcripts exist for Jesten's audit, not for you.

4. **Cost awareness.** `claude-opus-4.6` is the most expensive model. For simple tasks (typo fixes, small config changes), consider `claude-sonnet-4.5`. But remember — Copilot tokens are free for Jesten, so don't over-optimize. Use opus when in doubt.

5. **Verify the work.** After reading `last-result.md`, spot-check that the claimed changes actually exist:
   ```bash
   # Did the file actually change?
   head -5 <expected-modified-file>
   # Does the script still parse?
   bash -n <modified-script.sh>
   node --check <modified-script.js>
   ```

## Session Cleanup

Transcripts accumulate in `sessions/`. Prune old ones only when there are more than 5 session files:
```bash
SESSION_DIR="$HOME/.openclaw/workspace/skills/copilot-delegate/sessions"
SESSION_COUNT=$(find "$SESSION_DIR" -name "*.md" | wc -l)
if [ "$SESSION_COUNT" -gt 5 ]; then
  find "$SESSION_DIR" -name "*.md" -mtime +30 -delete
fi
```

This ensures you always keep at least the 5 most recent sessions, and only prune beyond that if they're older than 30 days.

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — your operating instructions |
| `last-result.md` | Overwritten each run with Copilot's summary of what it did |
| `sessions/` | Full session transcripts for human audit (don't read these) |
| `prd/initial-design.md` | Design document and status tracking |
