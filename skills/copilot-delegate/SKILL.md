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
- **Lock Wrapper:** `~/.openclaw/workspace/skills/copilot-delegate/copilot-lock.sh`
- **Working Directory:** `cd` to the project you're working on. For workspace/skill tasks, that's `~/.openclaw/workspace`. For external repos, `cd` to that repo.
- **Default Model:** `claude-opus-4.6`
- **Session Transcripts:** `~/.openclaw/workspace/skills/copilot-delegate/sessions/`
- **Result Summary:** `~/.openclaw/workspace/skills/copilot-delegate/last-result.md`
- **Lock File:** `~/.openclaw/workspace/skills/copilot-delegate/.copilot.lock` (auto-managed by wrapper)

### Concurrency Safety

**Always use `copilot-lock.sh` instead of calling `copilot` directly.** The wrapper:
- Acquires a mutex lock before running the CLI (atomic via `mkdir`)
- Waits with exponential backoff if another instance is running (up to 10 min)
- Detects and clears stale locks (dead PID or older than 5 min)
- Guarantees lock release on exit, error, or signal via `trap`

Environment variables for tuning (optional):
- `COPILOT_LOCK_TIMEOUT` — max seconds to wait for lock (default: 600)
- `COPILOT_LOCK_STALE` — seconds before a lock is considered stale (default: 300)
- `COPILOT_SESSION_ID` — session identifier written into the lock file

## Tools

### copilot_delegate

Run a coding task in non-interactive mode. Copilot reads files, makes changes, and writes a summary when done. Can also resume a previous session. **Always use `copilot-lock.sh` wrapper** — never call `copilot` directly.

**Parameters:**
- `-p <prompt>`: (Required for new tasks) Detailed task description. Must end with the summary directive.
- `--model`: (Required) **You must always specify this flag.** The CLI does not default to a good model. Use `claude-opus-4.6` unless you have a specific reason to choose another (see model table below, or use the `copilot_models` tool to check available models).
- `--resume <sessionId>`: (Optional) Resume a previous session instead of starting a new one. Omit `-p` when resuming.
- `--continue`: (Optional) Resume the most recent session. Omit `-p` when using this.
- `--add-dir`: (Optional) Additional directory access beyond workspace. Repeatable.

**New task:**
```bash
cd ~/.openclaw/workspace
LOCK_WRAPPER="skills/copilot-delegate/copilot-lock.sh"
bash "$LOCK_WRAPPER" -p "<your detailed prompt here>

When finished, overwrite skills/copilot-delegate/last-result.md with a 2-3 sentence summary of what you did, what succeeded, and any issues. Replace the entire file contents.

If the task succeeded and you created or modified any files, auto-commit your changes:
1. Run git status --porcelain to see all changed/new files.
2. From those, git add ONLY the files you created or modified during this task — do NOT stage unrelated changes.
3. Run git commit -m '<type>(<scope>): <description>' with a concise, descriptive message summarizing the work (e.g., 'feat(supernote-sync): add pagination to Drive API calls').
4. Skip the commit if the task failed or no files were changed." \
  --model claude-opus-4.6 \
  --allow-all \
  --share "skills/copilot-delegate/sessions/$(date +%s).md"

# Save session ID for this skill so it can be resumed later
ls -t ~/.copilot/session-state/ | head -1 > skills/<SKILL_NAME>/.copilot-session
```

**Resume a skill's session:**
```bash
cd ~/.openclaw/workspace
LOCK_WRAPPER="skills/copilot-delegate/copilot-lock.sh"
SESSION_ID=$(cat skills/<SKILL_NAME>/.copilot-session)
bash "$LOCK_WRAPPER" --resume "$SESSION_ID" --model claude-opus-4.6 --allow-all
```

Replace `<SKILL_NAME>` with the skill you're working on (e.g., `supernote-sync`).

Then check the result:
```bash
echo "Exit code: $?"
cat ~/.openclaw/workspace/skills/copilot-delegate/last-result.md
# Verify the auto-commit happened
git --no-pager log --oneline -1
```

### copilot_session_lookup

Find the saved Copilot session for a specific skill.

**Usage:**
```bash
# Check if a skill has a saved session
cat skills/<SKILL_NAME>/.copilot-session 2>/dev/null
# If empty or missing, no saved session exists
```

### copilot_models

Check which models are currently available.

**Usage:**
```bash
copilot --help 2>&1 | grep -A10 '\-\-model'
```
```

## Step-by-Step Workflow

### 1. Set the Working Directory

`cd` to the root of whatever project Copilot will be working on:

```bash
# For workspace/skill tasks:
cd ~/.openclaw/workspace

# For external repos:
cd ~/repos/my-project
```

Copilot uses the working directory to discover project files, `copilot-instructions.md`, and `.git` context. Start in the right place.

**If the task relates to OpenClaw** (integrates with OpenClaw, uses its tools, or should follow its conventions), add the workspace as an extra directory and tell Copilot to read the instructions:

```bash
LOCK_WRAPPER="$HOME/.openclaw/workspace/skills/copilot-delegate/copilot-lock.sh"
bash "$LOCK_WRAPPER" -p "... and ~/.openclaw/workspace/OPENCLAW_SKILL_DEV_GUIDE.md for OpenClaw project conventions before starting.

When finished, overwrite skills/copilot-delegate/last-result.md with a 2-3 sentence summary of what you did, what succeeded, and any issues. Replace the entire file contents.

If the task succeeded and you created or modified any files, auto-commit your changes:
1. Run git status --porcelain to see all changed/new files.
2. From those, git add ONLY the files you created or modified during this task — do NOT stage unrelated changes.
3. Run git commit -m '<type>(<scope>): <description>' with a concise, descriptive message.
4. Skip the commit if the task failed or no files were changed." \
  --model claude-opus-4.6 \
  --allow-all \
  --add-dir ~/.openclaw/workspace \
  --share "$HOME/.openclaw/workspace/skills/copilot-delegate/sessions/$(date +%s).md"
```

Use your judgment: if the task has nothing to do with OpenClaw, skip the extra directory and prompt lines.

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

When finished, overwrite skills/copilot-delegate/last-result.md with a 2-3 sentence summary of what you did, what succeeded, and any issues. Replace the entire file contents.

If the task succeeded and you created or modified any files, auto-commit your changes:
1. Run git status --porcelain to see all changed/new files.
2. From those, git add ONLY the files you created or modified during this task — do NOT stage unrelated changes.
3. Run git commit -m 'fix(supernote-sync): add pagination to Drive API files.list' with a concise, descriptive message.
4. Skip the commit if the task failed or no files were changed.
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
bash "$LOCK_WRAPPER" -p "..." --model claude-sonnet-4.5 --allow-all --share "..."
```

### 4. Handle Additional Paths

If the task involves files outside the working directory, add explicit directory access:

```bash
bash "$LOCK_WRAPPER" -p "..." \
  --model claude-opus-4.6 \
  --allow-all \
  --add-dir /path/to/other/directory \
  --share "$HOME/.openclaw/workspace/skills/copilot-delegate/sessions/$(date +%s).md"
```

Common extra paths:
- **OpenClaw workspace** (when working in external repos on OpenClaw-related tasks): `--add-dir ~/.openclaw/workspace`
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
   bash "$LOCK_WRAPPER" --continue --allow-all
   ```

3. If the task fully failed, **report to Jesten** with the error context. Don't retry blindly — coding failures often need human judgment.

## Post-Task Auto-Commit

Copilot automatically commits its changes after a successful task. This is built into the **summary directive** — every prompt template includes auto-commit instructions that Copilot follows at the end of its session.

### How It Works

1. **Copilot finishes the task** and writes `last-result.md`.
2. **Copilot checks `git status --porcelain`** to identify all changed/new files.
3. **Copilot stages only the files it touched** — it does NOT blindly `git add .` or stage unrelated changes.
4. **Copilot commits** with a conventional-commit-style message: `<type>(<scope>): <description>`.
5. **If the task failed or no files changed**, Copilot skips the commit entirely.

### Commit Message Convention

Messages follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat(<skill>): add new capability`
- `fix(<skill>): resolve bug in X`
- `refactor(<skill>): restructure Y`
- `docs(<skill>): update SKILL.md`
- `chore(<skill>): cleanup or maintenance`

### What Magnus Should Verify

After the delegation completes, confirm the commit happened:
```bash
# Check last commit
git --no-pager log --oneline -1

# If no commit was made but changes exist, something went wrong
git status --porcelain
```

If Copilot failed to commit (e.g., merge conflict, git lock), Magnus can manually commit:
```bash
git add <files-copilot-changed>
git commit -m "<type>(<scope>): <description>"
```

## Important Rules

1. **One at a time — enforced by `copilot-lock.sh`.** Never call `copilot` directly. Always use the lock wrapper:
   ```bash
   LOCK_WRAPPER="$HOME/.openclaw/workspace/skills/copilot-delegate/copilot-lock.sh"
   bash "$LOCK_WRAPPER" -p "..." --model claude-opus-4.6 --allow-all
   ```
   The wrapper automatically acquires a mutex lock, waits with exponential backoff if another instance is running, detects stale locks, and guarantees cleanup on exit/error/signal. No manual `pgrep` checks needed.

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

6. **Verify the auto-commit.** Check that Copilot committed its changes:
   ```bash
   git --no-pager log --oneline -1
   # If expected commit is missing, check for unstaged changes
   git status --porcelain
   ```

## Session Cleanup

Transcripts accumulate in `sessions/`. Prune old ones, keeping at least the 5 most recent:
```bash
SESSION_DIR="$HOME/.openclaw/workspace/skills/copilot-delegate/sessions"
# Keep the 5 newest, delete the rest if older than 30 days
ls -t "$SESSION_DIR"/*.md 2>/dev/null | tail -n +6 | while read -r f; do
  find "$f" -mtime +30 -delete 2>/dev/null
done
```

This ensures the 5 most recent sessions are always preserved regardless of age, and older excess sessions are pruned after 30 days.

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — your operating instructions |
| `copilot-lock.sh` | Mutex wrapper — always use this instead of calling `copilot` directly |
| `.copilot.lock` | Lock file (auto-managed by `copilot-lock.sh` — do not edit manually) |
| `last-result.md` | Overwritten each run with Copilot's summary of what it did |
| `sessions/` | Full session transcripts for human audit (don't read these) |
| `prd/initial-design.md` | Design document and status tracking |
