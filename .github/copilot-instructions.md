# Copilot Instructions — OpenClaw Workspace

> **Read `OPENCLAW_SKILL_DEV_GUIDE.md` in the workspace root for detailed architecture and lessons learned.**
> This file captures the operating context, user preferences, and development conventions for this workspace.

---

## What This Workspace Is

This is the workspace for **Magnus**, an OpenClaw AI agent running on a Linux (WSL2) host. OpenClaw is a self-hosted gateway that connects chat apps (Telegram, WhatsApp, Discord) to AI agents. Magnus is the primary agent — he orchestrates tasks, manages a second brain (Obsidian), controls smart home devices, and delegates coding work to Copilot (you). Feel free to include suggestions to Magnus in post-work summaries about what you would consider changing or adding to make it easier to work with.

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
- **Prefer existing tools** — MCP servers via `mcporter.json`, CLI tools, or existing skills — over direct API calls or writing custom ones.

---

## OpenClaw Architecture

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

## Skills Detail & Dependency Graph

```
google-tasks (standalone — owns credentials + node_modules)
    ↑
google-docs (uses google-tasks credentials)
    ↑
supernote-sync (uses google-docs token + google-tasks node_modules)
    ↓
obsidian-scribe (file placement) ← local-rag (vault search)

copilot-delegate (standalone — calls copilot CLI directly)

home-presence (standalone — calls Home Assistant API directly)

interrupt-service (standalone daemon — port 7600)
    ↑
task-orchestrator (schedules scripts, fires interrupts via wrapper)
```

### Per-Skill Script Inventories

**google-tasks:** `tasks.js` (add, list, complete). Owns OAuth `credentials.json` and `token.json`; its `node_modules/` is shared by other skills via `NODE_PATH`.

**google-docs:** `scripts/docs.js` (search, get, create, append). Reuses `google-tasks` credentials; has its own `token.json` at `scripts/token.json`.

**local-rag:** `rag.js` (index, search, query, check). Requires Ollama running locally (`http://localhost:11434`). Used by `obsidian-scribe` and `supernote-sync` for de-duplication.

**obsidian-scribe:** `write.js` (create), `append.js` (append + lint), `move.js` (relocate), `archive.js` (archive), `read_pdf.js` (PDF text extraction), `lint.js` (frontmatter/tag linting). Vault path: `/mnt/c/Users/Jherr/Documents/remote-personal/`.

**supernote-sync:** `check-and-sync.sh` (systemd timer target), `get_new_notes.js`, `get_updated_notes.js`, `store_markdown.js`, `obsidian_migrate.js`, `vault_update.js`, `mapping-utils.js` (YAML mapping CLI). Key data: `<vault>/metadata/supernote-sync-mapping.md`, `.agent-pending` (manifest/lockfile), `buffer/` (pre-downloaded note directories).

**home-presence:** `presence.js` (locate, announce, follow-and-speak, update-layout). Uses HA bearer token from `config/mcporter.json`.

---

## Development Conventions

### When Creating or Modifying Skills
1. **Always include YAML frontmatter** in SKILL.md with `name:` and `description:`.
2. **Follow conventional commits** for all git operations.
3. **If a PRD exists**, read it critically and improve it. If none exists, draft one capturing requirements.
4. **Run existing tests** before and after changes.
5. **Update SKILL.md** if you change the skill's interface or behavior.
6. **Don't modify bootstrap files** (AGENTS.md, MEMORY.md, etc.) unless explicitly asked.
7. **Decouple IO from intelligence.** Scripts do API calls/downloads; agents work with local files.
8. **Lockfiles need staleness guards.** Never create a lockfile without a timeout mechanism.
9. **Back up state files.** Any accumulating JSON should have automatic `.bak` before mutation.

### Code Style
- Node.js for skills (consistent across the codebase)
- Python for data processing scripts (Obsidian sync, OCR, ML)
- Shell scripts for wrappers and glue
- ESM imports preferred over CommonJS where possible
- Error handling: fail loudly with descriptive messages
- Test shell scripts with `bash -n` before committing

### File Operations on Obsidian Vault
**NEVER use raw file tools** on `/mnt/c/Users/Jherr/Documents/remote-personal`. Always use the `obsidian-scribe` skill which enforces linting, tagging, and PARA structure. Prefer using existing MCP tools or CLI tools over direct API calls.

### Testing
- Skills with tests: `supernote-sync` (`test-sync.js`), `interrupt-service` (`test-integration.js`)
- Run tests after modifying these skills
- For new skills, add at minimum a smoke test

### PRD-Driven Design
PRDs are **mandatory** for all skills. They are living documents tracking requirements, status, and decisions.

**Rules:**
1. **Always use a PRD.** If none exists, write one before making changes.
2. **PRDs go in `/prd/` subfolder** within the skill directory. Existing root-level PRDs are fine where they are.
3. **PRDs are living documents.** Read before starting, update during work, finalize after.

**What a good PRD tracks:** Implementation status, design changes, rejected ideas (with rationale), bug fixes, remaining TODOs, and non-obvious design decisions.

---

## Copilot-Delegate (How You Are Called)

Magnus delegates coding tasks to you via `copilot-lock.sh -p "task"`. The wrapper hardcodes:
- **Model:** `claude-opus-4.6` (always)
- **Flags:** `--allow-all`, `--share` (auto-generated transcript)
- **Working directory:** `~/.openclaw/workspace` (for `copilot-instructions.md` auto-injection)
- **Suffix:** Appends `last-result.md` write + auto-commit instructions to every prompt
- **Mutex locking** and **interrupt notification** on completion

Magnus only provides the task description. Everything else is handled by the wrapper.

### When You Receive a Task
1. Read this file and `OPENCLAW_SKILL_DEV_GUIDE.md` for conventions.
2. If given a PRD, review it critically and improve it. If not, draft a brief one.
3. The delegating agent (Magnus) has less context capacity — verify intent by reading surrounding files, git log, and related code.
4. You may perform web searches in service to solving problems in the best way possible.
5. You may delegate subtasks to smaller models via sub-agents when you think it's reasonable.
6. Test your changes. Run existing tests. Verify code parses/compiles at minimum.
7. Note follow-up items in a `## Follow-up` section — don't silently scope-creep.
8. Ensure any new SKILL.md files include proper YAML frontmatter.
9. When delegated by Magnus (non-interactive `-p` mode), the wrapper appends instructions for writing `last-result.md` and auto-committing. In interactive sessions, skip these unless asked.

---

## Lessons Learned (2026-02-14 Session)

### Token Optimization
- Bootstrap files were 37k chars → reduced to 14k chars (62% reduction) by compressing verbose instructions and moving reference material to `docs/` files.
- Sub-agent spawn threshold was 500 tokens — raised to 20k because sub-agents cost ~13k tokens just to start.
- Gemini Flash was hitting 1M tokens/minute rate limit. Context window capped to 500k to force earlier compaction. Burst tool-calling loops (40+ requests/minute) were the main cause.
- Hardcoded skill table in MEMORY.md was redundant once skills had proper frontmatter. Replaced with a lint directive.

### Skill Frontmatter Bug
6 implemented skills were missing YAML frontmatter and were invisible to Magnus. Fixed 2026-02-14. Always verify frontmatter exists when creating or modifying skills.

### Obsidian Filing
Filing rules were duplicated across 4 files. Consolidated into `docs/obsidian-filing-rules.md` with references from bootstrap files.

### Model Context Windows
Ollama cloud models had no explicit context window configuration, causing OpenClaw to assume 200k default. GLM-5 was hitting 500 errors. Fixed by adding explicit `contextWindow` and `maxTokens` in `models.providers.ollama.models[]`.

### openclaw.json Provider Config (2026-02-14 Evening Session)
**Problem:** After config edits, OpenClaw threw validation errors (`baseUrl: expected string, received undefined`, `models.0.name: expected string, received undefined`) and `Unknown model: ollama/glm-5:cloud`.

**Root cause:** The `models.providers` section requires specific fields that the working backups (Feb 11-13) didn't have — because those backups had **no `models.providers` section at all**. OpenClaw auto-discovers providers from `agents.defaults.models` aliases and the resolved `models.json`. The `models.providers` override is only needed to set explicit `contextWindow`, `maxTokens`, or non-default endpoints.

**Required fields when `models.providers` IS present:**
- `baseUrl` — required for all providers (no implicit defaults when section exists)
- `api` — required for custom/non-built-in providers (e.g., `"openai-completions"` for Ollama)
- `models[].name` — required (not just `id`)

**Correct Ollama values:**
- `baseUrl`: `"http://127.0.0.1:11434/v1"` (note: `/v1` suffix required for `openai-completions` API mode; without it → 404)
- `api`: `"openai-completions"`

**Key discovery:** The resolved provider config lives at `~/.openclaw/agents/main/agent/models.json` — useful for debugging what OpenClaw actually sees.

**Useful commands:**
- `openclaw gateway restart` — restarts gateway, lints config, reports errors
- `openclaw agent -m "ping" --agent main` — send test message to agent via CLI

### Skills Watcher EMFILE Warnings
The skills file watcher hits `EMFILE: too many open files` because it watches all files recursively including `node_modules/` (~19,700 files in `skills/`). This is a [known upstream bug](https://github.com/openclaw/openclaw/issues/8851). **These warnings are cosmetic** — they only affect hot-reload of skill changes, not initial skill discovery/loading. Skills load fine despite the warnings.

---

## Reference: Config & Backup Locations

| File | Purpose |
|------|---------|
| `~/.openclaw/openclaw.json` | Main gateway config |
| `~/.openclaw/openclaw.json.BAK` | Backup before model tuning |
| `~/.openclaw/agents/main/agent/models.json` | Resolved provider config (read-only, regenerated by OpenClaw) |
| `backups/pre-optimization-2026-02-14/` | Original AGENTS.md, MEMORY.md, USER.md, copilot-instructions.md |
| `docs/obsidian-filing-rules.md` | Consolidated Obsidian filing protocol |
| `docs/heartbeat-guide.md` | Heartbeat vs cron guidance |
| `docs/group-chat-guide.md` | Group chat etiquette |
| `docs/interrupt-examples.md` | Reference interrupt rule JSON |
| `skills/copilot-delegate/PRD-v3.md` | Simplified delegation redesign |

---

## Active Projects (Obsidian Vault)

When working on OpenClaw-related tasks, check for project context in the Obsidian vault:

```bash
# Read project notes (read-only — NEVER use raw file tools on the vault)
cat "/mnt/c/Users/Jherr/Documents/remote-personal/1-Projects/openclaw/Notes/Obsidian Memory Provider.md"
```

**Key project files:**
| Note | Content |
|------|---------|
| `1-Projects/openclaw/Notes/Obsidian Memory Provider.md` | Native Obsidian memory provider — architecture, decisions, requirements, implementation order |

**Convention:** When working on or discussing any OpenClaw skill or improvement, ensure a corresponding project note exists in `1-Projects/openclaw/Notes/` and is kept up to date. After significant work (new decisions, architecture changes, completed phases), append updates to the relevant note via `obsidian-scribe`. This is the user's durable record — PRDs in the workspace are working docs, but the Obsidian note is what survives across sessions and agents.

**Writing to vault:** Always use `obsidian-scribe`:
```bash
# Create a new note
node skills/obsidian-scribe/write.js "<vault-relative-path>" "<content>" --tags "tag1,tag2"

# Append to existing note
node skills/obsidian-scribe/append.js "<absolute-path>" "<content>"
```

Never use `edit`, `create`, or raw `fs` operations on files under `/mnt/c/Users/Jherr/Documents/remote-personal/`.

---

## Communicating with Jesten via Magnus

When the user steps away or is unavailable at the terminal, send messages through Magnus:

```bash
openclaw agent -m "Magnus, please tell Jesten: '<message>'" --agent main --deliver
```

The `--deliver` flag ensures Magnus actually sends it to Telegram (not just replies in the CLI).
Use this to notify the user when: blocked and need input, finished a long task, encountered a critical error, or completed all planned work. Keep notifying via Magnus until the user says to stop.
