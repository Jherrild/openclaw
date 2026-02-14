---
name: copilot-daemon
description: Automated background daemon that polls GitHub issues and delegates work to Copilot CLI through a multi-stage PRD pipeline.
---

# Copilot Daemon

Automated background service that watches GitHub issues for work items and delegates them to Copilot CLI through a structured PRD → review → approval → implementation pipeline.

## Usage

```bash
# Initialize in current repo (creates labels, validates gh auth)
copilot-daemon init

# Start the daemon (polls every 15 min by default)
copilot-daemon start [--interval 15m] [--repo owner/repo]

# Check status
copilot-daemon status

# Stop
copilot-daemon stop

# One-shot: process the next ready issue and exit
copilot-daemon run-once [--repo owner/repo]
```

## Pipeline

Issues progress through stages via GitHub labels:

```
copilot:draft-prd → copilot:review-prd → copilot:ready → copilot:approved → copilot:done
                   ↑ (major issues)  ↓                  ↑ (revision)  ↓
                   └─────────────────┘                   └─────────────┘
```

See `prd/copilot-daemon.md` for full architecture.
