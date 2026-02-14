# Copilot Instructions — OpenClaw Workspace

> **Read `OPENCLAW_SKILL_DEV_GUIDE.md` in the workspace root for detailed architecture and lessons learned.**
> This file captures the operating context, user preferences, and development conventions for this workspace.

---

## What This Workspace Is

This is the workspace for **Magnus**, an OpenClaw AI agent running on a Linux (WSL2) host. OpenClaw is a self-hosted gateway that connects chat apps (Telegram, WhatsApp, Discord) to AI agents. Magnus is the primary agent — he orchestrates tasks, manages a second brain (Obsidian), controls smart home devices, and delegates coding work to Copilot (you).

### Key Paths
| Path | Purpose |
|------|---------|
| `~/.openclaw/workspace/` | Magnus's workspace root (this repo) |
| `~/.openclaw/openclaw.json` | Gateway config (models, channels, skills, hooks) |
| `~/.openclaw/agents/main/sessions/` | Session transcripts (JSONL) |
| `~/.openclaw/workspace/skills/` | Skill directories |
| `~/.openclaw/workspace/memory/` | Daily memory logs (not auto-injected) |
| `~/.openclaw/workspace/docs/` | Reference docs (searchable, not injected into agent context) |
| `/mnt/c/Users/Jherr/Documents/remote-personal` | Obsidian vault (PARA structure) |

### Bootstrap Files (Injected Every Turn)
These files are injected into the agent's context window on every API call. Keep them small:
- `AGENTS.md` — Agent behavior rules (~4.4k chars)
- `MEMORY.md` — Curated long-term memory (~3.3k chars)
- `USER.md` — User profile and preferences (~1.9k chars)
- `SOUL.md` — Agent personality (~2.3k chars)
- `TOOLS.md` — Local device notes (~1k chars)
- `IDENTITY.md` — Agent identity (~216 chars)
- `HEARTBEAT.md` — Periodic task checklist (~1.2k chars)

**Sub-agents only receive AGENTS.md + TOOLS.md.** All other bootstrap files are filtered out.

---

## The User: Jesten

- **Role:** Software Engineer at GitHub
- **Location:** Whidbey Island, WA (America/Los_Angeles)
- **Neurodiversity:** ADHD, likely Autistic
- **Communication style:** Efficient, concise, complete. Limited token budget — hates waste.
- **Copilot access:** Unlimited via GitHub employee benefit. Uses Copilot for coding tasks only (within TOS).
- **Primary email:** `jestenh@gmail.com`
- **Connected via:** Telegram (id:5918274686)

### Jesten's Preferences
- **Token frugality is paramount.** Every design decision should minimize token usage.
- **Don't over-engineer.** Solve the problem at hand, note follow-ups separately.
- **Obsidian is sacred.** Never delete notes. Archive to `4-Archive/`. Use `obsidian-scribe` skill for all writes.
- **PARA structure:** Projects, Areas, Resources, Archive. Finance always → `2-Areas/Finance/`.
- **Conventional commits:** `<type>(<scope>): <description>` (feat, fix, refactor, docs, chore).
- **Prefers systemd-backed solutions** for background tasks (via `task-orchestrator`).
- **Interrupt-driven architecture:** Prefers agents that sleep until woken by events, rather than polling.

---

## OpenClaw Architecture (What You Need to Know)

### Models & Providers
Magnus uses multiple models via OpenClaw's provider system:
- **Primary:** `ollama/glm-5:cloud` (128k context via Ollama cloud)
- **Fallbacks:** `ollama/kimi-k2.5:cloud` (256k), `google/gemini-3-flash-preview` (500k effective — capped from 1M to prevent rate limit overages)
- **Heartbeat/cheap tasks:** `gemini-flash`
- **Sub-agents:** `glm-5`

Config is at `~/.openclaw/openclaw.json`. Models are configured under `agents.defaults.model` and `models.providers`.

### Context Window Economics
Every API call includes: system prompt (~9-15k tokens) + bootstrap files (~3.5k tokens) + conversation history + tool calls/results + tool schemas.

Key findings from analysis:
- **Sub-agents cost ~13k tokens minimum** just to start (system prompt + AGENTS.md + TOOLS.md + tool schemas). Never spawn a sub-agent for <20k tokens of work.
- **Gemini Flash** was hitting 1M tokens/minute rate limits due to burst tool-calling loops (41 requests/minute). Context window was capped to 500k to force earlier compaction.
- **GLM-5** returns opaque `500 Internal Server Error` when context overflows (no descriptive error). Context window set to 128k explicitly.
- Compaction mode is `safeguard` with 20k reserve floor.

### Skills System
Skills are directories under `skills/` containing a `SKILL.md` with YAML frontmatter:

```yaml
---
name: skill-name
description: One-line description of what this skill does.
---
```

**CRITICAL:** Without the `---` YAML frontmatter block containing `name:` and `description:`, the skill is INVISIBLE to Magnus. OpenClaw will not inject it into the system prompt. This was a major bug discovered 2026-02-14 — 6 implemented skills were missing frontmatter and invisible to the agent.

Skills list (name + description) is injected into the system prompt on every turn. Full SKILL.md instructions are loaded on-demand when the agent reads the file.

### Currently Registered Skills (14)
| Skill | Purpose |
|-------|---------|
| `copilot-delegate` | Delegate coding to Copilot CLI (you) |
| `expert-check` | High-IQ reasoning sub-agent |
| `google-docs` | Google Documents CRUD |
| `google-home-bridge` | Voice command bridge (IFTTT → HA → interrupt) |
| `google-tasks` | Task list management |
| `home-presence` | Room occupancy, person tracking, TTS |
| `interrupt-service` | Event orchestration daemon (port 7600) |
| `label-printer` | Brother QL-820NWB label printing |
| `local-rag` | Semantic search (Obsidian + workspace) |
| `market-watch` | Financial data + watchlist alerts |
| `monarch-bridge` | Monarch Money financial data (read-only) |
| `obsidian-scribe` | Obsidian note management (PARA) |
| `supernote-sync` | Supernote → Obsidian sync daemon |
| `task-orchestrator` | Systemd-backed task scheduler |

### PRD-Only Skills (Not Yet Implemented)
| Skill | Planned merge target |
|-------|---------------------|
| `channel-resolver` | Keep separate (shared routing service) |
| `kanban-sync` | Keep separate (GitHub Projects integration) |
| `priority-check` | Merge into `interrupt-service` (semantic matching) |
| `process-manager` | Merge into `task-orchestrator` (`run-bg` command) |
| `task-triage` | Merge into `google-tasks` (`triage` subcommand) |

### The Interrupt Pipeline
This is the core architecture Jesten is building — agents that sleep until events wake them:

```
Collection (systemd timers via task-orchestrator)
  → Script runs, echoes findings to stdout, exits 0
  → interrupt-wrapper.sh captures output
  → Fires event to interrupt-service (port 7600)
  → Rule matching (entity_id, state, wildcards)
  → Dispatch: message (simple) or subagent (complex)
  → Agent wakes, handles event, goes back to sleep
```

Key design principle: **Scripts are dumb collectors. They don't know about agents or interrupts.** They just echo and exit. The wrapper handles everything.

---

## Development Conventions

### When Creating or Modifying Skills
1. **Always include YAML frontmatter** in SKILL.md with `name:` and `description:`.
2. **Follow conventional commits** for all git operations.
3. **If a PRD exists**, read it critically and improve it. If none exists, draft one capturing requirements.
4. **Run existing tests** before and after changes.
5. **Update SKILL.md** if you change the skill's interface or behavior.
6. **Don't modify bootstrap files** (AGENTS.md, MEMORY.md, etc.) unless explicitly asked.

### Code Style
- Node.js for skills (consistent across the codebase)
- Python for data processing scripts (Obsidian sync, OCR, ML)
- Shell scripts for wrappers and glue
- ESM imports preferred over CommonJS where possible
- Error handling: fail loudly with descriptive messages

### File Operations on Obsidian Vault
**NEVER use raw file tools** on `/mnt/c/Users/Jherr/Documents/remote-personal`. Always use the `obsidian-scribe` skill which enforces linting, tagging, and PARA structure.

### Testing
- Skills with tests: `supernote-sync` (`test-sync.js`), `interrupt-service` (`test-integration.js`)
- Run tests after modifying these skills
- For new skills, add at minimum a smoke test

---

## Copilot-Delegate (How You Are Called)

Magnus delegates coding tasks to you via `copilot-lock.sh`. Currently:
- **Model issue:** `-p` mode ignores model selection and defaults to Sonnet 4, even though `config.json` specifies `claude-opus-4.6-1m`. This is a known issue being investigated. Interactive sessions correctly use opus.
- **The wrapper** (`copilot-lock.sh`) handles mutex locking, interrupt notification on completion, and session transcript saving.
- **Summary directive** and **auto-commit instructions** are currently embedded in the prompt by Magnus. A v3 redesign (PRD-v3.md) plans to move all boilerplate into the wrapper so Magnus only provides the task description.
- **last-result.md** should always be overwritten with: what you understood, what you did, status, and follow-up items.

### When You Receive a Task
1. Read `copilot-instructions.md` and `OPENCLAW_SKILL_DEV_GUIDE.md` for conventions.
2. If given a PRD, review it critically. If not, draft a brief one.
3. The delegating agent (Magnus) has less context capacity — verify intent by reading surrounding files.
4. Test your changes. Verify code parses/compiles at minimum.
5. Auto-commit with conventional commit messages. Only stage files you touched.
6. Write `last-result.md` as if the reader is non-technical.
7. Note follow-up items separately — don't silently scope-creep.

---

## Lessons Learned (2026-02-14 Session)

### Token Optimization
- Bootstrap files were 37k chars → reduced to 14k chars (62% reduction) by compressing verbose instructions and moving reference material to `docs/` files.
- Sub-agent spawn threshold was 500 tokens — raised to 20k because sub-agents cost ~13k tokens just to start.
- Gemini Flash was hitting 1M tokens/minute rate limit. Context window capped to 500k to force earlier compaction. Burst tool-calling loops (40+ requests/minute) were the main cause.
- Hardcoded skill table in MEMORY.md was redundant once skills had proper frontmatter. Replaced with a lint directive.

### Skill Frontmatter Bug
6 implemented skills (`interrupt-service`, `task-orchestrator`, `local-rag`, `supernote-sync`, `label-printer`, `google-home-bridge`) were missing YAML frontmatter and were invisible to Magnus. He could only find them via the hardcoded table in MEMORY.md. Fixed 2026-02-14.

### Obsidian Filing
Filing rules were duplicated across 4 files. Consolidated into `docs/obsidian-filing-rules.md` with references from bootstrap files.

### Model Context Windows
Ollama cloud models had no explicit context window configuration, causing OpenClaw to assume 200k default. GLM-5 was hitting 500 errors. Fixed by adding explicit `contextWindow` and `maxTokens` in `models.providers.ollama.models[]`.

---

## Reference: Config Locations

| File | Purpose |
|------|---------|
| `~/.openclaw/openclaw.json` | Main gateway config |
| `~/.openclaw/openclaw.json.BAK` | Backup before model tuning |
| `backups/pre-optimization-2026-02-14/` | Original AGENTS.md, MEMORY.md, USER.md |
| `docs/obsidian-filing-rules.md` | Consolidated Obsidian filing protocol |
| `docs/heartbeat-guide.md` | Heartbeat vs cron guidance |
| `docs/group-chat-guide.md` | Group chat etiquette |
| `docs/interrupt-examples.md` | Reference interrupt rule JSON |
| `skills/copilot-delegate/PRD-v3.md` | Simplified delegation redesign |
