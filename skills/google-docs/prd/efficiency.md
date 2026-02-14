# google-docs Efficiency PRD

## Problem
SKILL.md is 1,215 chars with NODE_PATH export duplicated verbatim 4 times (once per command), inflating the file by ~40%. No output format examples or error handling documented, so Magnus may need multiple attempts to interpret results.

## Proposed Changes
1. **Define NODE_PATH once** — add a Setup/Environment section at top: `export NODE_PATH=$NODE_PATH:/home/jherrild/.openclaw/workspace/skills/google-tasks/node_modules`. Then use short commands: `node scripts/docs.js search "query"`.
2. **Consolidate commands into a table** — replace 4 separate bash blocks with a single usage table: `search <query>`, `get <doc_id>`, `create <title>`, `append <doc_id> <text>`.
3. **Add brief output format notes** — e.g., "search returns JSON array of `{id, title}`; get returns plain text."
4. **Add error handling note** — document common failures (expired token, doc not found).

## Expected Impact
- Current: 1,215 chars (~300 tokens)
- Target: ~700 chars (~175 tokens)
- Savings: ~515 chars (~125 tokens per read, ~42% reduction)

## Bugs / Errors Found
- **Brittle NODE_PATH**: Hardcoded dependency on `skills/google-tasks/node_modules`. If google-tasks is reorganized or its node_modules are cleaned, google-docs silently breaks. Consider a shared `node_modules/` or a symlink.
- **No token refresh docs**: If `scripts/token.json` expires, there's no documented recovery process.
