# Heartbeat vs Cron Guide (Reference)

This file is NOT injected into context. Read on demand.

## Use Heartbeat When:
- Multiple checks can batch together (inbox + calendar + notifications in one turn)
- You need conversational context from recent messages
- Timing can drift slightly (every ~30 min is fine)
- You want to reduce API calls by combining periodic checks

## Use Cron When:
- Exact timing matters ("9:00 AM sharp every Monday")
- Task needs isolation from main session history
- You want a different model or thinking level
- One-shot reminders ("remind me in 20 minutes")
- Output should deliver directly to a channel without main session involvement

**Tip:** Batch similar periodic checks into `HEARTBEAT.md` instead of creating multiple cron jobs.

## Heartbeat State Tracking

Track checks in `memory/heartbeat-state.json`:
```json
{
  "lastChecks": {
    "email": 1703275200,
    "calendar": 1703260800,
    "weather": null
  }
}
```

## Memory Maintenance (During Heartbeats)

Periodically (every few days), use a heartbeat to:
1. Read recent `memory/YYYY-MM-DD.md` files
2. Identify significant events/lessons worth keeping long-term
3. Update `MEMORY.md` with distilled learnings
4. Remove outdated info from MEMORY.md

Daily files are raw notes; MEMORY.md is curated wisdom.
