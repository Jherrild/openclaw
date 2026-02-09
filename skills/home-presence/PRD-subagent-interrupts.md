# PRD: Sub-agent Interrupt Dispatcher

## Goal
Refactor the `home-presence` interrupt logic to use isolated sub-agents (`sessions_spawn`) instead of direct system events. This saves tokens by preventing large main-session context loads for routine log-checking or state-evaluation tasks.

## Requirements
1.  **HA Bridge Refactor (`ha-bridge.js` / `interrupt-manager.js`):**
    - Instead of calling `openclaw system event`, the bridge should call `openclaw sessions spawn`.
    - **Agent Target:** Use a fast/cheap model (e.g., `gemini-flash`).
    - **Task Construction:** The spawned task must include:
        - The original interrupt details (entity, state, label).
        - The specific instructions associated with that interrupt (e.g., "Check if she was away for 30m").
        - **Boilerplate Routing:** A standard instruction to use `openclaw sessions send` (or a system event targeting the main session) ONLY if the agent determines a notification is necessary.
    - **Timeout:** Set a reasonable run timeout (e.g., 60-120s).

2.  **Notification Flow:**
    - Sub-agent wakes up -> Reads logs/context -> Decides if notification is needed.
    - **If Yes:** Sub-agent sends a message/event back to the Main Session (label: `main`).
    - **If No:** Sub-agent terminates silently.

3.  **Concurrency & Safety:**
    - Ensure the sub-agent has access to the `presence-log.jsonl` and any necessary skills (like `obsidian-scribe` if filing is requested).
    - Maintain existing rate-limiting to prevent sub-agent "storms."

4.  **Documentation:**
    - Update `SKILL.md` to reflect the new asynchronous, sub-agent-driven interrupt flow.
