# Interrupt Service

## Overview

Centralized, source-agnostic interrupt management daemon. Receives events from collectors (HA Bridge, Mail Sentinel, etc.), matches them against configurable rules, and dispatches notifications through batched, rate-limited pipelines.

**Architecture:** Client/Server model. The daemon holds state (timers, rate limits, circuit breakers) in memory. Collectors use the CLI client to send events.

## Skill Metadata

| Field       | Value                          |
|-------------|--------------------------------|
| Type        | Daemon (systemd service)       |
| Port        | 7600 (configurable)            |
| Runtime     | Node.js                        |
| Config      | `settings.json`, `interrupt-rules.json` |

## Quick Start

### Install systemd service

```bash
# Link the service file
ln -sf ~/.openclaw/workspace/skills/interrupt-service/interrupt-service.service \
       ~/.config/systemd/user/interrupt-service.service

# Enable and start
systemctl --user daemon-reload
systemctl --user enable interrupt-service
systemctl --user start interrupt-service

# Check status
systemctl --user status interrupt-service
```

### CLI Usage

```bash
# Trigger an interrupt
node skills/interrupt-service/interrupt-cli.js trigger \
  --source home-assistant \
  --data '{"entity_id":"binary_sensor.motion","state":"on"}'

# Trigger with message shorthand
node skills/interrupt-service/interrupt-cli.js trigger \
  --source system --message "Disk usage above 90%" --level warn

# Trigger a high-priority alert (routes to subagent by default)
node skills/interrupt-service/interrupt-cli.js trigger \
  --source email \
  --data '{"subject":"Server down","priority":true}' \
  --level alert

# Check service health
node skills/interrupt-service/interrupt-cli.js health

# View pipeline stats
node skills/interrupt-service/interrupt-cli.js stats

# Reload rules from disk without restart
node skills/interrupt-service/interrupt-cli.js reload
```

## HTTP API

The daemon exposes a local HTTP API on `127.0.0.1:7600`:

| Method | Path       | Description                  |
|--------|------------|------------------------------|
| POST   | `/trigger` | Submit an event              |
| GET    | `/stats`   | Pipeline statistics          |
| GET    | `/health`  | Liveness check               |
| POST   | `/reload`  | Reload rules from disk       |

### POST /trigger

```json
{
  "source": "home-assistant",
  "data": { "entity_id": "binary_sensor.motion", "state": "on" },
  "level": "info"
}
```

**Fields:**
- `source` (required): Identifier for the event source
- `data` (optional): Arbitrary event payload — matched against rule conditions
- `level` (optional): `info` | `warn` | `alert` (default: `info`)

**Behavior:**
- Events matching rules are routed to the appropriate pipeline (message or subagent)
- `warn`/`alert` level events with no matching rule get a **default action** (message for warn, subagent for alert)
- `info` level events with no matching rule are silently ignored

## Configuration

### `settings.json`

```json
{
  "port": 7600,
  "message": {
    "batch_window_ms": 2000,
    "rate_limit_max": 10,
    "rate_limit_window_ms": 60000
  },
  "subagent": {
    "batch_window_ms": 5000,
    "rate_limit_max": 4,
    "rate_limit_window_ms": 60000
  },
  "log_limit": 1000
}
```

### `interrupt-rules.json`

Array of rules. Each rule specifies:

```json
{
  "id": "rule-unique-id",
  "source": "home-assistant",
  "condition": { "entity_id": "binary_sensor.motion", "state": "on" },
  "action": "message",
  "message": "Motion detected: {{entity_id}}",
  "instruction": null,
  "channel": "telegram",
  "enabled": true
}
```

**Fields:**
- `id` (required): Unique rule identifier
- `source` (optional): Match events from this source only
- `condition` (optional): Key-value pairs matched against event data. Supports `*` wildcards.
- `action`: `message` (system event) or `subagent` (spawn analysis agent)
- `message`: Template with `{{key}}` placeholders interpolated from event data
- `instruction`: Extra context passed to sub-agent (subagent action only)
- `channel`: Notification channel for subagent delivery (default: `telegram`)
- `enabled`: Set `false` to disable without deleting (default: `true`)

## Pipelines

### Message Pipeline
- Injects events into the Main Session via `openclaw system event --mode now`
- Fast path for simple notifications
- Default batch window: 2s, rate limit: 10/min

### Subagent Pipeline
- Spawns a sub-agent via `openclaw agent --local` to analyze and decide on notification
- Used for complex events that need context/summarization
- Default batch window: 5s, rate limit: 4/min

### Circuit Breakers
Both pipelines have independent circuit breakers. When rate limit is exceeded, the circuit opens and events are dropped with a warning log until the window resets.

## Integration with Collectors

### From ha-bridge (Phase 2)
```bash
# In ha-bridge, replace internal interrupt-manager calls with:
node skills/interrupt-service/interrupt-cli.js trigger \
  --source home-assistant \
  --data "{\"entity_id\":\"$ENTITY\",\"state\":\"$STATE\"}"
```

### From mail-sentinel (Phase 4)
```bash
node skills/interrupt-service/interrupt-cli.js trigger \
  --source email \
  --data "{\"subject\":\"$SUBJECT\",\"sender\":\"$FROM\",\"priority\":true}" \
  --level alert
```

## Logs

- **stdout/stderr**: Goes to systemd journal (`journalctl --user -u interrupt-service`)
- **dispatch.log**: Detailed dispatch results (auto-rotated by `log_limit` setting)

## Files

| File                         | Purpose                              |
|------------------------------|--------------------------------------|
| `interrupt-service.js`       | Daemon (HTTP server + pipeline logic)|
| `interrupt-cli.js`           | CLI client for triggering events     |
| `interrupt-service.service`  | systemd user unit file               |
| `settings.json`              | Service configuration                |
| `interrupt-rules.json`       | Event matching rules                 |
| `dispatch.log`               | Dispatch result log (auto-generated) |
| `PRD.md`                     | Product requirements document        |
| `SKILL.md`                   | This file                            |
