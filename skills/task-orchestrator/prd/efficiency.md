# task-orchestrator Efficiency PRD

## Problem
SKILL.md is ~2,900 chars with ~25% boilerplate. The "What Magnus Says → What to Do" table (10 rows) is redundant — it maps natural language to CLI commands that are already documented in the CLI Reference. The "Cheap Triggers Philosophy" section restates the interrupt-wrapper design already explained in Script Contract. Add Options could merge with CLI Reference.

## Proposed Changes
1. **Remove "What Magnus Says" table** — all 10 entries map to commands already listed in CLI Reference. Magnus can infer the mapping. Saves ~500 chars.
2. **Merge Add Options into CLI Reference** — fold the `--interval`, `--interrupt`, etc. flags into a sub-table or footnote under the `add` command row. Eliminates the separate section header. Saves ~100 chars.
3. **Replace "Cheap Triggers Philosophy" with 1-line design note** — "Scripts echo findings to stdout and exit 0; interrupt-wrapper handles dispatch." The current paragraph restates what Script Contract already says. Saves ~150 chars.
4. **Simplify Script Contract to 3-line rule** — the current table format is clear but can be compressed: "Exit 0 + stdout → interrupt fired. Exit 0 + no stdout → silent. Non-zero → logged, no interrupt." Saves ~100 chars.
5. **Compress Architecture section** — reduce to: "Tasks are native systemd user services/timers under `~/.config/systemd/user/openclaw-task-<name>.*`. Metadata in `tasks.json`."

## Expected Impact
- Current: ~2,900 chars
- Target: ~2,320 chars (~20% reduction, ~145 token savings per read)

## Bugs / Errors Found
- **No bugs found.** CLI commands, script contract, and interrupt integration are accurate and consistent.
- Minor: Currently Registered Tasks table at the bottom will go stale as tasks are added/removed. Consider replacing with: "Run `./orchestrator.js list` for current tasks."
