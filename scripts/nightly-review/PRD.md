# PRD: Nightly Review — System-Level Automated Improvement Finder

## 1. Problem

OpenClaw accumulates daily logs, skill changes, and operational patterns that reveal inefficiencies, bugs, and improvement opportunities. Currently, only ad-hoc human-initiated audits discover these issues. There's no systematic review process.

## 2. Goal

A nightly systemd task that spawns a Copilot instance (claude-opus-4.6) to:
1. Review the day's session logs for patterns, errors, and repetitive operations
2. Audit skills, MEMORY.md, AGENTS.md, and other bootstrap files for staleness
3. Propose new skills for repetitive operations found in logs
4. Generate a dated `improvements.md` report saved to the Obsidian vault
5. Notify Magnus with a short summary and vault path via interrupt

## 3. Design

### 3.1 Architecture

```
systemd timer (2:00 AM daily via task-orchestrator)
  → nightly-review.sh (collector script)
    → Spawns copilot -p "review prompt" --model claude-opus-4.6 --allow-all
    → Copilot analyzes logs + files, writes improvements.md
    → Copilot writes report to Obsidian vault via obsidian-scribe
    → Script echoes summary to stdout
  → interrupt-wrapper.sh captures stdout
  → Interrupt fires → Magnus gets notified
```

### 3.2 Review Scope

The Copilot instance reviews:
- **Session logs:** `~/.openclaw/agents/main/sessions/` (today's JSONL files)
- **Bootstrap files:** AGENTS.md, MEMORY.md, USER.md, TOOLS.md, HEARTBEAT.md
- **All SKILL.md files:** Check for staleness, missing frontmatter, redundancy
- **Recent git log:** Last 24h of commits for context
- **task-orchestrator status:** Currently registered tasks and their health

### 3.3 Report Format

Saved to Obsidian vault at: `1-Projects/OpenClaw/Nightly Reviews/YYYY-MM-DD.md`

```markdown
# OpenClaw Nightly Review — YYYY-MM-DD

## Issues Found
- [severity] Description of issue

## Efficiency Wins
- Description of proposed optimization with estimated token/time savings

## Proposed Skills
- Skill name: what it would do, why (based on log patterns)

## Stale Content
- File: what's stale and suggested update

## Action Items
- [ ] Prioritized list of recommended changes
```

### 3.4 Interrupt Notification

On completion, the script outputs a brief summary (2-3 sentences) to stdout. The interrupt-wrapper captures this and notifies Magnus with:
- Summary of findings count (e.g., "Found 3 issues, 2 efficiency wins, 1 skill proposal")
- Vault path to the full report

### 3.5 Resource Constraints

- Runs at 2:00 AM to avoid competing with interactive sessions
- Copilot tokens are free (Jesten's GitHub benefit) — no cost concern
- Session log parsing should use grep/head to avoid loading full logs into context

## 4. Implementation

- `scripts/nightly-review/nightly-review.sh` — main script
- `scripts/nightly-review/review-prompt.txt` — the Copilot prompt (editable without re-registering)
- Registered with task-orchestrator: daily interval, interrupt-file for notification config
- Interrupt rule registered for `task.nightly-review` source

## 5. Success Criteria

- Runs nightly without intervention
- Report is saved to Obsidian vault with correct PARA path
- Magnus receives interrupt notification with summary + vault path
- Finds at least one actionable item per week on average
- Does not interfere with daytime interactive sessions (mutex via copilot-lock.sh)
