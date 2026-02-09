# Interrupt Manager — Dispatch Reliability Fix

## Date: 2026-02-09

## Issues Fixed

### 1. One-Off Interrupts Lost on Dispatch Failure
**Problem:** One-off interrupts were removed from `one-off-interrupts.json` immediately upon matching, before dispatch. If the sub-agent spawn or message send failed, the trigger was permanently lost.

**Fix:** Introduced a `_pending` state. Matched one-offs are marked `_pending: true` (preventing re-triggering) but remain in the file. They are only removed (`_finalizeOneOffs`) after the entire batch dispatches successfully. On failure, `_restoreOneOffs` clears the `_pending` flag so the trigger can fire again on the next matching event.

### 2. Invalid CLI Commands (`sessions spawn`, `sessions send`)
**Problem:** The dispatch methods used non-existent `openclaw sessions spawn` and `openclaw sessions send` subcommands. The `sessions` command only lists sessions — it has no `spawn` or `send` subcommands. This caused every dispatch to exit with code 1.

**Fix:**
- **Subagent pipeline:** Changed from `openclaw sessions spawn --model gemini-flash-1.5 --prompt <p> --quiet` to `openclaw agent --local --message <prompt>`, which is the correct CLI for running a local embedded agent turn. Added a 120s timeout.
- **Message pipeline:** Changed from `openclaw sessions send --session <id> --text <text>` to `openclaw message send --channel <channel> --message <text>`, which is the actual message delivery command.

### 3. Session ID Resolution
**Problem:** `_getMainSessionId` called `openclaw sessions list --kinds main --limit 1 --json`, which doesn't exist as a subcommand.

**Fix:** Changed to `openclaw sessions --json` (the actual command) and parses the output to find the session with `key === 'agent:main:main'`. Returns `null` if not found (with a warning log), so callers can fall back gracefully.

### 4. Improved Error Logging
- All dispatch methods now log the exact command being run and stderr output on failure.
- Subagent dispatch logs whether the process was killed (timeout/signal).
- One-off lifecycle transitions are logged (pending → consumed / pending → restored).

## Files Modified
- `skills/home-presence/interrupt-manager.js` — all fixes above
- `skills/copilot-delegate/last-result.md` — this summary
