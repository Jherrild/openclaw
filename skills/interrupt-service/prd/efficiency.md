# interrupt-service Efficiency PRD

## Problem
SKILL.md is 18,328 chars (~4,580 tokens) — the second largest skill file. The CLI Reference and HTTP API sections describe identical operations in two formats (CLI flags + HTTP endpoints), effectively doubling the interface documentation. The settings.json example and fields table are verbose. Pipeline details and collector integration are operational reference Magnus rarely needs per-read.

## Proposed Changes
1. **Merge CLI + HTTP API into single "Interface" section** — create a unified table: `add (POST /rules)`, `remove (DELETE /rules/:id)`, `trigger (POST /trigger)`, etc. Show CLI syntax as primary, HTTP as parenthetical. Eliminates ~3,000 chars of duplication.
2. **Table-ify Quick Reference** — the "What Magnus Says → What to Run" table (lines 365–375) is good but redundant with CLI Examples (lines 93–135). Keep Quick Reference, remove the verbose CLI Examples section or merge the unique examples into Quick Reference.
3. **Compress settings.json documentation** — replace the full JSON example + 12-row config table with a compact reference: list only non-obvious settings with defaults. Port 7600, batch windows, rate limits can be one line each.
4. **Move Collectors and Validators to reference doc** — the collector push/pull mechanics (lines 247–270) and validator skip rules (lines 249–256) are implementation details. Move to `docs/interrupt-service-internals.md`.
5. **Compress Pipelines section** — reduce to: "Message pipeline: fast notifications via `openclaw system event` (2s batch, 10/min). Subagent pipeline: complex analysis via `openclaw agent` (5s batch, 4/min). Both have circuit breakers."
6. **Deduplicate rule fields** — the rule JSON example (lines 279–293) and fields table (lines 297–312) show the same info twice. Keep only the table.
7. **Remove Integration with Collectors section** — the ha-bridge and mail-sentinel examples (lines 336–360) duplicate the CLI trigger examples above.

## Expected Impact
- Current: 18,328 chars (~4,580 tokens)
- Target: ~9,500 chars (~2,375 tokens)
- Savings: ~8,800 chars (~2,200 tokens per read, ~48% reduction)
- **Second biggest savings opportunity. Combined with home-presence, saves ~4,300 tokens per pair-read.**

## Bugs / Errors Found
- **`source` field marked "no" for required in rule fields table (line 300)** — but all examples include it and it's "yes" required in the `add` CLI flags table (line 66). Inconsistent.
- **POST /rules response undocumented** — says "Returns the created/updated rule with its assigned id" but no example response shown.
- **Stale validator path** — `settings.json` references `/home/jherrild/.openclaw/workspace/skills/home-presence/validate-entity.js`. If home-presence is reorganized, this breaks silently.
- **`mail-sentinel` referenced but not in skills list** — the Integration section mentions `mail-sentinel` as a collector, but no such skill exists. Either planned/unimplemented or renamed.
