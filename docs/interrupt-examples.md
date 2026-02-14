# Interrupt Examples (Reference)

This file is NOT injected into context. Read on demand.

## Deleted Interrupts (for re-creation reference)

### April Jane Arrived (Original)
```json
{
  "id": "int-mlehw1k2-1qa8",
  "entity_id": "person.april_jane",
  "state": "home",
  "label": "April Jane Arrived (30m Debounce)",
  "instruction": "Only notify Jesten via Telegram if he is NOT home (person.jesten_herrild != 'home'). IMPORTANT: Before notifying, check the presence-log.jsonl to verify she has been away (not_home) for at least 30 consecutive minutes prior to this 'home' event. If she was home within the last 30 minutes, ignore this trigger.",
  "channel": "telegram"
}
```
