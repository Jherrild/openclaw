# monarch-bridge Efficiency PRD

## Problem
SKILL.md is ~2,700 chars with ~15% boilerplate. The Tools section repeats the same `python3 .../monarch_bridge.py <cmd>` invocation pattern 6 times with individual **Parameters** and **Usage** sub-headers. The 1Password auth flow is explained in both Configuration and Security sections.

## Proposed Changes
1. **Create a shared Tool Template** — show the base invocation once: `python3 /home/jherrild/.openclaw/workspace/skills/monarch-bridge/monarch_bridge.py <command> [options]`. Then list commands in a table: Command | Description | Options. Eliminates 5 redundant `python3 ...` code blocks (~400 chars saved).
2. **Consolidate auth into a single "Auth" section** — merge Configuration's `op read` explanation and Security's "1Password: Credentials retrieved at runtime" into one 3-line block. Remove duplication from Security.
3. **Compress Security section** — after auth extraction, reduce to: "Read-only. Session cached in `.session` (gitignored). No third-party executables."
4. **Keep `transactions` options inline** — the `--limit`, `--start-date`, etc. flags are the only command with complex options. Show them as a compact flag list under the table rather than a separate section.
5. **Remove Files tree** — replace with: "See directory listing. Key file: `monarch_bridge.py`."

## Expected Impact
- Current: ~2,700 chars
- Target: ~2,160 chars (~20% reduction, ~135 token savings per read)

## Bugs / Errors Found
- **No bugs found.** Commands, auth flow, and error handling are accurate.
- Minor: `account-details` example doesn't show where `account_id` comes from — could add "(from `accounts` output)" inline in the table.
