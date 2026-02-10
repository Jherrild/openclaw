# Interrupt Service — End-to-End Flow Narrative

## The System (3 processes)

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   ha-bridge (:7601) │────▶│ interrupt-service     │────▶│ openclaw        │
│   (HA WebSocket)    │     │ (:7600)               │     │ (system event / │
│                     │◀────│                       │     │  agent spawn)   │
│ POST /watchlist     │push │ POST /trigger         │     └─────────────────┘
│ GET  /health        │     │ POST /rules           │
└─────────────────────┘     │ GET  /rules           │
                            │ DELETE /rules/:id     │
    ┌───────────┐           │ ...                   │
    │  Magnus   │──────────▶│                       │
    │  (CLI)    │           └──────────────────────┘
    └───────────┘
```

## The Flow

### 1. Magnus registers an interrupt

```bash
node skills/interrupt-service/interrupt-cli.js add \
  --source ha.state_change \
  --condition '{"entity_id":"person.april_jane","new_state":"home"}' \
  --label "April arrived" \
  --instruction "Check presence-log.jsonl to verify she was away >30min before notifying" \
  --channel telegram
```

### 2. Interrupt service validates and pushes

- Validator checks `person.april_jane` exists in HA → ✅
- Saves rule to `interrupt-rules.json`
- Pushes updated entity list to ha-bridge (`POST 127.0.0.1:7601/watchlist`)
- ha-bridge ACKs → rule confirmed
- If ha-bridge is down → rule **rolled back**, Magnus gets `503 COLLECTOR_UNAVAILABLE`

### 3. ha-bridge starts watching immediately

- The entity `person.april_jane` is now in its watchlist
- When HA fires `state_changed` for that entity → ha-bridge POSTs to `127.0.0.1:7600/trigger`

### 4. Interrupt service matches and dispatches

- Event matched against rules → finds "April arrived"
- Rule says `action: subagent` → queued in subagent pipeline
- After 5s batch window → spawns `openclaw agent --local` with the instruction and channel
- Sub-agent checks presence log, decides whether to notify, sends Telegram message if warranted

### 5. If it's a one-off rule

- Dispatch succeeds → rule auto-deleted from `interrupt-rules.json`
- Dispatch fails → rule restored for next attempt
