# PRD-feature-area-preference.md

## Overview
Add a priority/preference system to the `home-presence` skill to allow prioritizing specific areas for voice output (TTS) when multiple rooms are occupied.

## Requirements
1.  **Settings File:** Create `settings.json` in the skill directory to store user preferences.
    *   Initial setting: `preferred_areas` (an ordered list of area names).
2.  **Logic Update:** Refactor `follow_and_speak` in `presence.js`:
    *   Load `preferred_areas` from `settings.json`.
    *   If multiple areas are detected as occupied:
        *   Iterate through `preferred_areas` in order.
        *   The first area in the preference list that is also in the `occupied` list becomes the **exclusive** target for the announcement.
        *   If no occupied areas match the preference list, fall back to current behavior (announce in all occupied rooms).
3.  **New Tool:** Add a `set-preference` command to `presence.js`:
    *   Usage: `node presence.js set-preference "Office,Gym"`
    *   This should update the `preferred_areas` list in `settings.json`.
4.  **Graceful Failure:** If `settings.json` is missing or malformed, the script should fall back to current behavior without crashing.

## Goal
Ensure Magnus prioritizes Jesten (likely in the Office) over other occupants in the house.
