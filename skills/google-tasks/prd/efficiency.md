# google-tasks Efficiency PRD

## Problem
SKILL.md is 2,099 chars with ~30% boilerplate. The full script path is repeated in every usage block. The Base64 example is verbose (7 lines for a 2-step operation). Task list IDs are hardcoded inline with no mention of how to discover new ones.

## Proposed Changes
1. **Define script path once** — add a variable or note at top: `TASKS=skills/google-tasks/tasks.js`. Use short form in examples: `node $TASKS add "title" <listId>`.
2. **Table-ify commands** — replace 5 separate sections with a compact command reference table: `add <title> [listId]`, `add-base64 <b64> [listId] [due]`, `list <listId>`, `lists`, `complete <taskId> <listId>`.
3. **Shorten Base64 example** — reduce to: `echo -n "Pay $100 Bill!" | base64 -w 0 | xargs -I{} node $TASKS add-base64 {} <listId>`.
4. **Move list IDs to config reference** — note that `lists` command discovers IDs dynamically. Keep the 3 known IDs but in a compact inline format: `Magnus: b2xk...`, `Personal: MDk1...`, `Work: V0ty...`.
5. **Add error handling note** — document token expiry behavior and how to re-auth.

## Expected Impact
- Current: 2,099 chars (~525 tokens)
- Target: ~1,400 chars (~350 tokens)
- Savings: ~700 chars (~175 tokens per read, ~33% reduction)

## Bugs / Errors Found
- **No error handling documented** — if the OAuth token expires or the API returns an error, Magnus has no guidance on recovery.
- **Stale list IDs risk** — hardcoded IDs will silently break if lists are renamed or deleted in Google Tasks. The `lists` command exists but isn't suggested as the primary discovery mechanism.
