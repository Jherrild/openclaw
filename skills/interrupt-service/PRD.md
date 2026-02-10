# Interrupt Service - Product Requirements Document (PRD)

## 1. Vision

A centralized, source-agnostic service for managing asynchronous "interrupts" that need to wake the agent or notify the user. It decouples **Event Detection** (HA, Email, RSS) from **Notification Delivery** (System Event, Telegram, Sub-agent).

It standardizes how background scripts inject context into the Main Session.

## 2. Core Components

### A. The Trigger (`trigger.js`)
- **CLI Interface:** `trigger.js --source <src> --data <json> --level <info|warn|alert>`
- **API Interface:** `InterruptService.emit(source, data)`
- **Role:** Accepting raw events from any collector (HA Bridge, Mail Sentinel, etc.).

### B. The Manager (`manager.js`)
- **Role:**
  1.  **Rule Matching:** Matches incoming events against configured `interrupt-rules.json`.
      - Supports source-specific logic (e.g. `source: "email"` -> match `topic`).
  2.  **Pipeline Routing:**
      - **Message Pipeline:** Direct injection into Main Session (via `openclaw system event`).
      - **Subagent Pipeline:** Spawn a sub-agent to analyze/summarize before injecting.
  3.  **Governance:**
      - **Batching:** Group multiple similar events (e.g. 5 emails in 1 minute -> 1 summary).
      - **Rate Limiting:** Prevent spam (Circuit Breaker).

### C. Configuration (`interrupt-rules.json`)
- Defines how events map to actions.
- **Structure:**
  ```json
  [
    {
      "id": "rule-ha-motion",
      "source": "home-assistant",
      "condition": { "entity_id": "binary_sensor.front_door_motion", "state": "on" },
      "action": "message",
      "message": "Motion at front door"
    },
    {
      "id": "rule-email-priority",
      "source": "email",
      "condition": { "priority": true },
      "action": "subagent", // let sub-agent summarize the email content
      "instruction": "Summarize the email and decide if urgent."
    }
  ]
  ```

## 3. Migration Plan
- **Phase 1:** Build `interrupt-service` as a standalone skill.
- **Phase 2:** Update `ha-bridge` (Home Presence) to call `interrupt-service` instead of using its internal `interrupt-manager.js`.
- **Phase 3:** Integrate `mail-sentinel` (Email Monitor) to use `interrupt-service`.

## 4. Challenges & Solutions (Analysis from `ha-bridge`)

### Challenge 1: Tight Coupling to Home Assistant
The current `interrupt-manager.js` is hardcoded to parse HA `state_changed` events (`entity_id`, `old_state`, `new_state`). A generic service must handle arbitrary data structures (e.g., email subjects, RSS feeds).

**Solution:**
- **Generalized Input:** Replace `evaluate(entityId...)` with `trigger(source, eventData)`.
- **Pluggable Matchers:** Implement a switch in `_matches(rule, eventData)`:
  - If `rule.source === 'home-assistant'`, check `eventData.entity_id` & `state`.
  - If `rule.source === 'email'`, check `eventData.topic` or `eventData.sender`.
  - If `rule.source === 'system'`, check `eventData.metric` (e.g., CPU load).

### Challenge 2: State Management (Circuit Breakers & Batching)
The existing manager handles stateful logic (rate limits, timers, one-off pending flags) in-memory. Moving this to a CLI tool (`trigger.js`) would lose state between calls.

**Solution:**
- **Daemon Architecture:** The `interrupt-service` must run as a persistent **systemd service** (`interrupt-service.service`), not just a CLI script.
- **Client/Server Model:**
  - **Server:** The persistent daemon holding the state (timers, rate limits).
  - **Client (`trigger.js`):** A lightweight CLI that sends events to the daemon (via HTTP local server or named pipe).
- **Benefit:** Centralized rate limiting across *all* sources (e.g., stopping an email flood *and* a sensor flood simultaneously if global limits are set).

### Challenge 3: Configuration Complexity
Managing complex matching logic (Regex, numeric ranges) in a JSON file can be error-prone.

**Solution:**
- **Simple Conditions:** Keep the JSON rules simple (exact match or simple wildcard).
- **Delegate Complexity:** For complex logic (e.g., "Email subject matches regex X AND body contains Y"), move that logic to the **Source Script** (e.g., `mail-sentinel`). The source script should only trigger the interrupt service when a meaningful event has *already* been detected. The service then handles routing/delivery.

## 5. Technical Stack
- **Runtime:** Node.js.
- **Storage:** JSON (`interrupt-rules.json`, `settings.json`).
- **Delivery:** `openclaw system event` (Mode: Now).
