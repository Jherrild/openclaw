# PRD: copilot-delegate v3 — Simplified Coding Delegation

## 1. Problem

The current `copilot-delegate` skill has a 17k-char SKILL.md with a complex multi-step invocation pattern. Magnus must reconstruct a multi-paragraph boilerplate prompt (summary directive, auto-commit instructions, model selection, session sharing) every time he delegates. This complexity causes him to skip delegation and write code directly — defeating the entire purpose of the skill.

## 2. Goal

**One-line delegation.** Magnus provides only the task description. Everything else — model, session transcript, commit instructions, interrupt notification — is handled by the wrapper.

```bash
bash skills/copilot-delegate/copilot-lock.sh -p "Fix the pagination bug in get_remote_state.js"
```

## 3. Design

### 3.1 Key Design Decision: No Preamble Needed

The `copilot-instructions.md` file in `~/.openclaw/workspace` is **automatically injected** by the Copilot CLI when started in that directory. It already contains all behavioral guidelines:
- Read OPENCLAW_SKILL_DEV_GUIDE.md for conventions
- Review PRDs critically (or draft one if missing)
- Verify the delegating agent's intent
- Run existing tests before and after changes
- Delegate subtasks to sub-agents when reasonable
- Note follow-ups in a dedicated section
- Ensure YAML frontmatter on SKILL.md files

**Therefore, the wrapper injects NO preamble.** The prompt passes through verbatim. The only addition is a minimal suffix (see 3.3).

### 3.2 Wrapper Changes (`copilot-lock.sh`)

The wrapper becomes a thin, opinionated shell around the Copilot CLI.

**Hardcoded defaults (not overridable by Magnus):**
- **Model:** `claude-opus-4.6`
- **Working directory:** Always `~/.openclaw/workspace` (required for `copilot-instructions.md` auto-injection)
- **Flags:** `--allow-all` always set
- **Session transcript:** Auto-saved via `--share "sessions/<timestamp>.md"`
- **Interrupt notification:** Already implemented, keep as-is

**Model selection is removed from Magnus's responsibility.** Always `claude-opus-4.6`. Copilot may delegate subtasks to smaller models via sub-agents internally when it judges it reasonable.

### 3.3 Suffix (auto-appended to every prompt)

A minimal suffix is needed to activate delegation-specific behavior (writing `last-result.md` and auto-committing). These behaviors should NOT happen in interactive sessions — only when delegated by Magnus.

```
When finished, overwrite skills/copilot-delegate/last-result.md with a brief summary
(keep under 300 words — Magnus has limited context):
- What you understood the task to be
- What you did
- Status: Success/Partial/Failed
- Follow-up items

Auto-commit changed files with conventional commit messages.
```

### 3.4 Optional Flags (for edge cases only)

| Flag | Purpose |
|------|---------|
| `--add-dir <path>` | Grant access to a directory outside workspace |
| `--resume [id]` | Resume last session (or specific ID) |
| `--continue` | Resume most recent session |
| `--notify-session <id>` | Override interrupt notification target (existing) |

**Removed flags** (vs. current SKILL.md):
- `--cwd` — contradicts requirement to always start in workspace for `copilot-instructions.md` injection. Use `--add-dir` for external paths instead.
- `--context` — unnecessary; Magnus can say "Read X first" in the prompt.
- `--model` — hardcoded, not Magnus's decision.
- `--share` — hardcoded, auto-generated.

### 3.5 SKILL.md Rewrite (17k → ~1.5k chars)

The current SKILL.md is 17k chars — all of which Magnus loads into his context when using this skill. Most of it is redundant guidance that the wrapper or `copilot-instructions.md` now handles. The rewrite targets ~1.5k chars (~400 tokens), a **~90% reduction**.

**What stays:**
- YAML frontmatter (required for skill visibility)
- When to use vs. not (1-2 sentences)
- Invocation: `bash copilot-lock.sh -p "task"`
- Optional flags: `--add-dir`, `--resume`, `--continue`, `--notify-session`
- How to check results: `cat last-result.md`
- No polling needed (interrupt notification)

**What's removed (now handled elsewhere):**
- Model selection guidance (hardcoded in wrapper)
- Summary directive / auto-commit instructions (suffix in wrapper)
- Prompt crafting tips (Copilot handles via `copilot-instructions.md`)
- Session transcript management (auto-handled by wrapper)
- Step-by-step workflow (unnecessary with one-line invocation)
- Post-task verification steps (nice-to-have, not worth the tokens)
- Session cleanup scripts (operational, not skill instruction)
- Full model table (irrelevant — model is hardcoded)

**Token impact:** Magnus currently spends ~4k tokens just reading this SKILL.md. The rewrite saves ~3.6k tokens per delegation — paid on every single coding task.

## 4. Implementation Checklist

- [ ] Back up current SKILL.md and copilot-lock.sh to `backups/`
- [ ] Update `copilot-lock.sh`:
  - [ ] Add `SUFFIX` variable with last-result.md + auto-commit directive
  - [ ] Hardcode `--model claude-opus-4.6`
  - [ ] Hardcode `--allow-all`
  - [ ] Auto-generate `--share "sessions/<timestamp>.md"`
  - [ ] Construct final prompt as: `$USER_PROMPT\n\n$SUFFIX`
  - [ ] Ensure `cd ~/.openclaw/workspace` before invoking copilot
  - [ ] Keep existing: mutex lock, stale lock detection, interrupt notification, --resume/--continue
  - [ ] Remove: model passthrough, any preamble injection
- [ ] Replace `SKILL.md` with compact version (~2k chars)
- [ ] Test: simple delegation, --add-dir, --resume, interrupt fires
- [ ] Update `copilot-instructions.md` custom instruction: soften #7/#8 to "when delegated by Magnus" (since suffix now activates this explicitly)
- [ ] Review `MEMORY.md` and `AGENTS.md` for references to copilot-delegate and coding policy — update to be both token-efficient and accurate with the new simplified flow

## 5. Success Criteria

- Magnus can delegate with: `bash copilot-lock.sh -p "task description"`
- Magnus never specifies model, summary directive, commit instructions, or --share
- Copilot receives behavioral context via auto-injected `copilot-instructions.md` (no wrapper preamble)
- `last-result.md` is brief (<300 words) — doesn't bloat Magnus's context
- Interactive Copilot sessions (with Jesten) are unaffected — no unwanted last-result.md writes
- The "telephone problem" is mitigated by Copilot independently verifying intent via conventions in `copilot-instructions.md`
