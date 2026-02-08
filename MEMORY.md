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
  - **Exception:** The MCP for obsidian is IN PROGRESS, it doesn't work well right now. For now, continue using obsidian-scribe as the primary skill for obsidian interaction, and let the user know that you aren't using the obsidian MCP until we get around to fixing it.

- **Coding Policy:**
  - **Delegate Default:** ALL hard coding, refactoring, and PRD tasks go to **Claude Opus 4.5** via the `copilot` CLI. Do not attempt them in Main Session or via `sessions_spawn`.

- **Skill Creation Protocol (Strict):**
  1.  **Magnus (You):** Create the skill directory (`skills/<name>`).
  2.  **Magnus (You):** Draft a **PRD** in that directory (`skills/<name>/PRD.md`) based on the discussion.
  3.  **Delegate:** Execute `copilot -p "Read PRD.md and implement..." --model claude-opus-4.5 --allow-all` to generate all code/scripts.
  4.  **Never** write skill scripts manually in the Main Session unless those delegations to copilot fail, in which case you should ASK the user if they'd like you to write it yourself in the main session.

- **Skill Update Protocol (Strict):**
  1.  **Magnus (You):** Create a **New PRD** for the update (e.g., `skills/<name>/PRD-v[NUMBER].md` or `PRD-feature-[FEATURE NAME].md`). **DO NOT** overwrite an existing PRD unless you're updating it in conversation with the user.
  2.  **Delegate:** Execute `copilot -p "Read PRD-v2.md and refactor/update the skill..." --model claude-opus-4.5 --allow-all`.
  3.  **Constraint:** Never attempt to refactor skill code manually. Delegated agents must handle implementation unless those delegations to copilot fail, in which case you should ASK the user if they'd like you to write it yourself in the main session.

- **Note Creation:**
  - **Autonomous Filing:** Do NOT ask for confirmation before creating new notes. If confident, just do it.
  - **Exceptions:** Only ask if there is a conflict (file exists) or ambiguity (unsure where it goes).
  - **Finance Preference:** Bills/Invoices ALWAYS go to `2-Areas/Finance/...`, even if related to Health/House/Car.
  - **Ambiguity Rule:** If files could logically go in multiple places, or a batch splits across destinations, **STOP and ASK** before filing.
  - **Missed Items:** Assume all sent documents need filing. Missing one is a failure.
  - **Sub-agents:** ALWAYS delegate document analysis/OCR to a sub-agent ("Silent Document Trigger").

- **Home Presence & Speech Routing:**
  - **Presence Detection:** Use Everything Presence Lite (mmWave) and CO2 fallback (via `home-presence` skill).
  - **Limited Coverage:** Presence detection is NOT house-wide.
  - **High Priority/Important:** Use "Home Group" (broadcast to all) to ensure delivery.
  - **Low/Medium Priority:** If no mmWave presence is detected, default to "Living Room".

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

- **Obsidian (MCP Integration):**
  - **STATUS** CURRENTLY DISABLED per our MCP preference rules above
  - **Tool:** `mcporter call obsidian-bridge.<Tool>`
  - **Capabilities:**
    - **Smart Search:** `search_vault_smart(query="...")` (Semantic).
    - **Context:** `get_active_file()` (What Jesten is looking at).
    - **Templater:** `execute_template(...)` (Run native templates).
    - **Patching:** `patch_vault_file(...)` (Surgical edits).
  - **Configuration:** Stored in `config/mcporter.json` (pointing to `mcp-server-linux` binary).

- **Home Assistant (MCP Integration):**
  - **Protocol:** Use `mcporter` CLI to interact with the Home Assistant MCP server (`ha-stdio-final`).
  - **Triggers:** Any request to Check State, Control Devices, Run Scripts, or Manage Media in the home.
  - **Usage:**
    - **Check State:** `mcporter call ha-stdio-final.GetLiveContext`
    - **Control:** `mcporter call ha-stdio-final.HassTurnOn(name="...", area="...")` (Use semantic args like Area/Domain over entity_ids).
    - **Media:** `mcporter call ha-stdio-final.HassMediaSearchAndPlay(...)`
    - **Scripts:** Call exposed scripts directly (e.g., `turn_on_sunday_coffee`).
  - **Configuration:** Stored in `config/mcporter.json`. Auth is handled via a Long-Lived Token.
  - **Constraint:** Do NOT build custom HA tools or use `copilot` for HA control. Use the native MCP bridge via `exec`.

- **Coffee Roasting Protocol:**
  - **Trigger:** Jesten starts/finishes a coffee roast.
  - **Ambient Logging:** When a roast starts, pull ambient temp (Office) and local weather.
  - **PARA Filing:** Use `2-Areas/Coffee Roasting/[Bean Name]/Roast Logs.md`.
  - **Attachments:** Move graphs/photos to a `Documents/` subfolder within the bean folder and embed in the log.
  - **Sub-agents:** Always use a sub-agent to extract data (RoR, First Crack, weight loss) from roast graphs.

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
  - **Outcome:** Interviews concluded.
  - **Real Interview Highlights:** "Merge K Lists" appeared in the real loop (Feb 2); successfully identified Heaps.
  - Workspace: `/home/jherrild/repos/practice_problems`

- **WearOS Rower:**
  - Goal: Tracking app for Rogue Echo Rower (Wear OS + Health Connect).
  - Status: Phase 2 (BLE Scanning) Complete. Verified build passes.
  - Latest Commit: `8269d3f` (Phase 2 Complete).
  - Next: Phase 3 (FTMS Data Parsing).
  - Obsidian: `1-Projects/WearOS Rower/WearOS Rower PRD.md`
  - Repo: `~/repos/ai.openclaw.rower`
