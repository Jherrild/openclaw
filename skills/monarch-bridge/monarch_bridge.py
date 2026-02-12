#!/usr/bin/env python3
"""
Monarch Bridge — Read-only CLI for Monarch Money
Usage:
  monarch_bridge.py accounts                    List all accounts with balances
  monarch_bridge.py account-details <id>        Holdings/history for one account
  monarch_bridge.py transactions [filters]      Recent transactions
  monarch_bridge.py categories                  Budget categories + spending vs goal
  monarch_bridge.py net-worth                   Token-dense one-liner: assets vs liabilities
"""
import sys
import os
import json
import asyncio
import argparse
import subprocess
from datetime import datetime, date, timezone
from pathlib import Path
from decimal import Decimal

# ── Venv auto-activation ──────────────────────────────────────────────────
SKILL_DIR = Path(__file__).resolve().parent
VENV_SITE = SKILL_DIR / ".venv" / "lib"
if VENV_SITE.exists():
    for p in sorted(VENV_SITE.iterdir()):
        sp = p / "site-packages"
        if sp.exists() and str(sp) not in sys.path:
            sys.path.insert(0, str(sp))

from monarchmoney import MonarchMoney, RequireMFAException

SESSION_FILE = SKILL_DIR / ".session"
OP_ITEM = "Monarch Money - Magnus"

# ── Auth helpers ──────────────────────────────────────────────────────────

def _op_read(field: str) -> str:
    """Read a field from 1Password using the op CLI."""
    ref = f"op://{OP_ITEM}/{field}"
    try:
        result = subprocess.run(
            ["op", "read", ref],
            capture_output=True, text=True, check=True, timeout=15
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"ERROR: op read failed for '{field}': {e.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    except FileNotFoundError:
        print("ERROR: 'op' CLI not found. Install 1Password CLI.", file=sys.stderr)
        sys.exit(1)


async def get_client() -> MonarchMoney:
    """Authenticate and return a MonarchMoney client. Uses saved session when possible."""
    mm = MonarchMoney()

    # Try saved session first
    if SESSION_FILE.exists():
        try:
            mm.load_session(str(SESSION_FILE))
            # Validate session with a lightweight call
            await mm.get_subscription_details()
            return mm
        except Exception:
            SESSION_FILE.unlink(missing_ok=True)

    # Fresh login via 1Password credentials
    email = _op_read("MONARCH_EMAIL")
    password = _op_read("MONARCH_PASSWORD")

    try:
        await mm.login(email, password, use_saved_session=False, save_session=False)
    except RequireMFAException:
        print("ERROR: MFA required. Run interactively first to set up session.", file=sys.stderr)
        sys.exit(1)

    mm.save_session(str(SESSION_FILE))
    return mm


# ── Formatting helpers ────────────────────────────────────────────────────

def fmt_money(val) -> str:
    """Compact money format."""
    if val is None:
        return "N/A"
    v = float(val)
    if abs(v) >= 1_000_000:
        return f"${v/1_000_000:.2f}M"
    if abs(v) >= 1_000:
        return f"${v/1_000:.1f}K"
    return f"${v:.2f}"


def fmt_money_full(val) -> str:
    """Full precision money format."""
    if val is None:
        return "N/A"
    return f"${float(val):,.2f}"


def fmt_date(iso_str: str) -> str:
    """Compact date from ISO string."""
    if not iso_str:
        return "N/A"
    return iso_str[:10]


# ── Commands ──────────────────────────────────────────────────────────────

async def cmd_accounts():
    """List all accounts with balances, types, and sync status."""
    mm = await get_client()
    data = await mm.get_accounts()

    accounts = data.get("accounts", [])
    if not accounts:
        print("No accounts found.")
        return

    # Group by type
    by_type = {}
    for a in accounts:
        t = a.get("type", {}).get("display", "Other") if isinstance(a.get("type"), dict) else str(a.get("type", "Other"))
        by_type.setdefault(t, []).append(a)

    for acct_type, accts in sorted(by_type.items()):
        print(f"\n── {acct_type} ──")
        for a in sorted(accts, key=lambda x: x.get("displayName", "")):
            name = a.get("displayName", a.get("name", "?"))
            balance = fmt_money_full(a.get("currentBalance") or a.get("displayBalance"))
            institution = a.get("institution", {}).get("name", "") if isinstance(a.get("institution"), dict) else ""
            sync = a.get("dataProvider", "manual")
            acct_id = a.get("id", "?")
            incl_nw = "✓NW" if a.get("includeInNetWorth") else "—NW"
            parts = [f"  [{acct_id}] {name}: {balance}"]
            if institution:
                parts.append(f"@ {institution}")
            parts.append(f"({incl_nw})")
            print(" ".join(parts))


async def cmd_account_details(account_id: str):
    """Deep dive into a specific account."""
    mm = await get_client()

    # Try holdings first (for investment accounts)
    try:
        holdings = await mm.get_account_holdings(int(account_id))
        if holdings and holdings.get("holdings"):
            print(f"── Holdings for account {account_id} ──")
            for h in holdings["holdings"]:
                name = h.get("name", h.get("ticker", "?"))
                ticker = h.get("ticker", "")
                qty = h.get("quantity", 0)
                value = fmt_money_full(h.get("value"))
                cost = fmt_money_full(h.get("costBasis"))
                ticker_part = f" ({ticker})" if ticker else ""
                print(f"  {name}{ticker_part}: {value} | qty={qty} | cost={cost}")
            return
    except Exception:
        pass

    # Fall back to account history
    try:
        history = await mm.get_account_history(int(account_id))
        snapshots = history.get("accountSnapshotsByDate", history.get("snapshots", []))
        if isinstance(snapshots, list) and snapshots:
            print(f"── Balance history for account {account_id} (last 10) ──")
            for s in snapshots[-10:]:
                d = s.get("date", "?")
                bal = fmt_money_full(s.get("signedBalance") or s.get("balance"))
                print(f"  {d}: {bal}")
            return
    except Exception:
        pass

    print(f"No detailed data available for account {account_id}.")


async def cmd_transactions(args):
    """Fetch recent transactions with optional filters."""
    mm = await get_client()

    kwargs = {
        "limit": args.limit,
        "offset": args.offset or 0,
    }
    if args.start_date:
        kwargs["start_date"] = args.start_date
    if args.end_date:
        kwargs["end_date"] = args.end_date
    if args.search:
        kwargs["search"] = args.search
    if args.category_ids:
        kwargs["category_ids"] = args.category_ids.split(",")
    if args.account_ids:
        kwargs["account_ids"] = args.account_ids.split(",")

    data = await mm.get_transactions(**kwargs)
    txns = data.get("allTransactions", {}).get("results", [])

    if not txns:
        print("No transactions found.")
        return

    total = data.get("allTransactions", {}).get("totalCount", len(txns))
    print(f"Showing {len(txns)} of {total} transactions:\n")

    for t in txns:
        d = fmt_date(t.get("date", ""))
        amount = fmt_money_full(t.get("amount"))
        merchant = t.get("merchant", {}).get("name", "") if isinstance(t.get("merchant"), dict) else t.get("plaidName", "?")
        cat = t.get("category", {}).get("name", "") if isinstance(t.get("category"), dict) else ""
        acct = t.get("account", {}).get("displayName", "") if isinstance(t.get("account"), dict) else ""
        pending = " [PENDING]" if t.get("isPending") else ""
        tid = t.get("id", "")
        notes = f' "{t["notes"]}"' if t.get("notes") else ""

        print(f"  {d} | {amount:>12} | {merchant:<30} | {cat:<20} | {acct}{pending}{notes}")


async def cmd_categories():
    """List budget categories with spending vs goal for current month."""
    mm = await get_client()

    now = date.today()
    start = now.replace(day=1).isoformat()
    end = now.isoformat()

    data = await mm.get_budgets(start_date=start, end_date=end)

    budget_data = data.get("budgetData", data)
    if isinstance(budget_data, dict):
        groups = budget_data.get("budgetCategoryGroups", budget_data.get("categoryGroups", []))
    else:
        groups = []

    if not groups:
        # Try flat categories
        cats = budget_data.get("categories", [])
        if cats:
            groups = [{"categoryGroup": {"name": "All"}, "categories": cats}]

    if not groups:
        print("No budget data found.")
        return

    print(f"Budget for {now.strftime('%B %Y')}:\n")

    for g in groups:
        group_name = g.get("categoryGroup", {}).get("name", g.get("name", "Unknown"))
        cats = g.get("categories", [])
        if not cats:
            continue

        print(f"── {group_name} ──")
        for c in cats:
            name = c.get("category", {}).get("name", c.get("name", "?"))
            # Try v2 goals structure
            budget_amt = None
            actual_amt = None

            # v2 goals
            goal = c.get("goal") or c.get("budgetGoal")
            if isinstance(goal, dict):
                budget_amt = goal.get("amount")

            # Actual spending
            actual_amt = c.get("actual") or c.get("actualAmount") or c.get("spent")
            if isinstance(actual_amt, dict):
                actual_amt = actual_amt.get("amount")

            budget_str = fmt_money_full(budget_amt) if budget_amt else "no budget"
            actual_str = fmt_money_full(actual_amt) if actual_amt is not None else "$0.00"

            # Percent used
            pct = ""
            if budget_amt and actual_amt:
                try:
                    p = abs(float(actual_amt)) / abs(float(budget_amt)) * 100
                    pct = f" ({p:.0f}%)"
                except (ZeroDivisionError, TypeError, ValueError):
                    pass

            print(f"  {name:<30} {actual_str:>12} / {budget_str}{pct}")
        print()


async def cmd_net_worth():
    """Token-dense one-liner: assets vs liabilities = net worth."""
    mm = await get_client()
    data = await mm.get_accounts()

    accounts = data.get("accounts", [])
    assets = 0.0
    liabilities = 0.0

    for a in accounts:
        if not a.get("includeInNetWorth", True):
            continue
        bal = float(a.get("currentBalance") or a.get("displayBalance") or 0)
        # Credit cards / loans have negative balances or specific types
        acct_type = a.get("type", {})
        if isinstance(acct_type, dict):
            type_name = acct_type.get("name", "").lower()
        else:
            type_name = str(acct_type).lower()

        is_liability = type_name in ("credit", "credit_card", "loan", "mortgage", "student_loan", "auto_loan", "personal_loan", "other_liability")

        if is_liability or bal < 0:
            liabilities += abs(bal)
        else:
            assets += bal

    nw = assets - liabilities
    sign = "+" if nw >= 0 else ""
    print(f"NW: {fmt_money(nw)} | Assets: {fmt_money(assets)} | Debt: {fmt_money(liabilities)} | {sign}{((nw/(assets or 1))*100):.0f}% equity")


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Monarch Bridge — Read-only Monarch Money CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Credentials fetched from 1Password at runtime via 'op' CLI."
    )
    sub = parser.add_subparsers(dest="command")

    # accounts
    sub.add_parser("accounts", help="List all accounts with balances")

    # account-details
    p_det = sub.add_parser("account-details", help="Holdings/history for one account")
    p_det.add_argument("account_id", help="Account ID (from 'accounts' output)")

    # transactions
    p_txn = sub.add_parser("transactions", help="Recent transactions with filters")
    p_txn.add_argument("--limit", type=int, default=25, help="Max results (default: 25)")
    p_txn.add_argument("--offset", type=int, default=0, help="Offset for pagination")
    p_txn.add_argument("--start-date", help="Start date (YYYY-MM-DD)")
    p_txn.add_argument("--end-date", help="End date (YYYY-MM-DD)")
    p_txn.add_argument("--search", help="Search text (merchant name, etc.)")
    p_txn.add_argument("--category-ids", help="Comma-separated category IDs")
    p_txn.add_argument("--account-ids", help="Comma-separated account IDs")

    # categories
    sub.add_parser("categories", help="Budget categories + spending vs goal")

    # net-worth
    sub.add_parser("net-worth", help="Token-dense one-liner: assets vs liabilities")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "accounts":
        asyncio.run(cmd_accounts())
    elif args.command == "account-details":
        asyncio.run(cmd_account_details(args.account_id))
    elif args.command == "transactions":
        asyncio.run(cmd_transactions(args))
    elif args.command == "categories":
        asyncio.run(cmd_categories())
    elif args.command == "net-worth":
        asyncio.run(cmd_net_worth())
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
