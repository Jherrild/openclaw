# MEMORY.md

## Active Status
- **Authorization Requests:** Must be on a new line and **bold** to ensure visibility.
- **Cron Jobs:** SUSPENDED (as of 2026-02-03) — Google API rate limited. Ask Jesten before re-enabling.

- **Model Switching Protocol:**
  - **Trigger:** If struggling with a complex task or reasoning loop for a few turns on a lower-tier model (e.g., Flash).
  - **Action:** Offer to switch to a better model (currently **Gemini 3 Pro**) to resolve the issue more quickly.

- **MCP Preference Rule:**
  - **General:** Always prefer official MCP tools over custom-built skills or raw API calls.
  - **Fallback Protocol:** If an MCP tool fails or is unreachable, **ASK** before falling back to whatever custom skill, processes, or legacy/custom tools you might use to accomplish the same thing (filesystem tools).

- **Skill Creation Protocol (Strict):**
  1.  **Magnus (You):** Create the skill directory (`skills/<name>`).
  2.  **Magnus (You):** Draft a **PRD** in that directory (`skills/<name>/PRD.md`) based on the discussion.
  3.  **Delegate:** Execute `copilot-lock.sh -p "Read PRD.md and implement..." --model claude-opus-4.6 --allow-all` via the `copilot-delegate` skill.
  4.  **Never** write skill scripts manually in the Main Session unless those delegations to copilot fail, in which case you should ASK the user if they'd like you to write it yourself in the main session.

- **Skill Update Protocol (Strict):**
  1.  **Magnus (You):** Create a **New PRD** for the update (e.g., `skills/<name>/PRD-v[NUMBER].md` or `PRD-feature-[FEATURE NAME].md`). **DO NOT** overwrite an existing PRD unless you're updating it in conversation with the user.
  2.  **Delegate:** Execute `copilot-lock.sh -p "Read PRD-v2.md and refactor/update the skill..." --model claude-opus-4.6 --allow-all` via the `copilot-delegate` skill.
  3.  **Constraint:** Never attempt to refactor skill code manually. Delegated agents must handle implementation unless those delegations to copilot fail, in which case you should ASK the user if they'd like you to write it yourself in the main session.

## Skills
Skills are registered via SKILL.md frontmatter (`---` YAML block with `name:` and `description:`). OpenClaw injects registered skills into the system prompt automatically — you do NOT need a hardcoded table here.

- **Frontmatter Lint Rule:** When you `read` any SKILL.md, verify it starts with valid `---` YAML frontmatter containing `name:` and `description:`. If malformed or missing, **alert Jesten immediately** — the skill is invisible to the model without it.
- **MANDATORY skills:** `copilot-delegate` (all code), `obsidian-scribe` (all Obsidian writes).
- **Search Protocol:** Always use `local-rag` and `memory_search` before creating notes or answering history questions.
- **Filing Rule:** Financial documents (bills/taxes) ALWAYS go to `2-Areas/Finance/` regardless of subject.
- **Privacy:** Treat all home sensor data and personal notes as strictly private.

- **Note Creation:**
  - **Autonomous Filing:** Do NOT ask for confirmation before creating new notes. If confident, just do it.
  - **Exceptions:** Only ask if there is a conflict (file exists) or ambiguity (unsure where it goes).
  - **Finance Preference:** Bills/Invoices ALWAYS go to `2-Areas/Finance/...`, even if related to Health/House/Car.
  - **Ambiguity Rule:** If files could logically go in multiple places, or a batch splits across destinations, **STOP and ASK** before filing.
  - **Missed Items:** Assume all sent documents need filing. Missing one is a failure.
  - **Sub-agents:** ALWAYS delegate document analysis/OCR to a sub-agent ("Silent Document Trigger").

- **Interrupt & Notification Protocol:**
  - **The Goal:** Use the `interrupt-service` as a buffer to prevent unnecessary agent wakes.
  - **Usage:** Use this for ANY system-level daemon (Supernote sync, HA Bridge, Mail Sentinel) or long-running task that doesn't require immediate intervention.
  - **Behavior:** The service will only wake/notify an agent if the event matches pre-determined high-priority criteria.
  - **Rules:**
    - **Creation:** ALL home-based or background notifications/alerts MUST be created as interrupts via `interrupt-cli.js`.
    - **Duration Logic:** 
        - "The **next time** X happens" → Use `--one-off` flag.
        - "**Whenever** X happens" → Persistent rule (default).
    - **Actions:** Use `action: subagent` to analyze and decide on notification for complex events; use `action: message` for simple system alerts.
    - **Discovery:** To inform interrupt conditions (finding the exact event JSON), check the specialized logs in `skills/home-presence/`.

- **Home Assistant & Presence Protocol:**
  - **Goal:** Accurate home awareness and reliable physical presence (voice).
  - **Tool Hierarchy (Observation/Questions):**
    1. **`home-presence` (Skill):** Use `presence.js locate` first for occupancy and person status.
    2. **HA MCP (`ha-stdio-final`):** Use `GetLiveContext` for real-time device states (lights, climate, media) not covered by `home-presence`.
    3. **Logs (`skills/home-presence/`):** Inspect JSONL logs for historical context or specific event details.
  - **Tool Hierarchy (Actions):**
    1. **`home-presence` (Skill):** Use `follow-and-speak` or `announce` for all voice output.
    2. **HA MCP (`ha-stdio-final`):** Use for controlling devices (lights, switches, scenes) or running scripts.
  - **Log Strategy:**
    - Prefer domain-specific logs: `presence-log.jsonl`, `lighting-log.jsonl`, `climate-log.jsonl`, `automation-log.jsonl`.
    - Fallback: Check `home-status-raw.jsonl` if the domain is ambiguous or nothing is found in the others.

- **Solar Project:**
  - Goal: Net-positive cash flow using 15kW array + 30kWh battery.
  - Net Cost: ~$15,400 (after 30% credit).
  - Payback: ~5 years.
  - Note: Grid-tied strategy (overproduce summer to cover winter).
  - Obsidian: `1-Projects/DIY Solar.md`

- **Obsidian Research Protocol:**
  - **Hybrid Search:** Always use the `local-rag` tool (`search` and `query`) in addition to `grep` when searching for concepts or specific entities in the Obsidian vault.
  - **Pre-Creation Check:** Before creating a new note, use `local-rag` to check for existing relevant notes. Prefer updating an existing note over creating a duplicate, but never delete content from notes. Always make sure edits are targeted, and either add a new section, or append to an existing one.
  - **Tool Location:** `skills/local-rag/rag.js`.

- **Coffee Roasting Protocol:**
  - **Trigger:** Jesten starts/finishes a coffee roast.
  - **Action:**
    1.  **Remind:** "Remember the **Flick & Crash Strategy**: Drum D7, Fan Max F4, and cut power *before* First Crack."
    2.  **Ambient Logging:** When a roast starts, pull ambient temp (Office) and local weather.
    3.  **PARA Filing:** Use `2-Areas/Coffee Roasting/[Bean Name]/Roast Logs.md`.
    4.  **Attachments:** Move graphs/photos to a `Documents/` subfolder within the bean folder and embed in the log.
    5.  **Sub-agents:** Always use a sub-agent to extract data (RoR, First Crack, weight loss) from roast graphs.

- **Reference: Deleted Interrupts:**
  - **April Jane Arrived (Original):**
    ```json
    {
      "id": "int-mlehw1k2-1qa8",
      "entity_id": "person.april_jane",
      "state": "home",
      "label": "April Jane Arrived (30m Debounce)",
      "instruction": "Only notify Jesten via Telegram if he is NOT home (person.jesten_herrild != 'home'). IMPORTANT: Before notifying, check the presence-log.jsonl to verify she has been away (not_home) for at least 30 consecutive minutes prior to this 'home' event. If she was home within the last 30 minutes, ignore this trigger.",
      "channel": "telegram"
    }
    ```

- **Google Home → Magnus Voice Bridge (Active Project):**
  - **Goal:** Enable "Hey Google, tell Magnus [message]" speech-to-text delivery.
  - **Current Status:**
    - **HA Side:** Custom `MagnusMessage` intent and `rest_command` are configured.
    - **Network Hurdle:** Home Assistant (OS) is currently unable to reach the Magnus gateway (`nr200p-1:18789`) due to network isolation/WSL2 bridging issues. Pings to both Tailscale and Local IPs fail from HA.
    - **Proposed Solution:** Switch to an **IFTTT + Nabu Casa Webhook** bridge to bypass local network isolation.
    - **Key Configs:** HA Automation requires `message: "{{ trigger.slots.message }}"` and `rest_command` requires a Bearer token (stored in `secrets.yaml` as `magnus_bearer_token`).
    - **Backdoor:** Verified emergency SSH access to HA via Port 22222 (requires USB `CONFIG/authorized_keys` method for permanent host-level access).

## Projects
- **Interview Prep (Nvidia):**
  - Status: **Completed** (Feb 2026)
  - **Outcome:** Interviews concluded. **Offer pending.**
  - **Real Interview Highlights:** "Merge K Lists" appeared in the real loop (Feb 2); successfully identified Heaps.
  - Workspace: `/home/jherrild/repos/practice_problems`

- **WearOS Rower:**
  - Goal: Tracking app for Rogue Echo Rower (Wear OS + Health Connect).
  - Status: Phase 2 (BLE Scanning) Complete. Verified build passes.
  - Latest Commit: `8269d3f` (Phase 2 Complete).
  - Next: Phase 3 (FTMS Data Parsing).
  - Obsidian: `1-Projects/WearOS Rower/WearOS Rower PRD.md`
  - Repo: `~/repos/ai.openclaw.rower`
