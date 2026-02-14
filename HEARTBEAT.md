# HEARTBEAT.md

# Keep this file empty (or with only comments) to skip heartbeat API calls.

# Add tasks below when you want the agent to check something periodically.
#
- **[INBOX] Voice Note Monitor:** Check `/home/jherrild/.openclaw/voice_notes/` for new files. 
  - If found: Spawn a sub-agent to transcribe, determine PARA destination, and file via `obsidian-scribe`.
  - Move processed files to `/home/jherrild/.openclaw/voice_notes/processed/`.
- **[SERVICE] HA Bridge Health:** Run `systemctl --user is-active ha-bridge.service` to confirm it's running. If inactive, restart with `systemctl --user restart ha-bridge.service`. Check `tail -5 skills/home-presence/ha-bridge.status.log` for recent errors.
- **[FOLLOW-UP] Winterization & Bathroom:** 
  - Ask Jesten: "Have you dealt with winterizing the pipes yet?"
  - Harass Jesten about ordering all components Jim needs for the bathroom (Medicine cabinet, fan, etc.).
- **[FOLLOW-UP] Art Room:** Check in with Jesten about "Fix the wiring to the art room thermostat".
- Nudge Jesten if high-priority tasks are lingering without progress.
- Maintain a list of "In Progress" tasks in memory/YYYY-MM-DD.md.
