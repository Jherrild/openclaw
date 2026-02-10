# Task Orchestrator Skill

A lightweight, systemd-backed task scheduler for managing arbitrary scripts on a schedule WITHOUT spawning AI sub-agents unless explicitly needed.

## Quick Start

```bash
cd ~/.openclaw/workspace/skills/task-orchestrator

# Add a task (no interrupts — pure scheduler)
./orchestrator.js add my-task /path/to/script.sh --interval=30m

# Add a task with automatic interrupt handling
./orchestrator.js add my-monitor /path/to/check.sh --interval=10m \
  --interrupt="alert: Check the results and notify the user if important."

# Add a task with interrupt config from a file (editable without re-registering)
./orchestrator.js add my-sync /path/to/sync.sh --interval=5m \
  --interrupt-file=/path/to/interrupt-config.txt

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

| Flag | Description |
|------|-------------|
| `--interval=<time>` | Timer interval (default: 30m). Examples: 30m, 1h, 2h, 45min |
| `--args="..."` | Arguments to pass to the script |
| `--working-dir=<path>` | Working directory for script execution |
| `--node-path=<path>` | NODE_PATH environment variable |
| `--interrupt="level: instruction"` | Enable interrupt-on-stdout. See below. |
| `--interrupt-file=<path>` | Same, but reads config from file at trigger time. Mutually exclusive with `--interrupt`. |

## Interrupt Integration

When `--interrupt` or `--interrupt-file` is set, the orchestrator wraps the script with `interrupt-wrapper.sh`, which integrates with the [interrupt-service](../interrupt-service/SKILL.md).

### Script Contract

| Exit Code | Stdout | Result |
|-----------|--------|--------|
| 0 | Non-empty | ✅ Interrupt fired with stdout as message |
| 0 | Empty | Nothing happened — stay silent |
| Non-zero | Any | Script failed — logged, NO interrupt fired |

Scripts don't need to know about the interrupt service. They just echo their findings and exit 0. The wrapper handles the rest.

### `--interrupt` (inline)

The value is a `"level: instruction"` string. Level is `info`, `warn`, or `alert`. The instruction tells the sub-agent how to react.

```bash
orchestrator.js add supernote-sync ./check-and-sync.sh --interval=10m \
  --interrupt="alert: Read .agent-pending for the manifest. File new notes via obsidian-scribe."
```

### `--interrupt-file` (from file)

Same format, but read from a file **at trigger time** — not at registration. This means you can edit the file to change behavior without re-registering the task.

```bash
orchestrator.js add supernote-sync ./check-and-sync.sh --interval=10m \
  --interrupt-file=./supernote-interrupt.txt
```

Where `supernote-interrupt.txt` contains:
```
alert: Read .agent-pending for the manifest. File new notes via obsidian-scribe.
```

### What Magnus Says → What to Do

| Request | Command |
|---------|---------|
| "Run supernote sync every 10 minutes and tell me when it finds files" | `add supernote-sync ./check-and-sync.sh --interval=10m --interrupt="alert: ..."` |
| "Add a monitor but I want to edit the instructions later" | `add my-task ./script.sh --interval=5m --interrupt-file=./config.txt` |
| "Just run this script on a schedule, don't bother me" | `add my-task ./script.sh --interval=1h` (no --interrupt) |
| "Run supernote sync right now" | `run supernote-sync` |
| "What tasks are scheduled?" | `list` |
| "Is supernote sync working?" | `status supernote-sync` |
| "Show me the supernote sync logs" | `logs supernote-sync` |
| "Stop the supernote sync for now" | `disable supernote-sync` |
| "Turn supernote sync back on" | `enable supernote-sync` |
| "Remove the supernote sync entirely" | `remove supernote-sync` |

All commands prefixed with `node skills/task-orchestrator/orchestrator.js`.

## Architecture

Tasks are managed as native systemd user services and timers:
- Service unit: `~/.config/systemd/user/openclaw-task-<name>.service`
- Timer unit: `~/.config/systemd/user/openclaw-task-<name>.timer`
- Wrapper: `interrupt-wrapper.sh` (only when interrupt is configured)
- Metadata: `tasks.json` in this directory

## Cheap Triggers Philosophy

Scripts run locally on the host. With the interrupt integration, scripts no longer need to call `openclaw system event` directly — they just echo findings to stdout. The interrupt-service handles batching, rate limiting, and dispatch automatically.

## Files

| File | Purpose |
|------|---------|
| `orchestrator.js` | CLI for managing tasks |
| `interrupt-wrapper.sh` | Wraps scripts for interrupt integration |
| `tasks.json` | Task metadata (persisted) |
| `templates/` | systemd unit file templates |
| `prd/` | Product requirements documents |
| `SKILL.md` | This file |

## Currently Registered Tasks

| Task | Script | Interval | Interrupt |
|------|--------|----------|-----------|
| `supernote-sync` | `skills/supernote-sync/check-and-sync.sh` | 5m | `alert: Read .agent-pending for the manifest. File new notes via obsidian-scribe.` |
