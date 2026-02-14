# PRD: Monarch Bridge (Community Python Fork)

## Problem Statement
The original `monarch-bridge` (Python) failed due to API changes. The `monarch-bridge` (Node.js) failed due to Cloudflare 525 SSL errors. The user has identified a community fork of the Python library (`monarchmoneycommunity`) that fixes the API endpoints.

**Critical Constraint:** The Cloudflare 525 error is a network-level block on the host IP. Switching libraries alone will likely not fix this. **However**, we will implement the bridge using this new library as requested, and then—if 525 persists—we will wrap this *working code* in the Docker/Tailscale container (PRD-docker.md) to route traffic through a residential IP.

## Goals
1.  Re-implement `monarch_bridge.py` using the `monarchmoneycommunity` package.
2.  Support the same commands as the Node.js prototype: `accounts`, `net-worth`, `transactions`.
3.  Support 529 plan retrieval (confirmed supported in Python lib via `get_accounts`).
4.  Prepare for Dockerization if host-level execution fails.

## Technical Details
-   **Library:** `monarchmoneycommunity` (https://github.com/bradleyseanf/monarchmoneycommunity)
-   **Language:** Python 3.11+
-   **Auth:** Interactive login (saved to session file) or persistent token.

## Implementation Plan
1.  **Environment:** Create a virtualenv and install `monarchmoneycommunity`.
2.  **Script:** Refactor `monarch_bridge.py` to use the new library.
    -   Command: `accounts` -> `mm.get_accounts()`
    -   Command: `transactions` -> `mm.get_transactions()`
    -   Command: `net-worth` -> `mm.get_accounts()` (computed)
    -   Command: `login` -> `mm.interactive_login()`
3.  **Authentication:** The library supports saving session pickles. We will use `mm.save_session()` to persist auth.
4.  **Verification:** Run `login` command. If 525 occurs, proceed immediately to Docker.

## Files
-   `skills/monarch-bridge/monarch_bridge.py` (Update)
-   `skills/monarch-bridge/requirements.txt` (Update)
