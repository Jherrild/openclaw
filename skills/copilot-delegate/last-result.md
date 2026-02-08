## home-presence Refactor Summary (2026-02-08)

### Changes Made

**1. Renamed `locate_jesten` → `locate_presence`**
The tool is now person-agnostic. The CLI command remains `locate`, but SKILL.md and documentation reference `locate_presence`. The function checks all tracked person entities rather than being named for a single user.

**2. Person-aware occupancy logic**
`locate` now checks `person.jesten` and `person.april_jane` via the HA REST API as its **first step**. The new occupancy priority chain:
1. Person entities (home/away from HA device tracker)
2. mmWave occupancy sensors (primary room-level)
3. PIR motion sensors (secondary)
4. CO₂ levels >600 ppm (tertiary)

If **both** persons are `away` AND no mmWave/CO₂/motion sensor detects presence, the result includes `houseEmpty: true`. `follow-and-speak` skips TTS entirely when the house is empty (no wasted speaker activations). If persons are home but no room-level sensor fires, it falls back to the Living Room.

**3. Dynamic layout via `update_layout` tool**
Instead of only hardcoded area→speaker/sensor mappings, the script now supports a `layout.json` file:
- **`update-layout` CLI command**: Queries HA's template API (`areas()`, `area_entities()`) and `/api/states` to discover all areas, media players, occupancy sensors, motion sensors, and CO₂ sensors. Writes `layout.json` next to `presence.js`.
- **Startup behavior**: `presence.js` loads `layout.json` if present; otherwise falls back to the original hardcoded defaults. This means zero breakage — existing setups work unchanged.
- **Durability**: When new hardware is added to HA areas, Magnus can run `update-layout` to refresh the mapping without code changes.

### Architecture Choice
A hybrid approach was chosen: hardcoded defaults for reliability, with an opt-in dynamic layout refresh. Full dynamic discovery on every `locate` call was rejected because (a) the HA template API requires one call per area, adding latency, and (b) area→entity mappings change rarely. The `update-layout` tool strikes the right balance for a growing smart home.

### New Output Fields
- `houseEmpty` (bool): true when all persons are away and no sensor presence.
- `personsHome` (bool): true when at least one tracked person is home.
- `layoutSource` (string): `"layout.json"` or `"hardcoded-defaults"` — indicates which mapping is active.
