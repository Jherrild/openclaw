# PRD: Copilot Daemon — Automated GitHub Issue → Copilot Pipeline

> **Status:** Draft — 2026-02-14
> **Location:** `copilot-daemon/`
> **Related:** `skills/copilot-delegate/` (execution layer)

---

## 1. Problem Statement

Today, delegating work to Copilot is a manual process: a human (or Magnus) writes a prompt, runs `copilot-lock.sh -p "..."`, waits for the interrupt, reviews the result. This works for ad-hoc tasks but doesn't scale to a backlog of planned work.

**Goal:** A background daemon that watches a GitHub issues list for labeled work items and automatically progresses them through a structured pipeline: draft PRD → self-review → human approval → implementation. The human only needs to create an issue and approve the PRD — everything else is automated.

**Portability:** This must work on any machine with `gh` CLI and `copilot` CLI authenticated. It should default to the current repo but accept `--repo owner/repo` for cross-repo use. No OpenClaw dependency required — it uses `copilot-lock.sh` for execution but runs independently.

---

## 2. Pipeline Architecture

### 2.1 Stages

| Label | Stage | Who Acts | Action |
|-------|-------|----------|--------|
| `copilot:draft-prd` | 1. Draft | Daemon → Copilot | Read issue, find/create skill dir, draft PRD |
| `copilot:review-prd` | 2. Self-review | Daemon → Copilot (fresh session) | Fresh-eyes review of PRD. Major issues → back to draft. Approved → ready |
| `copilot:ready` | 3. Awaiting human | Human | PRD posted to issue. Human reviews, comments revisions or approves |
| `copilot:approved` | 4. Implement | Daemon → Copilot | Implement per PRD stages + test plan |
| `copilot:in-progress` | (active) | Daemon | Currently being worked on. Daemon skips. |
| `copilot:blocked` | (stalled) | Human | Copilot hit a blocker. Needs human input. |
| `copilot:done` | (complete) | Daemon | Work complete. Issue may be closed. |

### 2.2 Transitions

```
Issue created with copilot:draft-prd
  → Daemon picks up, sets copilot:in-progress
  → Copilot session: drafts PRD, comments on issue
  → Daemon sets copilot:review-prd

Review session (fresh context):
  → Daemon picks up, sets copilot:in-progress
  → Copilot reads issue + PRD, critically reviews
  → Major issues? → sets copilot:draft-prd (with review comments on issue)
  → Looks good?  → sets copilot:ready, posts PRD summary + plan to issue

Human review:
  → Human reads PRD summary on the issue
  → Comment "change X, Y" → Daemon detects new comment, sets copilot:review-prd
  → Add label copilot:approved (or comment "approved"/"lgtm") → proceed

Implementation:
  → Daemon picks up copilot:approved, sets copilot:in-progress
  → Copilot implements per PRD stages, runs tests
  → Success → sets copilot:done, comments summary
  → Blocked → sets copilot:blocked, comments what's needed
```

### 2.3 Issue Selection

```bash
# Daemon query (pick oldest actionable issue assigned to current user)
gh issue list \
  --assignee @me \
  --label "copilot:draft-prd,copilot:review-prd,copilot:approved" \
  --state open \
  --json number,title,labels,body,comments \
  --jq 'sort_by(.number) | .[0]'
```

- Only picks issues assigned to the authenticated user (portable across orgs)
- Picks the oldest actionable issue (FIFO)
- Skips `copilot:in-progress` and `copilot:blocked`
- One issue at a time (copilot-lock.sh enforces this via mutex)

---

## 3. Tier-Specific Prompts

Each stage bootstraps Copilot with a tailored prompt. The prompt includes the issue body, any comments, and stage-specific instructions.

### 3.1 Draft PRD Prompt

```
You are picking up GitHub issue #{{number}}: "{{title}}"

Issue description:
{{body}}

Your task:
1. Read the issue description carefully
2. Find or create the relevant skill directory in the workspace
3. Draft a PRD in the skill's prd/ subdirectory
4. The PRD must include:
   - Problem statement and proposed approach
   - Implementation stages (phased, each independently testable)
   - Test plan for each stage
   - Alternatives considered (existing MCPs, simpler approaches, system daemons)
   - Dependencies and risks
5. Comment on the issue with a brief summary of the PRD you created
6. Do NOT implement anything — only draft the PRD

When finished, update the issue labels: remove copilot:draft-prd, add copilot:review-prd.
```

### 3.2 Review PRD Prompt

```
You are reviewing a PRD for GitHub issue #{{number}}: "{{title}}"

Issue description:
{{body}}

Previous comments:
{{comments}}

Your task (FRESH EYES — you did NOT write this PRD):
1. Read the issue and all comments
2. Find and read the PRD referenced in the comments
3. Critically evaluate:
   - Is the approach the simplest that solves the problem?
   - Are there existing MCPs, tools, or patterns that would be simpler?
   - Is each stage independently testable?
   - Are there missing edge cases or risks?
   - Is the scope appropriate (not overengineered)?
4. If major issues found:
   - Comment your findings on the issue
   - Remove copilot:review-prd, add copilot:draft-prd
5. If the PRD is solid:
   - Comment a structured summary on the issue:
     ## PRD Summary
     [1-paragraph overview]
     ## Stages
     [numbered list with test criteria per stage]
     ## Test Plan
     [key test cases]
     ## Request
     Please review and approve by adding the `copilot:approved` label, or comment revision requests.
   - Remove copilot:review-prd, add copilot:ready
```

### 3.3 Revision Prompt (human feedback detected)

```
You are revising a PRD for GitHub issue #{{number}}: "{{title}}"

The human reviewed your PRD and requested changes:
{{latest_human_comment}}

Previous context:
{{comments}}

Your task:
1. Read the revision request carefully
2. Find and update the PRD
3. Address each point in the feedback
4. Comment on the issue confirming what you changed
5. Remove copilot:review-prd, add copilot:ready
```

### 3.4 Implementation Prompt

```
You are implementing GitHub issue #{{number}}: "{{title}}"

Issue description:
{{body}}

PRD and approval context:
{{comments}}

Your task:
1. Find and read the approved PRD
2. Implement each stage in order
3. Write tests as specified in the test plan
4. Run tests after each stage to validate
5. Commit with conventional commit messages referencing the issue: fix(scope): description (#{{number}})
6. If blocked on something:
   - Comment what you're blocked on
   - Remove copilot:approved, add copilot:blocked
7. If all stages complete:
   - Comment a completion summary
   - Remove copilot:approved, add copilot:done
8. Notify Magnus: openclaw agent -m "Copilot completed issue #{{number}}: {{title}}" --agent main --deliver
```

---

## 4. Daemon Implementation

### 4.1 Components

```
copilot-daemon/
  SKILL.md              # Skill metadata (for discoverability)
  daemon.sh             # Main daemon loop (systemd target)
  run-once.sh           # Process single issue and exit
  init.sh               # Create labels, validate auth
  lib/
    issue-picker.sh     # Query GitHub for next actionable issue
    prompt-builder.sh   # Build tier-specific prompt from issue + stage
    label-manager.sh    # Add/remove labels, detect human comments
    notifier.sh         # Magnus notification (if available)
  prompts/
    draft-prd.md        # Template for stage 1
    review-prd.md       # Template for stage 2
    revision.md         # Template for human feedback loop
    implement.md        # Template for stage 4
  prd/
    copilot-daemon.md   # This file
```

### 4.2 Daemon Loop

```bash
#!/usr/bin/env bash
# daemon.sh — Main polling loop
INTERVAL="${1:-900}"  # Default: 15 minutes

while true; do
  # 1. Find next actionable issue
  ISSUE=$(bash lib/issue-picker.sh)
  if [[ -z "$ISSUE" ]]; then
    sleep "$INTERVAL"
    continue
  fi

  ISSUE_NUM=$(echo "$ISSUE" | jq -r '.number')
  STAGE=$(echo "$ISSUE" | jq -r '.stage')

  # 2. Build prompt for this stage
  PROMPT=$(bash lib/prompt-builder.sh "$ISSUE_NUM" "$STAGE")

  # 3. Delegate to Copilot via copilot-lock.sh
  bash ../copilot-delegate/copilot-lock.sh -p "$PROMPT"

  # 4. Post-execution: update labels based on result
  bash lib/label-manager.sh post-run "$ISSUE_NUM" "$STAGE"

  sleep "$INTERVAL"
done
```

### 4.3 systemd Integration

```ini
# copilot-daemon.service
[Unit]
Description=Copilot Daemon — Automated GitHub Issue Pipeline
After=network.target

[Service]
Type=simple
ExecStart=/path/to/copilot-daemon/daemon.sh 900
WorkingDirectory=/path/to/workspace
Restart=on-failure
RestartSec=60

[Install]
WantedBy=default.target
```

Or via `task-orchestrator` if preferred.

### 4.4 Portability Requirements

- **No OpenClaw dependency** — uses `gh` CLI and `copilot` CLI only
- **Repo-agnostic** — defaults to current git repo, accepts `--repo owner/repo`
- **Auth-agnostic** — uses whatever `gh auth` is configured (personal, work org, etc.)
- **Assignee-scoped** — only picks up issues assigned to `@me`
- **Works on macOS and Linux** — bash + gh + copilot, no platform-specific deps

---

## 5. Issue Format Convention

Issues should include enough context for Copilot to work independently:

```markdown
## Description
[What needs to be done and why]

## Context
[Relevant files, existing skills, related PRDs]

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Notes
[Any constraints, preferences, or non-obvious requirements]
```

The daemon reads the full issue body and all comments. Richer context = better PRD.

---

## 6. Notification Protocol

When the daemon picks up work, it notifies via two channels:

1. **GitHub Issue comment** — always (portable)
   ```
   🤖 Copilot picking up this issue (stage: draft-prd). Started at 2026-02-14T23:30:00Z
   ```

2. **Magnus relay** — if available (OpenClaw-specific)
   ```bash
   openclaw agent -m "Copilot picked up issue #42: Fix pagination bug (stage: draft-prd)" --agent main --deliver 2>/dev/null || true
   ```

The `|| true` ensures the daemon doesn't fail if OpenClaw isn't available (portability).

---

## 7. Human Feedback Detection

When label is `copilot:ready`, the daemon monitors for:

1. **Label change to `copilot:approved`** → proceed to implementation
2. **New comment from a human (not the bot)** → treat as revision request:
   - Move label to `copilot:review-prd`
   - Next cycle builds a revision prompt with the human's comment

Detection: compare comment author against the authenticated `gh` user. If different author, it's human feedback.

---

## 8. Work Modes

The daemon supports two execution modes, selected at start:

```bash
copilot-daemon start --workmode worktree    # Isolated branch per issue (work/clean repos)
copilot-daemon start --workmode in-place    # Atomic writes in shared tree (OpenClaw/Magnus)
```

### 8.1 Worktree Mode (`--workmode worktree`)

**Best for:** Work repos, clean repos, any environment without untracked runtime state.

Each issue gets an isolated git worktree:

```
issue #42 picked up
  → git worktree add .worktrees/issue-42 -b copilot/issue-42
  → Copilot runs in .worktrees/issue-42/ (clean checkout, own branch)
  → On completion: PR created from copilot/issue-42 → main
  → Worktree cleaned up after merge
```

**Advantages:**
- Zero risk of mid-edit collisions — completely isolated working directory
- Each issue gets its own branch + PR (clean git history)
- Multiple issues can be *prepared* in parallel (only execution is serialized by the lock)

**Requirements:**
- No untracked runtime state (tokens, credentials, node_modules) needed by the code under modification
- `npm install` or equivalent must work in the worktree (dependencies are committed or installable)

### 8.2 In-Place Mode (`--workmode in-place`)

**Best for:** OpenClaw workspace where Magnus shares the tree and skills depend on untracked state files (OAuth tokens, sync mappings, node_modules, logs).

All work happens in the existing working directory:

```
issue #42 picked up
  → Work on current branch (or create feature branch + merge back)
  → New-file-first pattern: write new modules, swap entry points atomically
  → Commits directly to the working branch
```

**Advantages:**
- All runtime state available (tokens, node_modules, config files)
- No worktree setup/teardown overhead
- Works even when skills have complex untracked dependency chains

**Safety:** See §8.3 below.

### 8.3 In-Place Safety (Shared Worktree)

Magnus and Copilot share the same working tree. The mutex lock prevents concurrent Copilot sessions but does NOT prevent Magnus from using skills that Copilot is modifying. This is manageable because:

**Stages 1-3 are safe by design** — drafting, reviewing, and awaiting approval only create/modify PRD files and issue comments. No skill code changes.

**Stage 4 (implementation) requires care:**

1. **New-file-first pattern** — write new modules alongside existing ones (e.g., `lib/api.js` next to `write.js`), then update the entry point last. Magnus continues using the old path until the shim is atomically swapped.

2. **Atomic file swaps** — when updating an existing file, write to `file.tmp`, then `fs.renameSync('file.tmp', 'file')`. POSIX `rename()` is atomic — Magnus never sees a half-written file.

3. **Human knows it's coming** — implementation only runs after explicit `copilot:approved` label. The user can time approvals to low-activity periods if needed.

**Remaining risk:** Memory-related skills (`local-rag`, `obsidian-scribe`) that Magnus may invoke autonomously in the background (e.g., during memory search on a user question). These can't be easily timed around. Mitigations:
- Prefer additive changes (new files) over in-place rewrites
- If a rewrite is necessary, do it in a single atomic commit — minimize the window
- The daemon could post a "⚠️ Modifying active skill: local-rag" warning to Magnus before starting, giving him a chance to complete any in-flight operations

This doesn't eliminate all risk, but reduces the window to seconds (atomic rename) for a collision that requires Magnus to invoke the exact skill being modified at the exact moment of the swap.

---

## 9. Future Improvements

### 8.1 Incognito Mode (No GitHub Writes)

For environments where writing to issues is undesirable (read-only repos, auditing requirements, or just preference):

```bash
copilot-daemon start --incognito
```

In incognito mode:
- **Reads** issues normally via `gh` CLI
- **Does NOT** comment on issues or change labels
- **Maintains state locally** in a `.copilot-daemon/state.json` file:
  ```json
  {
    "issues": {
      "42": { "stage": "review-prd", "lastComment": "abc123", "prdPath": "skills/foo/prd/bar.md" }
    }
  }
  ```
- **Prompts the user** via terminal or Magnus relay instead of issue comments
- Labels would need to be applied manually (or the daemon suggests them)

This is useful for:
- Work repos where bot comments aren't welcome
- Testing the daemon without polluting issue threads
- Environments without issue write permissions

### 8.2 Priority Support

Issues with a `priority:high` label get picked up before lower priority. Default FIFO within same priority.

### 8.3 Multi-Repo Watching

```bash
copilot-daemon start --repo owner/repo1 --repo owner/repo2
```

Round-robin across repos, respecting the lock (one Copilot session at a time).

### 8.4 Webhook Mode (Replace Polling)

Instead of polling every 15 min, listen for GitHub webhook events (issue labeled, comment created). Requires a webhook endpoint — could use interrupt-service on port 7600.

### 8.5 Copilot Session Resume

If a Copilot session was interrupted (crash, timeout), the daemon could `--resume` the session instead of starting fresh. Requires tracking session IDs in state.

---

## 10. Implementation Stages

### Stage 1: Core Pipeline (MVP)
- [ ] `init.sh` — create labels, validate `gh` and `copilot` auth
- [ ] `lib/issue-picker.sh` — query issues, select next actionable
- [ ] `lib/prompt-builder.sh` — build prompts from templates + issue data
- [ ] `lib/label-manager.sh` — add/remove labels, detect human comments
- [ ] `run-once.sh` — process one issue and exit
- [ ] Prompt templates for all 4 tiers
- [ ] Test: create a test issue, run through full pipeline manually

### Stage 2: Daemon + Notifications
- [ ] `daemon.sh` — polling loop with configurable interval
- [ ] systemd unit file (or task-orchestrator integration)
- [ ] Magnus notification on pickup and completion
- [ ] GitHub issue comment on pickup
- [ ] Test: daemon picks up and processes an issue automatically

### Stage 3: Feedback Loop
- [ ] Human comment detection (distinguish bot vs human author)
- [ ] Revision prompt builder
- [ ] Label cycling (ready → review-prd on human comment)
- [ ] Test: comment on a `copilot:ready` issue, verify revision cycle

### Stage 4: Polish
- [ ] `--repo owner/repo` flag for cross-repo use
- [ ] Error handling (gh auth failures, copilot crashes, network issues)
- [ ] Status command (show current state, pending issues, last run)
- [ ] Update copilot-instructions.md with daemon protocol

---

## 11. Test Plan

| Test | Input | Expected |
|------|-------|----------|
| Init creates labels | `copilot-daemon init` | 7 labels created on repo |
| Picks correct issue | 3 issues with different labels | Picks oldest with actionable label |
| Skips in-progress | Issue with `copilot:in-progress` | Not picked up |
| Draft tier prompt | Issue with `copilot:draft-prd` | Prompt includes issue body + draft instructions |
| Review tier prompt | Issue with `copilot:review-prd` | Prompt includes PRD reference + review instructions |
| Label transition | After draft completes | Label changes to `copilot:review-prd` |
| Human comment detected | New comment on `copilot:ready` issue | Label moves to `copilot:review-prd` |
| Approved detection | `copilot:approved` label added | Implementation prompt fired |
| Blocked handling | Copilot exits with blocker | Label set to `copilot:blocked`, comment posted |
| Cross-repo | `--repo other/repo` | Issues fetched from specified repo |

---

## 12. Dependencies

- `gh` CLI (authenticated)
- `copilot` CLI (authenticated)
- `copilot-lock.sh` (from copilot-delegate skill)
- `jq` (for JSON parsing)
- Optional: `openclaw` CLI (for Magnus notifications)
- Optional: `systemd` (for daemon mode) or `task-orchestrator`

---

## 13. References

| Resource | Location |
|----------|----------|
| copilot-delegate skill | `skills/copilot-delegate/` |
| copilot-lock.sh | `skills/copilot-delegate/copilot-lock.sh` |
| interrupt-service | `skills/interrupt-service/` |
| task-orchestrator | `skills/task-orchestrator/` |
