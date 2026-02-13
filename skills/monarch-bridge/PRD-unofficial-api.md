# PRD: Unofficial Monarch API Bridge (Node.js) — Reduced Scope

## Status

**Phase 2 (CLI Implementation) — In Progress**

Reduced scope: 529-specific features removed. Focus on three core read-only commands: `accounts`, `net-worth`, `transactions`.

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
| `transactions` | `getTransactions({...})` | Recent transactions with filters |
| `net-worth` | `getAccounts()` (computed) | Token-dense NW one-liner |

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

### 3. Output Format

All output follows the existing token-dense format from the Python bridge:
- Compact, no banners or progress bars
- Machine-parseable but human-readable
- Consistent with existing `monarch_bridge.py` output format
- Same `sanitize_text()` equivalent for merchant/note fields

### 4. Error Handling

| Error | Behavior |
|-------|----------|
| Missing `MONARCH_TOKEN` | Print `ERROR: MONARCH_TOKEN not set. Run login.mjs first.` → exit 1 |
| Auth failure (401/403) | Print `ERROR: Token expired or invalid. Re-run login.` → exit 1 |
| Network/Cloudflare error | Print error details → exit 1 |
| Account not found | Print `No account found with ID <id>` → exit 1 |

## File Layout

```
skills/monarch-bridge/
├── PRD.md                      # Original PRD (v1, host-native Python)
├── PRD-docker.md               # Docker/Tailscale approach
├── PRD-unofficial-api.md       # This document (v3, Node.js — reduced scope)
├── SKILL.md                    # Agent-facing skill docs (update post-implementation)
├── monarch_bridge.py           # Current Python CLI (keep as fallback, DO NOT MODIFY)
├── requirements.txt            # Python deps (keep for Python version)
├── monarch-bridge.mjs          # Node.js CLI entry point (3 commands)
├── lib/
│   ├── accounts.mjs            # accounts + net-worth commands
│   ├── transactions.mjs        # transactions command
│   ├── format.mjs              # Output formatting helpers (fmtMoney, sanitize, fmtDate)
│   └── auth.mjs                # Token validation (requireToken)
├── login.mjs                   # One-time interactive token acquisition
├── package.json                # Node.js dependencies
└── .gitignore                  # node_modules/, .venv/, etc.
```

> **Removed:** `check-529.mjs` (529-specific prototype), `monarch-bridge.sh` (deferred), `.env.example` (deferred).

## Implementation Plan

### Phase 1: Prototype ✅ DONE

1. ~~Initialize `package.json` and install `monarch-money-api`.~~
2. ~~Write `login.mjs` — interactive token acquisition.~~
3. ~~Write `check-529.mjs` to verify API connectivity.~~ (removed — 529 scope dropped)

### Phase 2: CLI Implementation ✅ DONE

1. ~~Implement `monarch-bridge.mjs` with `process.argv` parsing (no heavy CLI framework).~~
2. ~~Implement 3 core commands:~~
   - ~~`accounts` → `getAccounts()` via `lib/accounts.mjs`~~
   - ~~`net-worth` → computed from `getAccounts()` via `lib/accounts.mjs`~~
   - ~~`transactions [filters]` → `getTransactions({...})` via `lib/transactions.mjs`~~
3. ~~Create supporting lib modules: `auth.mjs`, `format.mjs`, `accounts.mjs`, `transactions.mjs`.~~
4. Wrapper script (`monarch-bridge.sh`) deferred — token injection handled by caller.

### Phase 3: Integration & Hardening (TODO)

1. Update `SKILL.md` to document the new Node.js CLI alongside the Python fallback.
2. Test all commands end-to-end with a live token.
3. Verify output format is usable for LLM consumption.
4. Add token expiry detection and clear error messaging.
5. Optionally create `monarch-bridge.sh` wrapper for 1Password token injection.

## API Method Reference

### Read Methods (Used)

| Method | GraphQL Operation | Returns |
|--------|------------------|---------|
| `getAccounts()` | `GetAccounts` | All accounts with type, subtype, balance, institution, NW inclusion |
| `getTransactions({...})` | `GetTransactionsList` | Transactions with full filter support |

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
| Fallback | N/A | Can wrap in Docker if needed |

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Unofficial API breaks with Monarch update | Medium | Pin npm version; monitor GitHub issues; Python bridge as fallback |
| Cloudflare blocks `api.monarchmoney.com` too | Low-Medium | Fall back to Docker/Tailscale wrapper (Phase 4) |
| Token expiry | Medium | Detect 401/403 → prompt for re-login → update 1Password |
| Library abandoned (v0.0.4, small project) | Medium | Library is thin GraphQL wrapper; easy to fork/maintain. All queries are in `src/api.js` |
| MFA changes | Low | Library supports TOTP via `otplib`; 1Password can store TOTP secret |

## Success Criteria

- [ ] `node monarch-bridge.mjs accounts` returns all accounts with balances
- [ ] `node monarch-bridge.mjs net-worth` shows assets/liabilities/net-worth summary
- [ ] `node monarch-bridge.mjs transactions --search "Amazon"` works with filters
- [ ] No Cloudflare 525 errors when connecting to `api.monarchmoney.com`
- [ ] Token injected via `MONARCH_TOKEN` env var — no secrets in code or files
- [ ] All mutation methods are excluded from the CLI
- [ ] 529-specific code (`check-529.mjs`) removed from active codebase

## Open Questions

1. **Cloudflare on `api.monarchmoney.com`:** Does the API subdomain have the same aggressive bot detection? Phase 1 will answer this immediately.
2. **Token lifetime:** How long do Monarch tokens last before expiring? Need to test with the Node.js library.
3. **Rate limiting:** Does Monarch rate-limit the API? The Python bridge hasn't hit limits, but a Node.js version making more granular calls (e.g., per-account holdings) might.
