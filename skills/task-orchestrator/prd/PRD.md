# PRD: Task Orchestrator (Systemd-based Script Scheduler)

## Goal
Generalize the logic used in `ha-bridge.js` and `interrupt-manager.js` to create a lightweight, systemd-backed task orchestrator. This tool will manage arbitrary, parameterized bash/node scripts on a schedule WITHOUT spawning an AI sub-agent unless the script explicitly requests one.

## Core Requirements
1. **Systemd Integration:** Each task should be managed as a native `systemd` user service and timer.
2. **Cheap Triggers:** Scripts run locally on the host. They only "wake" the main Magnus agent (via `openclaw system event` or similar) if they detect actionable work.
3. **Parameterized:** Support passing arguments to scripts.
4. **CLI Management:** A tool to add, list, remove, and manually trigger tasks.
5. **Logging:** Standardized logging via `journalctl`.

## Initial Implementation: Supernote Sync
- Move the current `supernote-sync` from OpenClaw's internal cron to this new orchestrator.
- **Trigger:** Every 30-60 minutes (parameterized).
- **Logic:** Run the sync script. If a new note is found, send a system event to Magnus to file it.

## File Structure
- `skills/task-orchestrator/orchestrator.js`: The CLI management tool.
- `skills/task-orchestrator/templates/`: Systemd service and timer unit templates.
- `skills/task-orchestrator/tasks.json`: Metadata about managed tasks.

## Reference Code
- Use `ha-bridge.js` for singleton/process management patterns.
- Use `interrupt-manager.js` for rule/task management patterns.
