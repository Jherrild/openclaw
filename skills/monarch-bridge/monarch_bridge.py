#!/usr/bin/env python3
"""
Monarch Bridge — Read-only CLI for Monarch Money (community fork)
Usage:
  monarch_bridge.py login                       Interactive login (saves session)
  monarch_bridge.py accounts                    List all accounts with balances
  monarch_bridge.py net-worth                   Token-dense one-liner: assets vs liabilities
  monarch_bridge.py transactions [filters]      Recent transactions
"""
import sys
import os
import asyncio
import argparse
from pathlib import Path

# ── Venv auto-activation ──────────────────────────────────────────────────
SKILL_DIR = Path(__file__).resolve().parent
VENV_SITE = SKILL_DIR / ".venv" / "lib"
if VENV_SITE.exists():
    for p in sorted(VENV_SITE.iterdir()):
        sp = p / "site-packages"
        if sp.exists() and str(sp) not in sys.path:
            sys.path.insert(0, str(sp))

from monarchmoney import MonarchMoney

SESSION_FILE = SKILL_DIR / ".session"


# ── Auth helpers ──────────────────────────────────────────────────────────

async def get_client() -> MonarchMoney:
    """Load saved session and return an authenticated client."""
    mm = MonarchMoney()
    if not SESSION_FILE.exists():
        print("ERROR: No saved session. Run 'monarch_bridge.py login' first.", file=sys.stderr)
        sys.exit(1)
    mm.load_session(str(SESSION_FILE))
    return mm


# ── Formatting helpers ────────────────────────────────────────────────────

def sanitize(text: str) -> str:
    """Strip non-printable chars and defuse injection patterns."""
    if not text:
        return ""
    text = "".join(c for c in text if c.isprintable())
    text = text.replace("[[", "[_").replace("]]", "_]")
    text = text.replace("{{", "{_").replace("}}", "_}")
    return text[:200]


def fmt_money(val) -> str:
    """Full-precision USD format matching Node.js output."""
    if val is None:
        return "?"
    v = float(val)
    return f"${v:,.2f}"


def fmt_date(iso_str: str) -> str:
    """YYYY-MM-DD from ISO string."""
    if not iso_str:
        return "?"
    return iso_str[:10]


# ── Commands ──────────────────────────────────────────────────────────────

async def cmd_login():
    """Interactive login — prompts for email, password, and MFA if needed."""
    mm = MonarchMoney()
    await mm.interactive_login()
    mm.save_session(str(SESSION_FILE))
    print(f"Session saved to {SESSION_FILE}")


async def cmd_accounts():
    """List all accounts with balances (matches Node.js output format)."""
    mm = await get_client()
    data = await mm.get_accounts()

    accounts = data.get("accounts", [])
    if not accounts:
        print("No accounts found.")
        return

    for a in accounts:
        name = a.get("displayName") or a.get("name") or "?"
        bal = fmt_money(a.get("currentBalance") or a.get("balance"))
        type_obj = a.get("type", {})
        type_name = type_obj.get("name", "?") if isinstance(type_obj, dict) else str(type_obj)
        subtype_obj = a.get("subtype", {})
        subtype_name = subtype_obj.get("name", "") if isinstance(subtype_obj, dict) else ""
        inst = a.get("institution", {}).get("name", "") if isinstance(a.get("institution"), dict) else ""
        nw = " [excluded]" if a.get("includeInNetWorth") is False else ""
        type_str = f"{type_name}/{subtype_name}" if subtype_name else type_name
        print(f"{name} | {bal} | {type_str} | {inst}{nw}")

    print(f"\nTotal: {len(accounts)} account(s)")


async def cmd_net_worth():
    """Net worth summary (matches Node.js output format)."""
    mm = await get_client()
    data = await mm.get_accounts()

    accounts = data.get("accounts", [])
    included = [a for a in accounts if a.get("includeInNetWorth") is not False]

    assets = 0.0
    liabilities = 0.0

    for a in included:
        bal = float(a.get("currentBalance") or a.get("balance") or 0)
        type_obj = a.get("type", {})
        type_name = (type_obj.get("name", "") if isinstance(type_obj, dict) else str(type_obj)).lower()

        if type_name in ("credit", "loan", "liability"):
            liabilities += bal
        else:
            assets += bal

    nw = assets + liabilities  # liabilities are typically negative
    print(f"Net Worth: {fmt_money(nw)} | Assets: {fmt_money(assets)} | Liabilities: {fmt_money(liabilities)}")


async def cmd_transactions(args):
    """List transactions with optional filters (matches Node.js output format)."""
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
    if args.category_id:
        kwargs["category_ids"] = [args.category_id]
    if args.account_id:
        kwargs["account_ids"] = [args.account_id]

    data = await mm.get_transactions(**kwargs)
    txns = data.get("allTransactions", {}).get("results", [])

    if not txns:
        print("No transactions found.")
        return

    for t in txns:
        d = fmt_date(t.get("date", ""))
        merchant = sanitize(
            t.get("merchant", {}).get("name", "") if isinstance(t.get("merchant"), dict)
            else t.get("merchantName") or "?"
        )
        amount = fmt_money(t.get("amount"))
        cat = t.get("category", {}).get("name", "") if isinstance(t.get("category"), dict) else ""
        acct = (t.get("account", {}).get("displayName", "") or t.get("account", {}).get("name", "")) if isinstance(t.get("account"), dict) else ""
        print(f"{d} | {sanitize(merchant)} | {amount} | {cat} | {acct}")

    print(f"\nShowing {len(txns)} transaction(s)")


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Monarch Bridge — Read-only Monarch Money CLI (community fork)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Run 'login' first to authenticate interactively, then use other commands."
    )
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("login", help="Interactive login (saves session)")
    sub.add_parser("accounts", help="List all accounts with balances")
    sub.add_parser("net-worth", help="Show net worth summary")

    p_txn = sub.add_parser("transactions", help="List transactions with filters")
    p_txn.add_argument("--limit", type=int, default=25, help="Max results (default: 25)")
    p_txn.add_argument("--offset", type=int, default=0, help="Offset for pagination")
    p_txn.add_argument("--start-date", help="Start date (YYYY-MM-DD)")
    p_txn.add_argument("--end-date", help="End date (YYYY-MM-DD)")
    p_txn.add_argument("--search", help="Free-text search")
    p_txn.add_argument("--account-id", help="Filter by account ID")
    p_txn.add_argument("--category-id", help="Filter by category ID")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    if args.command == "login":
        asyncio.run(cmd_login())
    elif args.command == "accounts":
        asyncio.run(cmd_accounts())
    elif args.command == "net-worth":
        asyncio.run(cmd_net_worth())
    elif args.command == "transactions":
        asyncio.run(cmd_transactions(args))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
