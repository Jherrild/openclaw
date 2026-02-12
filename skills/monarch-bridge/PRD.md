# PRD: Monarch Money Bridge

## Vision
To provide Magnus with secure, read-only access to Jesten's financial status via Monarch Money. This enables Magnus to provide context-aware financial advice, automated expense tracking, and high-level wealth snapshots without manual data entry.

## Core Requirements

### 1. Security & Authentication (MANDATORY)
- **Identity:** Use the dedicated "Magnus" Monarch credentials stored in 1Password.
- **Protocol:** Use the `op` CLI to retrieve credentials at runtime. NEVER store passwords in plaintext.
- **Isolation:** Use the `hammem/monarchmoney` Python library as the foundation.
- **Read-Only Enforcement:** The Magnus-facing CLI wrapper MUST NOT implement or expose any "write" methods (e.g., `update_transaction`, `create_manual_account`, `delete_x`). It should strictly be a "Getter" interface.

### 2. Core Read Operations
- **`accounts`**: List all linked accounts with current balances, types (Investment, Credit, Cash), and sync status.
- **`account-details <id>`**: Deep dive into a specific account's holdings or history.
- **`transactions`**: Fetch recent transactions with filters (date range, category, account, amount).
- **`categories`**: List budget categories and current spending vs. goal for the month.

### 3. Financial Intelligence Features (Proposed)
- **`net-worth`**: A high-level aggregate of all assets vs. liabilities for a "one-line wealth status."
- **`recurring-detect`**: Identify upcoming bills based on historical transaction patterns (useful for scheduling Google Tasks/Reminders).
- **`burn-rate`**: Calculate average daily spending for the current month vs. the previous 3 months.
- **`unusual-activity`**: Flag transactions that are significantly higher than the average for a specific category (e.g., "Hey Jesten, your 'Utilities' bill was 50% higher this month").

## Magnus Integration
- **Morning Briefing:** Include a "Financial Snapshot" (Net Worth change + top 3 spending categories).
- **Obsidian PARA:** Enable Magnus to archive monthly financial summaries into `2-Areas/Finance/Monthly Summaries/`.

## Implementation Strategy
1. **Magnus:** Draft this PRD.
2. **Delegate:** `copilot-delegate` to implement `monarch_bridge.py` using the `hammem/monarchmoney` library.
3. **Verify:** Test with the `op` CLI integration to ensure credentials flow correctly and securely.
