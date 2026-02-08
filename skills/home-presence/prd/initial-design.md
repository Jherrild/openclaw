# PRD: Home Presence Skill

## Overview
The `home-presence` skill grants Magnus a physical presence in Jesten's home by bridging OpenClaw's logic with Home Assistant's sensors and media players. It enables Magnus to "follow" Jesten by identifying occupied rooms and speaking through local smart speakers.

## Core Capabilities
1. **Occupancy Detection**: Query Home Assistant (via the existing `ha-stdio-final` MCP) to identify which areas have active presence (motion/occupancy sensors).
2. **Dynamic Speech Routing**: Target speech to specific rooms or all occupied rooms.
3. **TTS Integration**: Leverage the "Google AI TTS" integration in Home Assistant to generate speech.
4. **Magnus Voice**: Use the "Alnilam (Firm)" voice (Voice ID: `alnilam`) to maintain Magnus's persona.

## Tooling & Architecture
- **MCP**: `ha-stdio-final` (provides `GetLiveContext` and service call capabilities).
- **Service Calls**: Must be able to trigger `tts.speak` or equivalent in Home Assistant.
- **Voice Preference**: Always use `alnilam`.

## Proposed Tools (to be implemented by Copilot)
- `locate_presence`: Returns a list of areas currently marked as occupied, plus home/away status of tracked persons.
- `announce_to_room`: Takes `text` and `area`, triggers TTS on speakers in that area.
- `follow_and_speak`: Detects occupancy and speaks only in the rooms where Jesten is present.

## Implementation Notes
- Use the existing bearer token from the `ha-stdio-final` configuration for any direct API calls if the MCP tools are insufficient.
- Default voice ID: `alnilam`.
- Fallback: If no presence is detected, default to a sensible "main" area (e.g., Living Room) or ask.

## Tasks for Copilot
1. Scrutinize the `ha-stdio-final` MCP capabilities to see if `tts.speak` can be called via a generic "call service" tool (if one exists but was hidden) or if raw API calls are needed.
2. Create a script (`presence.js` or similar) to wrap these behaviors.
3. Define the `SKILL.md` for `home-presence`.
