# HEARTBEAT.md

# Keep this file empty (or with only comments) to skip heartbeat API calls.

# Add tasks below when you want the agent to check something periodically.
- **[INBOX] Voice Note Monitor:** Check `/home/jherrild/.openclaw/voice_notes/` for new files. 
  - If found: Spawn a sub-agent to transcribe, determine PARA destination, and file via `obsidian-scribe`.
  - Move processed files to `/home/jherrild/.openclaw/voice_notes/processed/`.
- Nudge Jesten if high-priority tasks are lingering without progress.
- Maintain a list of "In Progress" tasks in memory/YYYY-MM-DD.md.
