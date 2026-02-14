#!/usr/bin/env python3
"""
Magnus Market Watch — Sentinel (Daemon Script)

Designed to run via task-orchestrator. Polls the watchlist, checks alert
thresholds, and prints triggered alerts to stdout. The interrupt-wrapper.sh
will capture stdout and fire an OpenClaw interrupt if non-empty.

Exit 0 + stdout → interrupt fires.
Exit 0 + no stdout → silence (normal).
"""
import sys
import os
import json
from datetime import datetime, timezone
from pathlib import Path

# Activate venv
SKILL_DIR = Path(__file__).resolve().parent
VENV_SITE = SKILL_DIR / ".venv" / "lib"
if VENV_SITE.exists():
    for p in sorted(VENV_SITE.iterdir()):
        sp = p / "site-packages"
        if sp.exists() and str(sp) not in sys.path:
            sys.path.insert(0, str(sp))

import yfinance as yf

WATCHLIST_PATH = SKILL_DIR / "watchlist.json"
SUMMARY_PATH = SKILL_DIR / "market-summary.md"
STATE_PATH = SKILL_DIR / "sentinel-state.json"

def load_watchlist() -> dict:
    if WATCHLIST_PATH.exists():
        return json.loads(WATCHLIST_PATH.read_text())
    return {"symbols": {}, "defaults": {"poll_interval_min": 5}}

def load_state() -> dict:
    """Track which alerts have already fired today to avoid spam."""
    if STATE_PATH.exists():
        state = json.loads(STATE_PATH.read_text())
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if state.get("date") != today:
            return {"date": today, "fired": []}
        return state
    return {"date": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "fired": []}

def save_state(state: dict):
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n")

def fmt_volume(v: float) -> str:
    if v >= 1_000_000_000:
        return f"{v/1_000_000_000:.1f}B"
    if v >= 1_000_000:
        return f"{v/1_000_000:.1f}M"
    if v >= 1_000:
        return f"{v/1_000:.1f}K"
    return str(int(v))

def main():
    wl = load_watchlist()
    if not wl["symbols"]:
        sys.exit(0)

    state = load_state()
    syms = list(wl["symbols"].keys())
    tickers = yf.Tickers(" ".join(syms))
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    alerts = []
    summary_lines = [f"# Market Snapshot — {now}", ""]

    for sym in sorted(syms):
        try:
            t = tickers.tickers[sym]
            info = t.info
            price = info.get("currentPrice") or info.get("regularMarketPrice")
            prev = info.get("regularMarketPreviousClose") or info.get("previousClose")
            vol = info.get("volume") or info.get("regularMarketVolume") or 0
            name = info.get("shortName", "")

            if price is None:
                summary_lines.append(f"- {sym}: NO DATA")
                continue

            pct = ((price - prev) / prev * 100) if prev and prev != 0 else 0
            sign = "+" if pct >= 0 else ""
            summary_lines.append(f"- {sym}: ${price:.2f} ({sign}{pct:.1f}%) | Vol: {fmt_volume(vol)} | {name}")

            # Check alert thresholds
            cfg = wl["symbols"].get(sym, {})

            if cfg.get("alert_down_pct") and prev and prev != 0:
                if pct <= -abs(cfg["alert_down_pct"]):
                    key = f"{sym}_down_{cfg['alert_down_pct']}"
                    if key not in state["fired"]:
                        alerts.append(f"🔴 {sym} down {pct:.1f}% (threshold: -{cfg['alert_down_pct']}%) — ${price:.2f}")
                        state["fired"].append(key)

            if cfg.get("alert_up_pct") and prev and prev != 0:
                if pct >= abs(cfg["alert_up_pct"]):
                    key = f"{sym}_up_{cfg['alert_up_pct']}"
                    if key not in state["fired"]:
                        alerts.append(f"🟢 {sym} up +{pct:.1f}% (threshold: +{cfg['alert_up_pct']}%) — ${price:.2f}")
                        state["fired"].append(key)

            if cfg.get("alert_price") and price:
                if price >= cfg["alert_price"]:
                    key = f"{sym}_price_{cfg['alert_price']}"
                    if key not in state["fired"]:
                        alerts.append(f"⚡ {sym} hit ${price:.2f} (target: ${cfg['alert_price']})")
                        state["fired"].append(key)

        except Exception as e:
            summary_lines.append(f"- {sym}: ERROR — {e}")

    # Always update the summary file (silent)
    if alerts:
        summary_lines += ["", "## ⚠️ Triggered Alerts", ""]
        for a in alerts:
            summary_lines.append(f"- {a}")

    summary_lines.append("")
    SUMMARY_PATH.write_text("\n".join(summary_lines))
    save_state(state)

    # Only print to stdout if alerts fired — this triggers the interrupt
    if alerts:
        print(f"Market Alert ({now}):")
        for a in alerts:
            print(f"  {a}")

    sys.exit(0)

if __name__ == "__main__":
    main()
