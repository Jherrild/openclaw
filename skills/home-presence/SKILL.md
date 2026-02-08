---
name: home-presence
description: Give Magnus a physical presence in Jesten's home — detect occupied rooms and speak through local smart speakers using Google AI TTS with the Alnilam voice.
---

# Home Presence

Detect which rooms Jesten is in and route speech to those rooms via Home Assistant TTS.

## Configuration

- **Script Path:** `/home/jherrild/.openclaw/workspace/skills/home-presence/presence.js`
- **HA Token:** Extracted automatically from `config/mcporter.json` (`ha-stdio-final` entry).
- **TTS Engine:** `tts.google_ai_tts` (Google AI TTS)
- **Voice:** `alnilam` (Alnilam — Firm)
- **Default Fallback Area:** Living Room

### Known Areas → Speakers

| Area | Speaker Entity |
|------|---------------|
| Living Room | `media_player.living_room_speaker` |
| Basement | `media_player.basement` |
| Gym | `media_player.gym` |
| Office | `media_player.pink_window` |
| Bedroom | `media_player.upstairs_bedroom` |
| Kitchen | `media_player.living_room_speaker` (fallback) |
| Dining | `media_player.living_room_speaker` (fallback) |
| Home Group | `media_player.home_group` (all speakers) |

### Presence Sensors

| Area | Sensor | Type |
|------|--------|------|
| Kitchen | `binary_sensor.everything_presence_lite_5c0db4_occupancy` | mmWave Occupancy |
| Office | `binary_sensor.everything_presence_lite_4f1008_occupancy` | mmWave Occupancy |
| Gym | `binary_sensor.everything_presence_lite_5c0d08_occupancy` | mmWave Occupancy |
| Bedroom | `binary_sensor.everything_presence_lite_5c0da4_occupancy` | mmWave Occupancy |
| Basement | `binary_sensor.everything_presence_lite_ab20a4_occupancy` | mmWave Occupancy |
| Front Yard | `binary_sensor.front_door_motion` | PIR Motion |
| Kitchen | `sensor.everything_presence_lite_5c0db4_co2` | CO₂ fallback (>600 ppm) |
| Office | `sensor.everything_presence_lite_4f1008_co2` | CO₂ fallback (>600 ppm) |
| Gym | `sensor.everything_presence_lite_5c0d08_co2` | CO₂ fallback (>600 ppm) |

## Tools

### locate_jesten

Detect which areas are currently occupied based on motion sensors and CO₂ levels.

**Usage:**
```bash
node /home/jherrild/.openclaw/workspace/skills/home-presence/presence.js locate
```

**Output:** JSON with `occupied` (list of area names), `details` (sensor data), and `fallback` (set to "Living Room" if no presence detected).

### announce_to_room

Speak a message through the speaker(s) in a specific area.

**Parameters:**
- `area`: Area name (e.g., "Living Room", "Office", "Gym").
- `message`: The text to speak.

**Usage:**
```bash
node /home/jherrild/.openclaw/workspace/skills/home-presence/presence.js announce "Office" "Jesten, your coffee is ready."
```

### follow_and_speak

Detect where Jesten is and speak in all occupied rooms. If no presence is detected, falls back to Living Room.

**Priority Routing:** When the `--priority` flag is passed, the message is treated as important/high-priority and is routed to the **Home Group** (`media_player.home_group`), which targets all speakers simultaneously — bypassing per-room presence detection.

**Routing Rules:**
1. `--priority` flag → Home Group (all speakers)
2. Presence detected → occupied room speakers only
3. No presence detected → Living Room speaker (default fallback)

**Parameters:**
- `message`: The text to speak.
- `--priority` *(optional)*: Route to all speakers via Home Group.

**Usage:**
```bash
node /home/jherrild/.openclaw/workspace/skills/home-presence/presence.js follow-and-speak "Good morning, Jesten."
node /home/jherrild/.openclaw/workspace/skills/home-presence/presence.js follow-and-speak --priority "Emergency: water leak detected!"
```

**Output:** JSON showing which areas were occupied, which speakers were targeted, and the result of each TTS call.

## Technical Notes

- The `ha-stdio-final` MCP provides `GetLiveContext` for reading sensor state but has **no generic `call_service` tool**, so TTS is triggered via the Home Assistant REST API (`POST /api/services/tts/speak`).
- CO₂ levels above 600 ppm are used as a secondary occupancy indicator (works well for enclosed rooms like Office, Kitchen, Gym).
- The script deduplicates speakers when multiple occupied areas map to the same physical speaker (e.g., Kitchen and Dining both route to Living Room speaker).
