# home-presence Efficiency PRD

## Problem
SKILL.md is 13,958 chars (~3,500 tokens) — the largest skill file. The HA WebSocket Bridge section (lines 141–308) accounts for ~60% of the file and is operational reference material that Magnus rarely needs when invoking presence commands. Entity tables, log-checking commands, and debug instructions add bulk. Every read costs ~3,500 tokens.

## Proposed Changes
1. **Extract HA WebSocket Bridge to `docs/ha-bridge-reference.md`** — move everything from "## HA WebSocket Bridge" through "### Event Format" (~8,500 chars) to a separate reference doc. Replace with a 2-line summary: "ha-bridge.js runs as systemd service, logs HA state changes to tiered JSONL files, and forwards watched entities to interrupt-service. See `docs/ha-bridge-reference.md`."
2. **Consolidate Known Areas + Presence Sensors into one table** — merge the two tables (lines 27–53) into a single "Area → Speaker → Sensor" table, eliminating duplicate area column and headers.
3. **Collapse log-checking commands** — replace 6 separate bash blocks (lines 223–241) with a single template: `tail -20 skills/home-presence/<tier>-log.jsonl` where tier ∈ {presence, lighting, climate, automation, home-status-raw}.
4. **Remove Known Light Entities table** — the office light entities (lines 288–299) are debug artifacts. Move to ha-bridge reference or delete.
5. **Compress routing rules** — the 5-item routing priority list (lines 96–100) can be a compact decision tree: `--priority → all speakers | house empty → skip | occupied rooms → preferred_areas first | fallback → Living Room`.
6. **Shorten Technical Notes** — remove the explanatory notes about REST API vs MCP, CO₂ thresholds, and deduplication logic (lines 306–314). These are implementation details, not usage instructions.

## Expected Impact
- Current: 13,958 chars (~3,500 tokens)
- Target: ~5,500 chars (~1,375 tokens)
- Savings: ~8,400 chars (~2,100 tokens per read, ~60% reduction)
- **This is the single biggest token savings opportunity across all skills.**

## Bugs / Errors Found
- **"no light.office_lights" note (line 299)** — this negative-knowledge note suggests Magnus previously hallucinated this entity. After compression, keep a single-line warning if needed, but it shouldn't be a full table.
- **Stale sensor IDs** — the hardcoded sensor entity IDs (e.g., `binary_sensor.everything_presence_lite_5c0db4_occupancy`) will break if devices are re-provisioned. The `update-layout` command exists to regenerate these, but the SKILL.md doesn't flag the staleness risk.
- **Duplicate speaker mappings** — Kitchen and Dining both map to Living Room speaker, which is documented but could confuse Magnus into announcing twice. The deduplication logic is only mentioned in Technical Notes, not in the routing rules.
