---
name: interrupt-service
description: Centralized event orchestration daemon. Matches events from collectors (HA, email, system) against rules and dispatches via batched, rate-limited pipelines.
---

# Interrupt Service

## Overview

Centralized, source-agnostic interrupt management daemon. Receives events from collectors (HA Bridge, Mail Sentinel, etc.), matches them against configurable rules, and dispatches notifications through batched, rate-limited pipelines.

**Architecture:** Client/Server model. The daemon holds state (timers, rate limits, circuit breakers) in memory. Collectors and Magnus use the CLI client to manage rules and send events. Rules are persisted to disk and hot-reloaded on change.

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

## CLI Reference

The CLI (`interrupt-cli.js`) is the primary interface for Magnus and collectors.

### Commands

| Command          | Description                              |
|------------------|------------------------------------------|
| `add`            | Add or update a rule                     |
| `remove <id>`   | Remove a rule by ID                      |
| `list`           | List all rules                           |
| `trigger`        | Fire an event into the pipeline          |
| `settings get`   | Show current settings                    |
| `settings set`   | Update settings (JSON merge patch)       |
| `stats`          | Pipeline statistics                      |
| `health`         | Liveness check                           |
| `reload`         | Reload rules from disk without restart   |

### `add` — Add/Update a Rule

```bash
node skills/interrupt-service/interrupt-cli.js add [options]
```

| Flag                 | Required | Default     | Description                                     |
|----------------------|----------|-------------|-------------------------------------------------|
| `--source <src>`     | yes      | —           | Event source (e.g. `ha.state_change`, `email`)  |
| `--condition <json>` | no       | —           | JSON match criteria against event data           |
| `--action <type>`    | no       | `subagent`  | `message` or `subagent`                          |
| `--label <text>`     | no       | —           | Human-readable rule name                         |
| `--message <text>`   | no       | —           | Template with `{{key}}` interpolation            |
| `--instruction <text>`| no      | —           | Custom instructions for sub-agent                |
| `--channel <name>`   | no       | `"default"` | Notification channel                             |
| `--session-id <id>`  | no       | `"main"`    | Target session for subagent dispatch             |
| `--one-off`          | no       | `false`     | Auto-remove rule after first match               |
| `--id <id>`          | no       | auto-gen    | Explicit rule ID (update if exists)              |
| `--skip-validation`  | no       | `false`     | Bypass server-side validator                     |

### `trigger` — Fire an Event

```bash
node skills/interrupt-service/interrupt-cli.js trigger [options]
```

| Flag              | Required | Default | Description                              |
|-------------------|----------|---------|------------------------------------------|
| `--source <src>`  | yes      | —       | Event source identifier                  |
| `--data <json>`   | no       | —       | Arbitrary event payload JSON             |
| `--message <text>`| no       | —       | Shorthand — sets `data.message`          |
| `--level <lvl>`   | no       | `info`  | `info`, `warn`, or `alert`               |

### CLI Examples

```bash
# Add a persistent HA interrupt with instructions
node skills/interrupt-service/interrupt-cli.js add \
  --source ha.state_change \
  --condition '{"entity_id":"binary_sensor.front_door_motion","state":"on"}' \
  --label "Front door motion" \
  --instruction "Check if anyone is expected; announce security alert if not"

# Add a one-off interrupt (auto-removed after first match)
node skills/interrupt-service/interrupt-cli.js add \
  --source ha.state_change \
  --condition '{"entity_id":"person.jesten","state":"home"}' \
  --label "Jesten arrived" --one-off

# Add a direct message interrupt (no sub-agent)
node skills/interrupt-service/interrupt-cli.js add \
  --source ha.state_change \
  --condition '{"entity_id":"magnus.voice_command"}' \
  --action message --message "{{new_state}}" --label "Voice"

# Trigger from collector
node skills/interrupt-service/interrupt-cli.js trigger \
  --source ha.state_change \
  --data '{"entity_id":"binary_sensor.motion","new_state":"on"}'

# System alert
node skills/interrupt-service/interrupt-cli.js trigger \
  --source system --message "Disk usage above 90%" --level warn

# List / remove
node skills/interrupt-service/interrupt-cli.js list
node skills/interrupt-service/interrupt-cli.js remove rule-abc123

# Settings
node skills/interrupt-service/interrupt-cli.js settings get
node skills/interrupt-service/interrupt-cli.js settings set '{"message":{"batch_window_ms":1000}}'

# Status
node skills/interrupt-service/interrupt-cli.js stats
node skills/interrupt-service/interrupt-cli.js health
node skills/interrupt-service/interrupt-cli.js reload
```

## HTTP API

The daemon exposes a local HTTP API on `127.0.0.1:7600`:

| Method | Path                | Description                  |
|--------|---------------------|------------------------------|
| POST   | `/trigger`          | Submit an event              |
| POST   | `/rules`            | Add/update a rule (validated)|
| DELETE  | `/rules/:id`       | Remove a rule                |
| GET    | `/rules`            | List all rules               |
| GET    | `/rules/ha-entities`| HA entity watchlist          |
| GET    | `/stats`            | Pipeline statistics          |
| GET    | `/health`           | Liveness check               |
| POST   | `/reload`           | Reload rules from disk       |
| GET    | `/settings`         | Get settings                 |
| PUT    | `/settings`         | Update settings              |

### POST /trigger

```json
{
  "source": "ha.state_change",
  "data": { "entity_id": "binary_sensor.motion", "new_state": "on" },
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

### POST /rules

```json
{
  "source": "ha.state_change",
  "condition": { "entity_id": "binary_sensor.motion", "new_state": "on" },
  "action": "subagent",
  "label": "Motion alert",
  "instruction": "Check camera feed and notify if unexpected",
  "channel": "telegram",
  "session_id": "main",
  "one_off": false
}
```

Returns the created/updated rule with its assigned `id`. If `--skip-validation` is not set, the rule is validated against the source's validator (if configured).

### GET /rules/ha-entities

Returns a flat list of `entity_id` values extracted from all `ha.state_change` rules. Used by ha-bridge to know which entities to watch.

### PUT /settings

Accepts a JSON merge patch. Only supplied keys are updated; others are preserved.

```json
{ "message": { "batch_window_ms": 1000 } }
```

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
  "log_limit": 1000,
  "file_poll_ms": 2000,
  "default_channel": "telegram",
  "validators": {
    "ha.state_change": "/home/jherrild/.openclaw/workspace/skills/home-presence/validate-entity.js"
  },
  "collectors": {
    "ha.state_change": "http://127.0.0.1:7601"
  }
}
```

| Key                              | Default     | Description                                        |
|----------------------------------|-------------|----------------------------------------------------|
| `port`                           | `7600`      | HTTP listen port                                   |
| `message.batch_window_ms`       | `2000`      | Message pipeline batch window (ms)                 |
| `message.rate_limit_max`        | `10`        | Max messages per rate window                       |
| `message.rate_limit_window_ms`  | `60000`     | Rate limit window (ms)                             |
| `subagent.batch_window_ms`      | `5000`      | Subagent pipeline batch window (ms)                |
| `subagent.rate_limit_max`       | `4`         | Max subagent dispatches per rate window            |
| `subagent.rate_limit_window_ms` | `60000`     | Rate limit window (ms)                             |
| `log_limit`                      | `1000`      | Max entries in dispatch.log before rotation        |
| `file_poll_ms`                   | `2000`      | Interval to poll rules file for hot reload (ms)    |
| `default_channel`                | `"telegram"`| Default notification channel for new rules         |
| `validators`                     | `{}`        | Map of `source` → validator script path            |
| `collectors`                     | `{}`        | Map of `source` → collector HTTP base URL          |

### Validators

Validators are external scripts invoked when a rule is added via `POST /rules`. The daemon calls the validator for the rule's `source` (if configured) and rejects the rule if validation fails.

**Validation skips:**
- `--skip-validation` flag on CLI bypasses all checks
- Wildcard patterns (e.g., `light.*`) in `condition.entity_id` skip entity existence checks
- Virtual entities with `magnus.*` prefix skip existence checks
- Sources with no configured validator are always accepted

### Collectors (Push Notification)

When a rule is added or removed for a source that has a registered collector, the interrupt service **pushes** the updated watchlist to the collector immediately. If the collector is unreachable, rule registration **fails** with `503 COLLECTOR_UNAVAILABLE`.

**Behavior on rule add:** Push to collector → collector ACKs → rule saved. If collector is down → rule is **rolled back**, error returned.

**Behavior on rule remove:** Rule deleted → push attempted → if push fails, deletion stands but response includes a `warning`.

**Behavior on reload:** Push to all configured collectors (best-effort, failures logged).

Collectors must expose `POST /watchlist` accepting `{ "entities": [...] }` and returning `200`. The ha-bridge implements this on port 7601.

```bash
# Check ha-bridge watchlist status
curl http://127.0.0.1:7601/health
# → {"status":"ok","watchlist_size":2}
```

### `interrupt-rules.json`

Array of rules. Each rule specifies:

```json
{
  "id": "rule-front-door-motion",
  "source": "ha.state_change",
  "condition": { "entity_id": "binary_sensor.front_door_motion", "state": "on" },
  "action": "subagent",
  "label": "Front door motion",
  "message": null,
  "instruction": "Check if anyone is expected; announce security alert if not",
  "channel": "telegram",
  "session_id": "main",
  "one_off": false,
  "enabled": true,
  "created": "2025-01-15T10:00:00.000Z"
}
```

**Fields:**

| Field         | Required | Default      | Description                                              |
|---------------|----------|--------------|----------------------------------------------------------|
| `id`          | yes      | auto-gen     | Unique rule identifier                                   |
| `source`      | no       | —            | Match events from this source only                       |
| `condition`   | no       | —            | Key-value pairs matched against event data (`*` wildcards)|
| `action`      | no       | `subagent`   | `message` (system event) or `subagent` (spawn agent)     |
| `label`       | no       | —            | Human-readable name for the rule                         |
| `message`     | no       | —            | Template with `{{key}}` interpolation from event data    |
| `instruction` | no       | —            | Custom instructions passed to sub-agent                  |
| `channel`     | no       | `"default"`  | Notification channel for delivery                        |
| `session_id`  | no       | `"main"`     | Target session for subagent dispatch                     |
| `one_off`     | no       | `false`      | Auto-remove rule after first match                       |
| `enabled`     | no       | `true`       | Set `false` to disable without deleting                  |
| `created`     | auto     | now          | ISO timestamp of rule creation                           |

## Pipelines

### Message Pipeline
- Injects events into the Main Session via `openclaw system event --mode now`
- Fast path for simple notifications
- Default batch window: 2s, rate limit: 10/min

### Subagent Pipeline
- Spawns a sub-agent via `openclaw agent --local` to analyze and decide on notification
- Used for complex events that need context/summarization
- Batched events are grouped by `channel` + `session_id` — one subagent per group
- Default batch window: 5s, rate limit: 4/min

### One-Off Lifecycle
Rules with `one_off: true` are automatically removed from `interrupt-rules.json` after their first **successful** dispatch. If dispatch fails (e.g., openclaw gateway is down), the rule is **restored** so it can re-trigger later. This prevents losing one-off rules due to transient failures.

### Circuit Breakers
Both pipelines have independent circuit breakers. When rate limit is exceeded, the circuit opens and events are dropped with a warning log until the window resets.

### Hot Reload
The daemon polls `interrupt-rules.json` every `file_poll_ms` milliseconds. When the file changes on disk (e.g. manual edit or external tool), rules are reloaded automatically without a restart. You can also force an immediate reload via `POST /reload` or `interrupt-cli.js reload`.

## Integration with Collectors

### From ha-bridge
```bash
# ha-bridge calls trigger when a watched entity changes state:
node skills/interrupt-service/interrupt-cli.js trigger \
  --source ha.state_change \
  --data "{\"entity_id\":\"$ENTITY\",\"new_state\":\"$STATE\",\"old_state\":\"$OLD\"}"
```

ha-bridge fetches its watchlist from `GET /rules/ha-entities` to know which HA entities to subscribe to.

### From mail-sentinel
```bash
node skills/interrupt-service/interrupt-cli.js trigger \
  --source email \
  --data "{\"subject\":\"$SUBJECT\",\"sender\":\"$FROM\",\"priority\":true}" \
  --level alert
```

### From Magnus (ad-hoc)
Magnus can dynamically add rules at runtime:
```bash
# "Watch for Jesten to get home and tell me"
node skills/interrupt-service/interrupt-cli.js add \
  --source ha.state_change \
  --condition '{"entity_id":"person.jesten","state":"home"}' \
  --label "Jesten arrived" --one-off
```

## Quick Reference: What Magnus Says → What to Run

| User Request | Command |
|-------------|---------|
| "Watch for April to get home" | `add --source ha.state_change --condition '{"entity_id":"person.april_jane","new_state":"home"}' --label "April arrived" --one-off` |
| "Alert me on front door motion (permanently)" | `add --source ha.state_change --condition '{"entity_id":"binary_sensor.front_door_motion","new_state":"on"}' --label "Front door motion"` |
| "What interrupts are active?" | `list` |
| "Stop watching for April" | `remove <rule-id>` |
| "Is the interrupt system healthy?" | `health` (+ `curl 127.0.0.1:7601/health` for ha-bridge) |
| "Something broke, run the tests" | `node skills/interrupt-service/test-integration.js` |

All commands prefixed with `node skills/interrupt-service/interrupt-cli.js`.

## Testing

Run the integration test suite to verify the service is working correctly. The daemon must be running.

```bash
node skills/interrupt-service/test-integration.js
```

Tests cover: health, settings, stats, rule CRUD, trigger matching, one-off lifecycle (including restore on failed dispatch), default actions by level, skip-validation, HA entity watchlist, reload, settings update, collector push to ha-bridge, and no-collector source handling. All 20 tests should pass. Run this after any code change to the daemon or CLI.

## Logs

- **stdout/stderr**: Goes to systemd journal (`journalctl --user -u interrupt-service`)
- **dispatch.log**: Detailed dispatch results (auto-rotated by `log_limit` setting)

## Files

| File                         | Purpose                              |
|------------------------------|--------------------------------------|
| `interrupt-service.js`       | Daemon (HTTP server + pipeline logic)|
| `interrupt-cli.js`           | CLI client (add/remove/trigger/etc.) |
| `interrupt-service.service`  | systemd user unit file               |
| `settings.json`              | Service configuration                |
| `interrupt-rules.json`       | Event matching rules                 |
| `dispatch.log`               | Dispatch result log (auto-generated) |
| `test-integration.js`        | Integration test suite (20 tests)    |
| `FLOW_NARRATIVE.md`          | End-to-end flow explanation           |
| `PRD.md`                     | Product requirements document        |
| `SKILL.md`                   | This file                            |
