# PRD: Home Presence Skill

## Overview
The `home-presence` skill grants Magnus a physical presence in Jesten's home by bridging OpenClaw's logic with Home Assistant's sensors and media players. It enables Magnus to "follow" Jesten by identifying occupied rooms and speaking through local smart speakers.

## Core Capabilities
1. **Occupancy Detection**: Query Home Assistant (via the existing `ha-stdio-final` MCP) to identify which areas have active presence (motion/occupancy sensors).
2. **Dynamic Speech Routing**: Target speech to specific rooms or all occupied rooms.
3. **TTS Integration**: Leverage the "Google AI TTS" integration in Home Assistant to generate speech.
4. **Magnus Voice**: Use the "Alnilam (Firm)" voice (Voice ID: `alnilam`) to maintain Magnus's persona.
5. **Passive Event Logging**: The HA bridge writes all presence events to a rolling JSONL log (`presence-log.jsonl`) instead of directly interrupting the agent.

## Tooling & Architecture
- **MCP**: `ha-stdio-final` (provides `GetLiveContext` and service call capabilities).
- **Service Calls**: Must be able to trigger `tts.speak` or equivalent in Home Assistant.
- **Voice Preference**: Always use `alnilam`.
- **HA Bridge**: Persistent WebSocket connection that logs state changes to `presence-log.jsonl`.

### Passive Logging Architecture (added 2026-02-08)

The HA bridge (`ha-bridge.js`) was refactored from a direct-interrupt model (every state change → `openclaw system event`) to a **passive rolling log** model:

- **All events** are appended to `presence-log.jsonl` as one JSON object per line.
- **No agent interrupts** by default — Magnus is not woken for routine presence changes.
- **High-priority wake plumbing** exists via the `WAKE_ON_ENTITIES` set (currently empty). Adding entity IDs to this set will cause those specific state changes to also fire `openclaw system event`, enabling selective agent-waking without reverting to the noisy old model.
- **Log rotation**: The file is capped at 5,000 lines; when exceeded, it is trimmed to the most recent 4,000 lines.

**Rationale:** Constant agent-waking on every occupancy toggle was noisy and consumed agent tokens for events that rarely required action. The passive log lets Magnus (or heartbeat scripts) check presence history on demand, while the wake plumbing preserves the ability to escalate critical events (e.g., person arriving home, security motion) in the future.

### Multi-Tiered Logging Architecture (added 2026-02-08)

The bridge was further refactored from hard-coded entity ID filtering to **dynamic domain/pattern-based routing** across five rolling JSONL log files:

| Tier | File | Matches |
|------|------|---------|
| `presence` | `presence-log.jsonl` | `person.*`, `binary_sensor.*occupancy`, `binary_sensor.*motion`, `binary_sensor.*presence` |
| `lighting` | `lighting-log.jsonl` | `light.*` |
| `climate` | `climate-log.jsonl` | `climate.*`, `sensor.*temperature`, `sensor.*humidity`, `sensor.*co2`, `switch.*heater`, `switch.*fan` |
| `automation` | `automation-log.jsonl` | `automation.*`, `script.*` |
| `raw` | `home-status-raw.jsonl` | Catch-all (excluding `sun.*`, `sensor.*uptime`, `sensor.*last_boot`) |

**Key design choices:**
- Regex patterns instead of hard-coded entity sets → new devices auto-categorized
- First-match tier routing → no duplicate logging
- Noisy entities excluded from catch-all to keep `home-status-raw.jsonl` useful
- All logs share the same 5,000-line cap / 4,000-line trim behavior
- Log entries include a `domain` field for easier downstream filtering

## Proposed Tools (to be implemented by Copilot)
- `locate_presence`: Returns a list of areas currently marked as occupied, plus home/away status of tracked persons.
- `announce_to_room`: Takes `text` and `area`, triggers TTS on speakers in that area.
- `follow_and_speak`: Detects occupancy and speaks only in the rooms where Jesten is present.

## Implementation Status

| Feature | Status | Notes |
|---------|--------|-------|
| `presence.js` — locate, announce, follow-and-speak, update-layout | ✅ Done | |
| `ha-bridge.js` — WebSocket subscription | ✅ Done | |
| Passive JSONL logging (replacing direct interrupts) | ✅ Done | 2026-02-08 |
| `WAKE_ON_ENTITIES` high-priority plumbing | ✅ Done (empty) | Ready to enable per-entity |
| Log rotation (5,000 line cap) | ✅ Done | Trims to 4,000 |
| Multi-tiered dynamic filtering (5 log files) | ✅ Done | 2026-02-08 |
| Intelligent Interrupt Dispatcher | ✅ Done | 2026-02-08 — batching, rate limiting, circuit breaker |
| `register-interrupt.js` CLI | ✅ Done | 2026-02-08 — add/list/remove rules |

## Implementation Notes
- Use the existing bearer token from the `ha-stdio-final` configuration for any direct API calls if the MCP tools are insufficient.
- Default voice ID: `alnilam`.
- Fallback: If no presence is detected, default to a sensible "main" area (e.g., Living Room) or ask.

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| JSONL over SQLite for presence log | Simpler, greppable, no dependencies, easy to tail |
| Line-count rotation over size-based | Predictable entry count; each JSON line is ~200-300 bytes so 5K lines ≈ 1-1.5 MB |
| `WAKE_ON_ENTITIES` as in-code Set | Avoids an extra config file for a feature that's rarely changed; easy to edit |
| Trim to 4,000 (not 5,000) on overflow | Avoids trimming on every single write after hitting the cap |
| Regex patterns over hard-coded entity sets | Auto-discovers new devices; no code changes needed when HA devices are added |
| First-match tier routing | Prevents duplicate logging; each event goes to exactly one file |
| Noisy entity exclusion in catch-all | Keeps `home-status-raw.jsonl` useful; `sun.*` and uptime sensors change constantly |

### Intelligent Interrupt Dispatcher (added 2026-02-08)

The bridge now supports an **Intelligent Interrupt Dispatcher** via `interrupt-manager.js`, allowing dynamic registration of conditional alerts without code changes:

- **Persistent interrupts** (`persistent-interrupts.json`) — fire on every match, retained indefinitely.
- **One-off interrupts** (`one-off-interrupts.json`) — fire once, then auto-removed from the JSON file.
- **Matching** — entity ID (exact or wildcard `light.*`) + optional state filter.
- **Batching** — triggers collected in a 5-second window, dispatched as a single `openclaw system event`.
- **Rate limiting** — max 4 dispatches per rolling 60-second window.
- **Circuit breaker** — suppresses firing and logs a warning when rate limit is exceeded; auto-recovers.
- **CLI** — `register-interrupt.js` for adding, listing, and removing rules (creates `.bak` before mutations).
- All activity logged to `ha-bridge.status.log`.

**Key design choices:**
- Separate module (`interrupt-manager.js`) keeps the dispatcher decoupled from WebSocket lifecycle
- `fs.watchFile` with 2-second polling for live reload of interrupt files (no restart needed)
- One-off rules removed immediately after queuing (before dispatch) to prevent duplicates
- Circuit breaker is automatic — no manual reset needed

## Decided NOT to Do

| Idea | Why Not |
|------|---------|
| External config file for wake entities | Overkill — the set is edited rarely and a code change is fine |
| SQLite presence database | Added complexity; JSONL is sufficient and greppable |
| Automatic agent-wake on all person entities | Too noisy in practice; left as opt-in via `WAKE_ON_ENTITIES` |
| Filesystem `fs.watch` for interrupt files | Unreliable on WSL/NFS; `fs.watchFile` polling is more robust |
| Configurable batch/rate parameters | Keep it simple; constants in `interrupt-manager.js` are easy to edit |

## Still TODO
- [ ] Consider a heartbeat or cron job that periodically reads `presence-log.jsonl` and summarizes presence patterns for Magnus
- [ ] Populate `WAKE_ON_ENTITIES` when specific use cases arise (e.g., security alerts)
- [ ] Add pre-built interrupt templates (e.g., security, arrival/departure) via `register-interrupt.js`

## Known Entity Names (Office Lights)

The office lighting group is `light.office`, **not** `light.office_lights`. Individual bulbs are `light.office_one`, `light.office_two`, `light.office_three`.

## Bug Fixes

| # | Date | Description | Fix |
|---|------|-------------|-----|
| 1 | 2026-02-08 | One-off interrupt for office lights used non-existent entity `light.office_lights` — never fired | Changed to `light.office` in `one-off-interrupts.json` |
| 2 | 2026-02-08 | No debug tooling to identify correct entity names from live WebSocket stream | Added SIGUSR1-triggered debug dump mode to `ha-bridge.js` — writes all entity IDs to `debug-entities.log` for 30s |

## Tasks for Copilot
1. ~~Scrutinize the `ha-stdio-final` MCP capabilities to see if `tts.speak` can be called via a generic "call service" tool (if one exists but was hidden) or if raw API calls are needed.~~ Done — raw REST API needed.
2. ~~Create a script (`presence.js` or similar) to wrap these behaviors.~~ Done.
3. ~~Define the `SKILL.md` for `home-presence`.~~ Done.
4. ~~Refactor ha-bridge.js to passive JSONL logging with high-priority wake plumbing.~~ Done (2026-02-08).
5. ~~Refactor ha-bridge.js to multi-tiered dynamic filtering with 5 rolling log files.~~ Done (2026-02-08).
