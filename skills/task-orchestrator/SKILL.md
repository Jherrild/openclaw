# Task Orchestrator Skill

A lightweight, systemd-backed task scheduler for managing arbitrary scripts on a schedule WITHOUT spawning AI sub-agents unless explicitly needed.

## Quick Start

```bash
cd ~/.openclaw/workspace/skills/task-orchestrator

# Add a task
./orchestrator.js add my-task /path/to/script.sh --interval=30m

# List tasks
./orchestrator.js list

# Run manually
./orchestrator.js run my-task

# View logs
./orchestrator.js logs my-task

# Remove task
./orchestrator.js remove my-task
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `add <name> <script> [options]` | Register a new scheduled task |
| `remove <name>` | Unregister task and remove systemd units |
| `list` | Show all managed tasks with status |
| `run <name>` | Manually trigger a task |
| `status <name>` | Detailed task and timer status |
| `logs <name> [lines]` | View logs from journalctl |
| `enable <name>` | Enable a disabled task's timer |
| `disable <name>` | Disable timer (preserves config) |

### Add Options

- `--interval=<time>` - Timer interval (default: 30m). Examples: 30m, 1h, 2h, 45min
- `--args="..."` - Arguments to pass to the script
- `--working-dir=<path>` - Working directory for script execution
- `--node-path=<path>` - NODE_PATH environment variable

## Architecture

Tasks are managed as native systemd user services and timers:
- Service unit: `~/.config/systemd/user/openclaw-task-<name>.service`
- Timer unit: `~/.config/systemd/user/openclaw-task-<name>.timer`
- Metadata: `tasks.json` in this directory

## Cheap Triggers Philosophy

Scripts run locally on the host. They should only wake the main agent (via `openclaw system event`) if they detect actionable work. This keeps agent costs low while maintaining responsiveness.

## Managed Tasks

Currently managed tasks (see `tasks.json` for details):

- **supernote-sync** - Syncs Supernote files from Google Drive (45m interval)
