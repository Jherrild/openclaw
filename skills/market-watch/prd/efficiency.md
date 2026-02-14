# market-watch Efficiency PRD

## Problem
SKILL.md is ~3,100 chars with ~20% boilerplate. The Sentinel Daemon and Integration sections overlap (both describe the stdout → interrupt pipeline). The `snapshot` subcommand appears in Quick Start but is missing from the CLI Reference section. De-duplication is explained twice (in Sentinel and implicitly in Configuration).

## Proposed Changes
1. **Consolidate Sentinel + Integration into a single "Sentinel & Interrupts" section** — merge the pipeline description, de-duplication explanation, and task-orchestrator registration into one block. Saves ~300 chars.
2. **Add `market.py snapshot` to CLI Reference** — it's in Quick Start but missing from the reference table. Add a 2-line entry matching the existing format.
3. **Deduplicate de-duplication** — mention `sentinel-state.json` once in the Sentinel section. Remove the separate bullet in Configuration that restates it.
4. **Compress Security section** — "Read-only", "No API keys", "Venv isolated" can be a single sentence: "Read-only (no trading); uses public Yahoo Finance endpoints; dependencies in `.venv/`."
5. **Remove Files tree** — the files list is useful for discovery but Magnus rarely needs it. Replace with a 1-line reference: "See directory listing for file inventory."

## Expected Impact
- Current: ~3,100 chars
- Target: ~2,635 chars (~15% reduction, ~115 token savings per read)

## Bugs / Errors Found
- **Missing CLI reference:** `market.py snapshot` is used in Quick Start (line 17) but has no entry in the CLI Reference section. Agent may not know it exists when scanning the reference table.
- No other bugs found. Watchlist commands and sentinel flow are accurate.
