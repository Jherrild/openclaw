# supernote-sync Efficiency PRD

## Problem
SKILL.md is ~5,800 chars with ~30% boilerplate. The Agent Workflow section is the most detailed in any skill doc (steps 1–5 with code blocks). Auth & Token details duplicate information from google-tasks/google-docs. Common Failure Modes and Manual Commands sections are rarely needed but always loaded. `.agent-pending` is described inconsistently.

## Proposed Changes
1. **Replace Agent Workflow prose with flow reference + tool table link** — reduce steps 1–5 to a numbered flow summary (1 line each) and reference the Tools Reference table for exact commands. The detailed code blocks in steps 2–5 repeat what's already in the table. Saves ~800 chars.
2. **Collapse Common Failure Modes into error-code lookup table** — compress the 5-row table by removing the verbose "Cause" column. Use: Symptom | Fix. Saves ~200 chars.
3. **Remove redundant Auth & Token section** — replace with: "Uses shared Google OAuth token from `google-docs`. See `google-tasks/credentials.json` for base credentials. Drive folder ID: `19NabfLOmVIvqNZmI0PJYOwSLcPUSiLkK`." Saves ~250 chars.
4. **Consolidate Manual Commands into a quick-ref box** — the 4 commands (trigger sync, clear lock, view log, check mapping) can be a compact 4-line block without the `SKILL_DIR` variable setup (already defined in Agent Workflow). Saves ~150 chars.
5. **Compress Categorization Heuristics** — the table is useful but can drop the "Justification" column. Magnus knows why meetings go to meetings. Saves ~150 chars.
6. **Remove Files table** — 15 entries of which Magnus only interacts with 6 tools. Replace with: "Agent tools: `get_new_notes.js`, `get_updated_notes.js`, `store_markdown.js`, `obsidian_migrate.js`, `mapping-utils.js`. Other files are internal."

## Expected Impact
- Current: ~5,800 chars
- Target: ~4,350 chars (~25% reduction, ~360 token savings per read)

## Bugs / Errors Found
- **`.agent-pending` inconsistent description** — the Files table calls it "JSON manifest + lockfile" (line 202), but the Agent Workflow implies it's a JSON array of file entries (consumed by `get_new_notes.js`). Should clarify: it's a JSON array manifest that also serves as a lockfile (presence = work pending). Not actually a mutex lock.
- Minor: Step 2 in Agent Workflow hardcodes the vault path — should reference the configured `vault_root` from `config.json` instead.
- Minor: `vault_update.js` is listed in Tools Reference but never referenced in any workflow step.
