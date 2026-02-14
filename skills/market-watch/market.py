#!/usr/bin/env python3
"""
Magnus Market Watch — Core CLI
Usage:
  market.py quote <symbols>          Get real-time quote(s), comma-separated
  market.py snapshot                 Generate market-summary.md from watchlist
  market.py watchlist list           Show current watchlist
  market.py watchlist add <sym> [--alert-down=N] [--alert-up=N] [--alert-price=N]
  market.py watchlist rm <sym>       Remove symbol from watchlist
"""
import sys
import os
import json
import argparse
from datetime import datetime, timezone
from pathlib import Path

# Activate venv if running outside it
SKILL_DIR = Path(__file__).resolve().parent
VENV_SITE = SKILL_DIR / ".venv" / "lib"
if VENV_SITE.exists():
    # Find the python version dir inside lib/
    for p in sorted(VENV_SITE.iterdir()):
        sp = p / "site-packages"
        if sp.exists() and str(sp) not in sys.path:
            sys.path.insert(0, str(sp))

import yfinance as yf

WATCHLIST_PATH = SKILL_DIR / "watchlist.json"
SUMMARY_PATH = SKILL_DIR / "market-summary.md"

# ── Watchlist I/O ──────────────────────────────────────────────────────────

def load_watchlist() -> dict:
    if WATCHLIST_PATH.exists():
        return json.loads(WATCHLIST_PATH.read_text())
    return {"symbols": {}, "defaults": {"poll_interval_min": 5}}

def save_watchlist(wl: dict):
    WATCHLIST_PATH.write_text(json.dumps(wl, indent=2) + "\n")

# ── Formatting helpers ─────────────────────────────────────────────────────

def fmt_volume(v: float) -> str:
    if v >= 1_000_000_000:
        return f"{v/1_000_000_000:.1f}B"
    if v >= 1_000_000:
        return f"{v/1_000_000:.1f}M"
    if v >= 1_000:
        return f"{v/1_000:.1f}K"
    return str(int(v))

def sparkline(hist_close) -> str:
    """Convert a short price series to a mini sparkline."""
    if hist_close is None or len(hist_close) < 2:
        return ""
    bars = "▁▂▃▄▅▆▇█"
    mn, mx = min(hist_close), max(hist_close)
    rng = mx - mn if mx != mn else 1
    return "".join(bars[min(int((v - mn) / rng * (len(bars) - 1)), len(bars) - 1)] for v in hist_close)

def quote_line(info: dict, hist_close=None) -> str:
    """Token-efficient single-line quote."""
    sym = info.get("symbol", "?")
    price = info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose")
    prev = info.get("regularMarketPreviousClose") or info.get("previousClose")
    vol = info.get("volume") or info.get("regularMarketVolume") or 0
    name = info.get("shortName", "")

    if price is None:
        return f"{sym}: NO DATA"

    pct = ((price - prev) / prev * 100) if prev and prev != 0 else 0
    sign = "+" if pct >= 0 else ""
    spark = sparkline(hist_close) if hist_close is not None else ""
    spark_part = f" | {spark}" if spark else ""

    return f"{sym}: ${price:.2f} ({sign}{pct:.1f}%) | Vol: {fmt_volume(vol)}{spark_part} | {name}"

# ── Commands ───────────────────────────────────────────────────────────────

def cmd_quote(symbols: list[str]):
    """Fetch and print compact quotes."""
    tickers = yf.Tickers(" ".join(symbols))
    for sym in symbols:
        try:
            t = tickers.tickers[sym.upper()]
            info = t.info
            # Grab last 5 closes for sparkline
            hist = t.history(period="5d", interval="1d")
            closes = list(hist["Close"].dropna()) if not hist.empty else None
            print(quote_line(info, closes))
        except Exception as e:
            print(f"{sym.upper()}: ERROR — {e}")

def cmd_watchlist_list():
    wl = load_watchlist()
    if not wl["symbols"]:
        print("Watchlist is empty.")
        return
    for sym, cfg in sorted(wl["symbols"].items()):
        parts = [sym]
        if cfg.get("alert_down_pct"):
            parts.append(f"alert-down>{cfg['alert_down_pct']}%")
        if cfg.get("alert_up_pct"):
            parts.append(f"alert-up>{cfg['alert_up_pct']}%")
        if cfg.get("alert_price"):
            parts.append(f"alert-above>${cfg['alert_price']}")
        if cfg.get("alert_below"):
            parts.append(f"alert-below>${cfg['alert_below']}")
        print(" | ".join(parts))

def cmd_watchlist_add(sym: str, alert_down: float = None, alert_up: float = None, alert_price: float = None, alert_below: float = None):
    wl = load_watchlist()
    entry = wl["symbols"].get(sym.upper(), {})
    if alert_down is not None:
        entry["alert_down_pct"] = alert_down
    if alert_up is not None:
        entry["alert_up_pct"] = alert_up
    if alert_price is not None:
        entry["alert_price"] = alert_price
    if alert_below is not None:
        entry["alert_below"] = alert_below
    wl["symbols"][sym.upper()] = entry
    save_watchlist(wl)
    print(f"Added/Updated {sym.upper()} in watchlist.")

def cmd_watchlist_rm(sym: str):
    wl = load_watchlist()
    key = sym.upper()
    if key in wl["symbols"]:
        del wl["symbols"][key]
        save_watchlist(wl)
        print(f"Removed {key} from watchlist.")
    else:
        print(f"{key} not in watchlist.")

def cmd_snapshot():
    """Generate market-summary.md from watchlist — token-optimized."""
    wl = load_watchlist()
    if not wl["symbols"]:
        print("Watchlist empty, nothing to snapshot.")
        return

    syms = list(wl["symbols"].keys())
    tickers = yf.Tickers(" ".join(syms))
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    lines = [f"# Market Snapshot — {now}", ""]
    alerts_fired = []

    for sym in sorted(syms):
        try:
            t = tickers.tickers[sym]
            info = t.info
            hist = t.history(period="5d", interval="1d")
            closes = list(hist["Close"].dropna()) if not hist.empty else None
            line = quote_line(info, closes)
            lines.append(f"- {line}")

            # Check alerts
            cfg = wl["symbols"].get(sym, {})
            price = info.get("currentPrice") or info.get("regularMarketPrice")
            prev = info.get("regularMarketPreviousClose") or info.get("previousClose")
            if price and prev and prev != 0:
                pct = (price - prev) / prev * 100
                if cfg.get("alert_down_pct") and pct <= -abs(cfg["alert_down_pct"]):
                    alerts_fired.append(f"🔴 {sym} down {pct:.1f}% (threshold: -{cfg['alert_down_pct']}%)")
                if cfg.get("alert_up_pct") and pct >= abs(cfg["alert_up_pct"]):
                    alerts_fired.append(f"🟢 {sym} up +{pct:.1f}% (threshold: +{cfg['alert_up_pct']}%)")
            if price and cfg.get("alert_price"):
                if price >= cfg["alert_price"]:
                    alerts_fired.append(f"⚡ {sym} hit ${price:.2f} (upper target: ${cfg['alert_price']})")
            if price and cfg.get("alert_below"):
                if price <= cfg["alert_below"]:
                    alerts_fired.append(f"📉 {sym} hit ${price:.2f} (lower target: ${cfg['alert_below']})")
        except Exception as e:
            lines.append(f"- {sym}: ERROR — {e}")

    if alerts_fired:
        lines += ["", "## ⚠️ Triggered Alerts", ""]
        for a in alerts_fired:
            lines.append(f"- {a}")

    lines.append("")
    SUMMARY_PATH.write_text("\n".join(lines))
    print(f"Snapshot written to {SUMMARY_PATH}")
    # Also print summary to stdout for quick read
    for l in lines:
        print(l)

# ── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Magnus Market Watch CLI")
    sub = parser.add_subparsers(dest="command")

    # quote
    p_quote = sub.add_parser("quote", help="Get real-time quote(s)")
    p_quote.add_argument("symbols", help="Comma-separated symbols (e.g. AVGO,MSFT,AAPL)")

    # snapshot
    sub.add_parser("snapshot", help="Generate market-summary.md")

    # watchlist
    p_wl = sub.add_parser("watchlist", help="Manage watchlist")
    wl_sub = p_wl.add_subparsers(dest="wl_cmd")

    wl_sub.add_parser("list", help="List watchlist")

    p_add = wl_sub.add_parser("add", help="Add symbol")
    p_add.add_argument("symbol", help="Ticker symbol")
    p_add.add_argument("--alert-down", type=float, default=None, help="Alert if down N%%")
    p_add.add_argument("--alert-up", type=float, default=None, help="Alert if up N%%")
    p_add.add_argument("--alert-price", type=float, default=None, help="Alert if price reaches N")
    p_add.add_argument("--alert-below", type=float, default=None, help="Alert if price drops below N")

    p_rm = wl_sub.add_parser("rm", help="Remove symbol")
    p_rm.add_argument("symbol", help="Ticker symbol")

    args = parser.parse_args()

    if args.command == "quote":
        syms = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
        cmd_quote(syms)
    elif args.command == "snapshot":
        cmd_snapshot()
    elif args.command == "watchlist":
        if args.wl_cmd == "list":
            cmd_watchlist_list()
        elif args.wl_cmd == "add":
            cmd_watchlist_add(args.symbol, args.alert_down, args.alert_up, args.alert_price, args.alert_below)
        elif args.wl_cmd == "rm":
            cmd_watchlist_rm(args.symbol)
        else:
            p_wl.print_help()
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
