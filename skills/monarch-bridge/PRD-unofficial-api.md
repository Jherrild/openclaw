# PRD: Unofficial Monarch API Bridge (Node.js)

## Problem Statement

The current `monarch-bridge` skill is a Python CLI (`monarch_bridge.py`) using the `monarchmoney` Python library. It suffers from persistent **Cloudflare 525 SSL handshake errors** when connecting to `app.monarchmoney.com` from the host machine. The Docker-based approach (see `PRD-docker.md`) solves this via Tailscale exit node routing, but adds significant infrastructure complexity (Docker, Tailscale, auth key management).

This document proposes an alternative: a **Node.js implementation** using the `monarch-money-api` npm package, which connects to `api.monarchmoney.com` (a different endpoint) and may avoid the Cloudflare issues entirely. If the Cloudflare problem persists, this lighter-weight Node.js implementation is still easier to wrap in the Docker/Tailscale solution than the Python version.

## Research Summary

### Library: `monarch-money-api` (v0.0.4)

- **Author:** Philip Bassham ([GitHub](https://github.com/pbassham/monarch-money-api))
- **License:** MIT
- **npm:** `monarch-money-api`
- **Language:** JavaScript (ESM, `"type": "module"`)
- **Dependencies:** `axios`, `graphql-request`, `graphql-tag`, `node-fetch`, `form-data`, `otplib`
- **How it works:** All queries are derived by introspecting the GraphQL queries on the Monarch Money web application. The library sends authenticated GraphQL requests to `https://api.monarchmoney.com/graphql`.

### Authentication

The library supports two auth methods:

1. **Environment variable:** Set `MONARCH_TOKEN=<token>` — the library reads it automatically from `process.env.MONARCH_TOKEN` at module load time (in `session.js`).
2. **Interactive login:** `interactiveLogin()` prompts for email/password/MFA and returns a token. The token can then be saved.
3. **Programmatic login:** `login(email, password, ...)` or `loginUser(email, password, mfaSecretKey)`.

For our use case, we will obtain a token once (via interactive login or programmatic login with 1Password credentials), store it in 1Password, and inject it as `MONARCH_TOKEN` at runtime.

### API Endpoint Difference

The Python `monarchmoney` library hits `https://app.monarchmoney.com/graphql`, while this Node.js library hits `https://api.monarchmoney.com/graphql` — a dedicated API subdomain. This difference may be significant for Cloudflare bypass since the API subdomain likely has different bot-detection rules than the web app.

### 529 Plan Account Support

**Yes — 529 accounts are retrievable.** Here's the analysis:

The `getAccounts()` method returns all linked accounts with the following relevant fields via the `AccountFields` GraphQL fragment:

| Field | Description |
|-------|-------------|
| `id` | UUID — used to fetch holdings |
| `displayName` | User-facing name (e.g., "Fidelity 529 - Magnus") |
| `currentBalance` | Current balance |
| `type.name` / `type.display` | Account type (e.g., `"brokerage"`, `"investment"`) |
| `subtype.name` / `subtype.display` | Account subtype (e.g., `"529"`, `"529_plan"`, `"education_savings"`) |
| `holdingsCount` | Number of investment holdings |
| `institution.name` | Institution name (e.g., "Fidelity") |
| `includeInNetWorth` | Whether included in NW calculation |
| `isAsset` | Boolean — 529s are assets |

529 plans are investment accounts. They will appear in `getAccounts()` output. To identify them:

1. **By `subtype.name`/`subtype.display`:** Monarch categorizes 529 plans with specific subtypes. The `getAccountTypeOptions()` method returns all valid type/subtype combinations.
2. **By `displayName`:** Users often name accounts with "529" in the name.
3. **By filtering:** Check `type.name === "brokerage"` or `type.name === "investment"` AND `subtype` containing "529" or "education".

For **529 holdings** (individual funds within the 529), use `getAccountHoldings(accountId)` which returns:
- `security.name` / `security.ticker` — fund name and ticker
- `quantity` — number of shares
- `totalValue` — current market value
- `basis` — cost basis
- `securityPriceChangeDollars` / `securityPriceChangePercent` — daily change

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Host (WSL2 / Linux)                                     │
│                                                         │
│  Magnus calls:                                          │
│    monarch-bridge <command> [args]                       │
│         │                                               │
│         ▼                                               │
│  ┌───────────────────────────────────────┐              │
│  │ monarch-bridge.mjs (Node.js CLI)      │              │
│  │  1. Reads MONARCH_TOKEN from env      │              │
│  │     (injected via op read)            │              │
│  │  2. Calls monarch-money-api functions │              │
│  │  3. Formats output for LLM           │              │
│  └──────────────┬────────────────────────┘              │
│                 │ HTTPS (GraphQL)                        │
│                 ▼                                        │
│       api.monarchmoney.com/graphql                      │
└─────────────────────────────────────────────────────────┘
```

No Docker. No Tailscale. No Python venv. Just Node.js + npm.

## Core Requirements

### 1. Read-Only Enforcement

Only the following read methods from the library will be exposed:

| Command | API Method | Purpose |
|---------|-----------|---------|
| `accounts` | `getAccounts()` | List all accounts + balances |
| `account-details <id>` | `getAccountHoldings(id)` + `getAccountHistory(id)` | Holdings/history for one account |
| `transactions` | `getTransactions({...})` | Recent transactions with filters |
| `categories` | `getBudgets(start, end)` | Budget categories + spending vs goal |
| `net-worth` | `getAccounts()` (computed) | Token-dense NW one-liner |
| `529` | `getAccounts()` + `getAccountHoldings(id)` | 529-specific view (NEW) |
| `cashflow` | `getCashflow({...})` | Income/expense summary (NEW) |
| `recurring` | `getRecurringTransactions(start, end)` | Recurring transactions (NEW) |

**Mutation methods (create, update, delete) will NOT be exposed.** The CLI will not import or call any mutation functions.

### 2. Authentication

- **Token-based:** Use `MONARCH_TOKEN` environment variable.
- **Token acquisition:** One-time interactive login script (`login.mjs`) that:
  1. Reads email/password from 1Password via `op read`.
  2. Calls `loginUser(email, password)` or handles MFA via `multiFactorAuthenticate()`.
  3. Prints the token for storage in 1Password.
- **Runtime injection:** The wrapper script reads the token from 1Password and exports it:
  ```bash
  export MONARCH_TOKEN=$(op read "op://Magnus Agent Vault/Monarch/api-token")
  node monarch-bridge.mjs accounts
  ```
- **Token refresh:** If a request fails with auth error, the wrapper re-runs the login flow and updates 1Password.

### 3. 529 Plan Specific Features

A dedicated `529` command that:

1. Calls `getAccounts()` and filters for 529-type accounts by:
   - `subtype.name` or `subtype.display` containing "529" or "education"
   - `displayName` containing "529"
2. For each 529 account, calls `getAccountHoldings(accountId)` to get fund-level detail.
3. Outputs a compact summary:
   ```
   ── 529 Plans ──
     [uuid-1] Fidelity 529 - Magnus: $12,345.67 (3 holdings)
       FIDELITY INDEX FUND (FXAIX): $8,234.12 | 52.3 shares | +$1,230.45 (+17.6%)
       FIDELITY BOND INDEX (FXNAX): $3,111.55 | 31.2 shares | +$89.10 (+2.9%)
       CASH RESERVES: $1,000.00
     [uuid-2] Fidelity 529 - Sibling: $9,876.54 (2 holdings)
       ...
   Total 529 Value: $22,222.21
   ```

### 4. Output Format

All output follows the existing token-dense format from the Python bridge:
- Compact, no banners or progress bars
- Machine-parseable but human-readable
- Consistent with existing `monarch_bridge.py` output format
- Same `sanitize_text()` equivalent for merchant/note fields

### 5. Error Handling

| Error | Behavior |
|-------|----------|
| Missing `MONARCH_TOKEN` | Print `ERROR: MONARCH_TOKEN not set. Run login.mjs first.` → exit 1 |
| Auth failure (401/403) | Print `ERROR: Token expired or invalid. Re-run login.` → exit 1 |
| Network/Cloudflare error | Print error details → exit 1 |
| Account not found | Print `No account found with ID <id>` → exit 1 |
| No 529 accounts | Print `No 529 accounts found.` → exit 0 |

## File Layout

```
skills/monarch-bridge/
├── PRD.md                      # Original PRD (v1, host-native Python)
├── PRD-docker.md               # Docker/Tailscale approach
├── PRD-unofficial-api.md       # This document (v3, Node.js)
├── SKILL.md                    # Agent-facing skill docs (update post-implementation)
├── monarch_bridge.py           # Current Python CLI (keep as fallback)
├── requirements.txt            # Python deps (keep for Python version)
├── monarch-bridge.mjs          # NEW: Node.js CLI entry point
├── lib/
│   ├── accounts.mjs            # Account commands (accounts, account-details, 529)
│   ├── transactions.mjs        # Transaction commands
│   ├── budgets.mjs             # Budget/categories commands
│   ├── format.mjs              # Output formatting helpers (fmt_money, sanitize)
│   └── auth.mjs                # Token validation, 1Password integration
├── login.mjs                   # NEW: One-time token acquisition script
├── monarch-bridge.sh           # NEW: Wrapper script (injects token, calls node)
├── package.json                # NEW: Node.js dependencies
├── .env.example                # NEW: Documents MONARCH_TOKEN
└── .gitignore                  # Updated to include node_modules/
```

## Implementation Plan

### Phase 1: Prototype & 529 Validation

1. Initialize `package.json` and install `monarch-money-api`.
2. Write `login.mjs` — interactive token acquisition via 1Password credentials.
3. Write a quick test script to call `getAccounts()` and verify:
   - 529 accounts appear in the response.
   - The `type`/`subtype` fields identify them correctly.
   - `getAccountHoldings()` returns fund-level data for 529 accounts.
4. **Confirm whether `api.monarchmoney.com` avoids the Cloudflare 525 errors** that plague `app.monarchmoney.com`.

### Phase 2: CLI Implementation

1. Implement `monarch-bridge.mjs` with argument parsing (use Node.js `parseArgs` or minimal `process.argv` parsing — no heavy CLI framework needed).
2. Port all 5 existing commands from `monarch_bridge.py`:
   - `accounts` → `getAccounts()`
   - `account-details <id>` → `getAccountHoldings()` + `getAccountHistory()`
   - `transactions [filters]` → `getTransactions({...})`
   - `categories` → `getBudgets()`
   - `net-worth` → `getAccounts()` (computed)
3. Add new commands:
   - `529` → 529-specific filtered view with holdings
   - `cashflow` → `getCashflow()`
   - `recurring` → `getRecurringTransactions()`
4. Write `monarch-bridge.sh` wrapper script:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
   export MONARCH_TOKEN=$(op read "op://Magnus Agent Vault/Monarch/api-token" 2>/dev/null || true)
   if [ -z "$MONARCH_TOKEN" ]; then
     echo "ERROR: Could not read Monarch token from 1Password." >&2
     exit 1
   fi
   exec node "$SKILL_DIR/monarch-bridge.mjs" "$@"
   ```

### Phase 3: Integration & Hardening

1. Update `SKILL.md` to document the new Node.js CLI alongside the Python fallback.
2. Test all commands end-to-end.
3. Verify output format matches existing Python bridge for backwards compatibility.
4. Add token expiry detection and clear error messaging.
5. Symlink or alias `monarch-bridge` in PATH to the new wrapper.

### Phase 4: Deprecate Python Bridge (Conditional)

If the Node.js version works reliably (no Cloudflare issues):
1. Mark `monarch_bridge.py` as deprecated in SKILL.md.
2. Keep it as a fallback for 90 days.
3. Remove after confirmed stability.

If Cloudflare issues persist:
1. Wrap the Node.js CLI in the Docker/Tailscale setup from `PRD-docker.md` (simpler than wrapping Python since Node.js has fewer dependencies).

## API Method Reference

### Read Methods (Used)

| Method | GraphQL Operation | Returns |
|--------|------------------|---------|
| `getAccounts()` | `GetAccounts` | All accounts with type, subtype, balance, institution, NW inclusion |
| `getAccountHoldings(accountId)` | `Web_GetHoldings` | Investment holdings: security, quantity, value, basis, price change |
| `getAccountHistory(accountId)` | `AccountDetails_getAccount` | Balance snapshots, recent transactions |
| `getAccountTypeOptions()` | `GetAccountTypeOptions` | All valid account type/subtype combos |
| `getRecentAccountBalances(startDate)` | `GetAccountRecentBalances` | Recent daily balances for all accounts |
| `getTransactions({...})` | `GetTransactionsList` | Transactions with full filter support |
| `getBudgets(start, end)` | `GetJointPlanningData` | Budget data by category with actuals vs planned |
| `getTransactionCategories()` | `GetCategories` | All transaction categories |
| `getCashflow({...})` | `Web_GetCashFlowPage` | Income/expense aggregates by category, merchant |
| `getCashflowSummary({...})` | `Web_GetCashFlowPage` | Summarized income/expense/savings |
| `getRecurringTransactions(start, end)` | `Web_GetUpcomingRecurringTransactionItems` | Recurring transaction streams |
| `getInstitutions()` | `Web_GetInstitutionSettings` | Linked institutions and sync status |
| `getSubscriptionDetails()` | `GetSubscriptionDetails` | Subscription status (useful for health check) |
| `getAggregateSnapshots(start, end, type)` | `GetAggregateSnapshots` | Historical NW snapshots |
| `getAccountSnapshotsByType(start, timeframe)` | `GetSnapshotsByAccountType` | Balance history grouped by account type |

### Mutation Methods (NOT Used — Blocked)

The following methods exist in the library but will **NOT** be imported or exposed:
`createTransaction`, `deleteTransaction`, `updateTransaction`, `createManualAccount`, `updateAccount`, `deleteAccount`, `setBudgetAmount`, `createTransactionCategory`, `deleteTransactionCategory`, `createTransactionTag`, `setTransactionTags`, `updateTransactionSplits`, `uploadAccountBalanceHistory`

## Advantages Over Docker Approach

| Factor | Docker/Tailscale (PRD-docker.md) | Node.js API (this PRD) |
|--------|--------------------------------|----------------------|
| Infrastructure | Docker + Tailscale + auth keys | Node.js + npm only |
| Startup time | ~3-5s (Tailscale handshake) | ~200ms |
| Dependencies | Python + Docker + Tailscale | Node.js 18+ |
| Cloudflare bypass | Guaranteed (mobile IP exit node) | Likely (different API endpoint) |
| Maintenance | Container rebuilds, TS key rotation | `npm update` |
| Complexity | High | Low |
| 529 support | Same (via Python lib) | Same (via JS lib) + dedicated command |
| Fallback | N/A | Can wrap in Docker if needed |

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Unofficial API breaks with Monarch update | Medium | Pin npm version; monitor GitHub issues; Python bridge as fallback |
| Cloudflare blocks `api.monarchmoney.com` too | Low-Medium | Fall back to Docker/Tailscale wrapper (Phase 4) |
| Token expiry | Medium | Detect 401/403 → prompt for re-login → update 1Password |
| Library abandoned (v0.0.4, small project) | Medium | Library is thin GraphQL wrapper; easy to fork/maintain. All queries are in `src/api.js` |
| MFA changes | Low | Library supports TOTP via `otplib`; 1Password can store TOTP secret |
| `getAccountHoldings` doesn't return 529 fund detail | Low | Monarch treats 529s as investment accounts; the same `Web_GetHoldings` query works for all investment types |

## Success Criteria

- [ ] `monarch-bridge accounts` returns all accounts including 529 plans
- [ ] `monarch-bridge 529` shows 529 accounts with per-fund holdings
- [ ] `monarch-bridge net-worth` output matches Python bridge format
- [ ] `monarch-bridge transactions --search "Amazon"` works with filters
- [ ] No Cloudflare 525 errors when connecting to `api.monarchmoney.com`
- [ ] Token injected via 1Password at runtime — no secrets in code or files
- [ ] All mutation methods are excluded from the CLI

## Open Questions

1. **Cloudflare on `api.monarchmoney.com`:** Does the API subdomain have the same aggressive bot detection? Phase 1 will answer this immediately.
2. **Token lifetime:** How long do Monarch tokens last before expiring? Need to test with the Node.js library.
3. **529 subtype naming:** What exact `subtype.name` does Monarch use for 529 plans? Options include `"529"`, `"529_plan"`, `"education_savings"`, or `"other_investment"`. Phase 1 prototype will confirm.
4. **Rate limiting:** Does Monarch rate-limit the API? The Python bridge hasn't hit limits, but a Node.js version making more granular calls (e.g., per-account holdings) might.
