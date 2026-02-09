# Interrupt Manager Refactor — Summary

## Architectural Changes

### 1. Dual-Pipeline Architecture (`interrupt-manager.js`)
The single shared batch queue has been split into **two independent pipelines**: `message` and `subagent`. Each pipeline has its own:
- **Batch queue** — triggers accumulate in separate arrays
- **Batch timer** — fires independently per pipeline
- **Rate-limit timestamps** — rolling window tracked separately
- **Circuit breaker** — one pipeline hitting its limit does not affect the other

Previously, `message` type interrupts bypassed batching and rate limits entirely (immediate fire). Now they go through their own pipeline with a shorter batch window (2s default) and higher rate limit (10/min default), giving consistent protection against storms while keeping latency low.

### 2. Settings Externalized (`interrupt-settings.json`)
All hard-coded constants (`BATCH_WINDOW_MS`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `FILE_POLL_MS`, `LOG_LIMIT`) have been moved to `interrupt-settings.json`. The InterruptManager:
- Loads settings at startup with fallback defaults
- Hot-reloads the file on changes via `fs.watchFile`
- Exposes `getSettings()` / `updateSettings(patch)` methods for programmatic access

### 3. Configuration CLI (`register-interrupt.js`)
Two new commands added:
- `get-settings` — prints current pipeline settings as JSON
- `set-settings '<json>'` — applies a JSON merge-patch to settings and writes to disk

### 4. Message Delivery Fix
**Root cause:** The `message` pipeline was using `openclaw agent --session-id <id> --message <text> --deliver`, which is not a valid openclaw CLI command. Messages never reached the main Telegram session.

**Fix:** Changed to `openclaw sessions send --session <id> --text <text>`, which is the correct command used by sub-agents and the documented API for session message delivery.

### 5. Dispatch Log Fix
The `_logDispatchResult` method referenced an undefined `LOG_FILE` variable. Fixed to construct the path inline (`dispatch.log` in the skill directory) and use `this.settings.log_limit` for trimming.

## Files Modified
- `skills/home-presence/interrupt-manager.js` — core refactor (dual pipelines, settings, delivery fix)
- `skills/home-presence/register-interrupt.js` — added get-settings/set-settings commands
- `skills/home-presence/interrupt-settings.json` — **new** configuration file
- `skills/home-presence/SKILL.md` — updated documentation for new architecture
- `skills/copilot-delegate/last-result.md` — this summary

## Files NOT Modified (no changes needed)
- `ha-bridge.js` — only creates InterruptManager and calls `evaluate()`; interface unchanged
- `manage-channel.js` — channel management is orthogonal to pipeline settings
