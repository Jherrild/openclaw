# OpenClaw Skill Development Guide

> **For: GitHub Copilot / Claude instances working on OpenClaw skills**
> **Last updated:** 2026-02-07
> **Context:** This doc captures hard-won lessons from building the `supernote-sync` skill. Read this before writing or modifying any OpenClaw skill.

---

## What is OpenClaw?

OpenClaw is a local AI agent framework. It runs persistent agents (like "Magnus") that communicate via Telegram/WhatsApp, execute cron jobs, respond to system events, and maintain memory across sessions. Each agent has a workspace with skill directories.

## Architecture at a Glance

```
~/.openclaw/
├── agents/
│   ├── main/           # Magnus's agent config + session history
│   │   ├── agent/      # auth-profiles.json, models.json
│   │   └── sessions/   # .jsonl files (one per session)
│   └── mailman/        # Separate agent with its own sessions
├── workspace/          # Magnus's shared workspace (he starts here)
│   ├── AGENTS.md       # Agent behavior rules
│   ├── SOUL.md         # Agent personality
│   ├── USER.md         # Info about the human
│   ├── MEMORY.md       # Long-term curated memory
│   ├── TOOLS.md        # Environment-specific notes
│   ├── HEARTBEAT.md    # Periodic task checklist
│   ├── memory/         # Daily logs (YYYY-MM-DD.md)
│   └── skills/         # Skill directories (each with SKILL.md)
│       ├── supernote-sync/
│       ├── obsidian-scribe/
│       ├── local-rag/
│       ├── google-tasks/
│       └── google-docs/
├── workspace-main/     # Magnus-specific workspace overlay
├── cron/jobs.json      # All cron job definitions
├── logs/               # OpenClaw gateway logs
└── openclaw.json       # Main config
```

## Critical Concepts

### 1. Agents Read SKILL.md — That's Their API Contract

When an agent is woken (by system event, cron, or user message), it reads its workspace files including `skills/*/SKILL.md`. **SKILL.md is the single source of truth** for how the agent should use a skill. If SKILL.md says to use `gog`, the agent will use `gog` — even if the actual scripts use Node.js.

**Lesson:** Always keep SKILL.md in sync with the actual implementation. If you change how something works in a script, update SKILL.md immediately.

### 2. Session Context is Sticky

Agents accumulate context within a session. If an agent read an old version of SKILL.md at session start, **it will continue using that version for the entire session**, even if you update the file mid-session. A gateway restart doesn't necessarily create a new session.

**Lesson:** After updating SKILL.md, the agent needs a **new session** to pick up changes. Tell the user to start a new session for the agent, or message the agent directly telling it to re-read the SKILL.md.

### 3. Agents Cannot Do Everything — Decouple IO from Intelligence

Agents are good at: categorization, decision-making, user interaction, file organization.
Agents are bad at: managing OAuth tokens, hitting external APIs, long-running downloads.

**Lesson:** Handle all external IO (API calls, downloads, auth) in bash/Node.js scripts that run via cron. Let the agent work with **local files only**. The `supernote-sync` skill learned this the hard way — Magnus couldn't authenticate to Google Drive, so we moved all downloads into the cron script and gave Magnus pre-downloaded files in a `buffer/` directory.

### 4. System Events Are the Wake Mechanism

```bash
openclaw system event --text "your-skill: description of what happened" --mode now
```

This injects a system message into the agent's session, triggering a turn. The agent sees the text as a `System:` prefixed user message. Use a consistent prefix (e.g., `supernote-sync:`) so the agent can pattern-match which skill to invoke.

**Lesson:** Keep event text concise but actionable. Include a pointer to where the agent should look (e.g., "read .agent-pending for manifest") rather than embedding large payloads in the event text itself.

### 5. Cron Jobs Have Specific Config

Cron jobs are defined in `~/.openclaw/cron/jobs.json`. Key fields:
- `schedule.kind`: `"every"` (interval) or `"cron"` (cron expression)
- `schedule.everyMs`: interval in milliseconds (600000 = 10 min)
- `sessionTarget`: `"isolated"` (own session) or `"main"` (shared)
- `wakeMode`: `"next-heartbeat"` or `"immediate"`
- `delivery.mode`: `"none"` (silent), `"announce"` (message user)
- `payload.message`: the instruction text or command

**Lesson:** Use `isolated` sessions for cron jobs so they don't pollute the agent's main conversation history. Use `delivery.mode: "none"` for background tasks that only alert on events.

### 6. Coordination via Lockfiles

When a script needs to hand off to an agent and prevent duplicate wakes:
1. Script creates a lockfile (e.g., `.agent-pending`) with relevant data
2. Script fires a system event to wake the agent
3. Agent processes the work
4. Agent **must** delete the lockfile when done

**Always add a staleness guard.** If the agent fails, the lockfile stays forever and creates a deadlock. Check file age with `stat -c %Y` and auto-clear after a timeout (e.g., 30 minutes).

```bash
LOCK_AGE=$(( $(date +%s) - $(stat -c %Y "$LOCKFILE") ))
if [ "$LOCK_AGE" -gt 1800 ]; then
  rm -f "$LOCKFILE"  # Stale, re-wake
fi
```

### 7. Shared Auth Tokens

Google API auth is shared across skills via token files:
- **Token:** `skills/google-docs/scripts/token.json`
- **Credentials:** `skills/google-tasks/credentials.json`
- **Node modules:** `skills/google-tasks/node_modules/` (googleapis)

When writing a new skill that uses Google APIs, reuse these paths via `NODE_PATH` and relative `path.join()`.

**Lesson:** Never use absolute paths inside `path.join()` — `path.join(__dirname, '/absolute/path')` produces garbage. Always use relative paths: `path.join(__dirname, '../google-docs/scripts/token.json')`.

### 8. The Agent's Existing Tool Ecosystem

Before writing raw bash commands for the agent, check what tools already exist:

| Skill | Purpose | Key Commands |
|-------|---------|-------------|
| `obsidian-scribe` | Create, move, append, archive vault notes | `scribe_save`, `scribe_move`, `scribe_append`, `scribe_archive` |
| `local-rag` | Semantic + keyword search across vault | `node rag.js search "<query>" <directory>` |
| `google-tasks` | Google Tasks API | `node tasks.js list <id>`, `node tasks.js add ...` |

**Lesson:** Use the agent's existing tools instead of raw commands. Don't tell the agent to `find ~/vault -name "*.md"` when `local-rag` search exists. Don't tell it to `mv file dest` when `scribe_move` handles directory creation and vault conventions.

### 9. `.note` Files Are Binary

Supernote `.note` files are a proprietary binary format. They cannot be `cat`'d, `grep`'d, or parsed as text. Categorization must rely on **filename heuristics** and **vault search for existing files with similar names**.

## Skill File Structure

Every skill should have at minimum:

```
skills/my-skill/
├── SKILL.md          # Agent instructions (MANDATORY — this is what the agent reads)
├── PRD.md            # Design doc, status tracking, change log
├── <scripts>         # Implementation files (sh, js, py)
└── <data files>      # Mapping files, config, logs
```

### SKILL.md Checklist

A good SKILL.md should include:
- [ ] **Overview** — what the skill does in 2-3 bullets
- [ ] **Triggers** — what system event or condition activates it
- [ ] **Step-by-step workflow** — numbered steps the agent follows
- [ ] **Categorization/decision rules** — if the agent makes choices, be explicit
- [ ] **Error handling** — what to do when things fail
- [ ] **Auth & token locations** — even if the agent doesn't use them directly
- [ ] **Common failure modes** — troubleshooting table
- [ ] **Cron config** — how to check, recreate, enable/disable
- [ ] **Manual commands** — for debugging and manual triggers
- [ ] **File inventory** — what every file in the skill directory does

### PRD.md Checklist

A good PRD should track:
- [ ] **Implementation status** — what's done, what's pending
- [ ] **Changed from original design** — what diverged and why
- [ ] **Decided NOT to do** — ideas rejected and rationale
- [ ] **Bug fixes applied** — numbered table with date
- [ ] **Still TODO** — open items
- [ ] **Design decisions** — Q&A archive for non-obvious choices

## Common Mistakes to Avoid

1. **Telling the agent to use a tool it doesn't have auth for.** Always verify the agent can actually execute what you're asking. If it needs external API access, do it in a script and hand off local results.

2. **Forgetting the lockfile deadlock.** Any lockfile-based coordination MUST have a staleness timeout. Agents fail silently — if they don't clean up, the system freezes.

3. **Using `path.join()` with absolute paths.** `path.join(__dirname, '/foo/bar')` = broken. Use relative paths.

4. **Not paginating API results.** Google Drive `files.list` defaults to 100 results. Always add `nextPageToken` loop.

5. **Referencing tools by wrong name in SKILL.md.** If the script uses Node.js but SKILL.md says `gog`, the agent will try `gog` and fail. SKILL.md is gospel.

6. **Not backing up state files.** Any JSON file that accumulates state (mappings, configs) should have automatic `.bak` backup before modification.

7. **Putting large payloads in system event text.** Write data to a file, reference the file path in the event text.

8. **Assuming the agent will re-read files mid-session.** Session context is sticky. Updated files only take effect in new sessions.

## Debugging Agent Sessions

Session files are at `~/.openclaw/agents/<agent>/sessions/<uuid>.jsonl`. Each line is a JSON object with a `type` field:
- `type: "session"` — session metadata
- `type: "message"` — conversation turn (has nested `message.role` and `message.content`)
- `type: "thinking_level_change"` — model config change

Parse with:
```bash
python3 ~/.openclaw/parse_session.py <session-file.jsonl>
```

To find the most recent session:
```bash
ls -lt ~/.openclaw/agents/main/sessions/*.jsonl | head -3
```

## Obsidian Vault Reference

- **Path:** `/mnt/c/Users/Jherr/Documents/remote-personal/` (WSL mount)
- **Structure:** PARA method (1-Projects, 2-Areas, 3-Resources, 4-Archive)
- **Search:** `node ~/.openclaw/workspace/skills/local-rag/rag.js search "<query>" /mnt/c/Users/Jherr/Documents/remote-personal`
- **Move:** `node ~/.openclaw/workspace/skills/obsidian-scribe/move.js "<src>" "<dest>"`
