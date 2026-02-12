---
name: monarch-bridge
description: Read-only access to Monarch Money financial data (accounts, transactions, budgets, net worth)
---

# Monarch Bridge

## Overview
- Provides Magnus with **read-only** access to Jesten's Monarch Money financial data.
- Credentials are fetched from 1Password at runtime via `op` CLI — never stored in plaintext.
- Supports accounts, transactions, budgets, and a token-dense net-worth one-liner.

## Configuration
- **Script Path:** `/home/jherrild/.openclaw/workspace/skills/monarch-bridge/monarch_bridge.py`
- **Authentication:** `op read` fetches `MONARCH_EMAIL` and `MONARCH_PASSWORD` from the "Monarch Money - Magnus" item in 1Password.
- **Session Cache:** Saved to `.session` in the skill directory to avoid re-auth on every call.
- **Venv:** `.venv/` contains `monarchmoney` library (auto-activated by script).

## Tools

### accounts
List all linked accounts with current balances, types, institution, and net-worth inclusion.

**Usage:**
```bash
python3 /home/jherrild/.openclaw/workspace/skills/monarch-bridge/monarch_bridge.py accounts
```

### account-details
Deep dive into a specific account's holdings (investment) or balance history.

**Parameters:**
- `account_id`: The account ID (shown in `accounts` output in brackets)

**Usage:**
```bash
python3 /home/jherrild/.openclaw/workspace/skills/monarch-bridge/monarch_bridge.py account-details <account_id>
```

### transactions
Fetch recent transactions with optional filters.

**Parameters:**
- `--limit N`: Max results (default: 25)
- `--offset N`: Pagination offset
- `--start-date YYYY-MM-DD`: Start date filter
- `--end-date YYYY-MM-DD`: End date filter
- `--search TEXT`: Search merchant names
- `--category-ids ID1,ID2`: Filter by category IDs
- `--account-ids ID1,ID2`: Filter by account IDs

**Usage:**
```bash
# Last 25 transactions
python3 /home/jherrild/.openclaw/workspace/skills/monarch-bridge/monarch_bridge.py transactions

# Transactions this month, search "Amazon"
python3 /home/jherrild/.openclaw/workspace/skills/monarch-bridge/monarch_bridge.py transactions --start-date 2026-02-01 --search "Amazon"
```

### categories
List budget categories with current month spending vs. budget goal.

**Usage:**
```bash
python3 /home/jherrild/.openclaw/workspace/skills/monarch-bridge/monarch_bridge.py categories
```

### net-worth
Token-dense one-liner showing assets, liabilities, and net worth.

**Usage:**
```bash
python3 /home/jherrild/.openclaw/workspace/skills/monarch-bridge/monarch_bridge.py net-worth
```
**Example output:**
```
NW: $245.3K | Assets: $312.5K | Debt: $67.2K | +79% equity
```

## Security
- **Read-only:** No mutating methods (create, update, delete) are exposed.
- **1Password:** Credentials retrieved at runtime via `op read`. Never stored in files.
- **Session caching:** Auth session saved locally to avoid repeated logins. Session file is gitignored.
- **No third-party executables:** All code authored in-house using the `monarchmoney` library.

## Files
```
monarch-bridge/
├── PRD.md              # Product requirements
├── SKILL.md            # This file (agent instructions)
├── monarch_bridge.py   # Core CLI tool (read-only)
├── .session            # Auth session cache (auto-managed, gitignored)
└── .venv/              # Python virtual environment
```

## Error Handling
- If `op` CLI is not found or auth fails → prints error to stderr, exits 1
- If session is stale → auto-deletes and re-authenticates
- If MFA is required → prints error asking for interactive setup first

## Integration
- **Morning Briefing:** Use `net-worth` for the Financial Snapshot section
- **Obsidian PARA:** Use `transactions` + `categories` data to generate monthly summaries in `2-Areas/Finance/`
