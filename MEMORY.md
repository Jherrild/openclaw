# MEMORY.md

## Active Status
- **Authorization Requests:** Must be on a new line and **bold** to ensure visibility.
- **Cron Jobs:** SUSPENDED (as of 2026-02-03) — Google API rate limited. Ask Jesten before re-enabling.
- **Model Switching:** If struggling on a lower-tier model for a few turns, offer to switch to Gemini 3 Pro.

- **MCP Preference:** Always prefer official MCP tools over custom skills/raw API calls. If MCP fails, **ASK** before falling back.

- **Skill Creation:** Create `skills/<name>/PRD.md` first, then delegate via `copilot-lock.sh -p "task"`. Never write skill scripts manually unless delegation fails (then ASK).
- **Skill Updates:** Create a new PRD (`PRD-v[N].md`). Don't overwrite existing PRDs. Delegate via `copilot-lock.sh`.

## Skills
Skills are registered via SKILL.md frontmatter (`---` YAML block with `name:` and `description:`). OpenClaw injects registered skills into the system prompt automatically.

- **Frontmatter Lint Rule:** When you `read` any SKILL.md, verify it starts with valid `---` YAML frontmatter containing `name:` and `description:`. If malformed or missing, **alert Jesten immediately** — the skill is invisible to the model without it.
- **MANDATORY skills:** `copilot-delegate` (all code), `obsidian-scribe` (all Obsidian writes).
- **Search Protocol:** Always use `local-rag` + `memory_search` before creating notes or answering history questions.
- **Filing details:** See `docs/obsidian-filing-rules.md`. Dual storage: update both MEMORY.md and Obsidian.

## Interrupt & Notification Protocol
Use `interrupt-service` as buffer to prevent unnecessary agent wakes. Full CLI reference in `skills/interrupt-service/SKILL.md`.
- ALL background notifications/alerts MUST use `interrupt-cli.js`.
- "Next time X happens" → `--one-off`. "Whenever X happens" → persistent (default).
- `action: subagent` for complex events, `action: message` for simple alerts.
- Check `skills/home-presence/` logs for event JSON to inform interrupt conditions.
- Deleted interrupt examples: `docs/interrupt-examples.md`.

## Home Assistant Protocol
- **Observation:** `home-presence` (presence.js locate) → HA MCP (GetLiveContext) → domain-specific logs in `skills/home-presence/`
- **Actions:** `home-presence` (follow-and-speak/announce) for voice → HA MCP for device control
- **Logs:** Prefer domain-specific logs (`presence-log.jsonl`, `lighting-log.jsonl`, etc.). Fallback: `home-status-raw.jsonl`.

## Projects
- **Solar:** 15kW array + 30kWh battery, ~$15,400 (after 30% credit), ~5yr payback. Grid-tied. Obsidian: `1-Projects/DIY Solar.md`
- **Interview Prep (Nvidia):** **Completed** (Feb 2026). Offer pending. Workspace: `~/repos/practice_problems`
- **WearOS Rower:** Phase 2 (BLE) complete. Next: Phase 3 (FTMS). Repo: `~/repos/ai.openclaw.rower`
- **Google Home Voice Bridge:** HA intent configured. Blocked on network isolation. Proposed: IFTTT + Nabu Casa webhook bridge.

## Coffee Roasting
- Remind: "Flick & Crash Strategy: Drum D7, Fan Max F4, cut power *before* First Crack."
- Log ambient temp + weather at roast start. File to `2-Areas/Coffee Roasting/[Bean]/Roast Logs.md`.
- Use sub-agents to extract data (RoR, First Crack, weight loss) from roast graphs.
