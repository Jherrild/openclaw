---
name: market-watch
description: Real-time financial market data and watchlist alerts
---

# Market Watch

## Overview
Provides Magnus with low-latency, token-efficient access to financial market data via Yahoo Finance (yfinance). Includes a background sentinel that polls a watchlist and fires OpenClaw interrupts when alert thresholds are breached.

## Quick Start
```bash
# All commands use the venv automatically (no activation needed)
MARKET="/home/jherrild/.openclaw/workspace/skills/market-watch"
python3 $MARKET/market.py quote AVGO,MSFT,AAPL
python3 $MARKET/market.py snapshot
python3 $MARKET/market.py watchlist list
```

## CLI Reference

### `market.py quote <symbols>`
Fetch real-time quote(s). Comma-separated symbols.
```
$ python3 market.py quote AVGO,MSFT
AVGO: $330.15 (-3.2%) | Vol: 1.2M | ▃▅▇▅▂ | Broadcom Inc.
MSFT: $412.50 (+0.8%) | Vol: 22.3M | ▅▆▇▇█ | Microsoft Corporation
```

### `market.py watchlist list`
Show all symbols and their alert thresholds.

### `market.py watchlist add <SYM> [--alert-down=N] [--alert-up=N] [--alert-price=N]`
Add a symbol with optional alert thresholds (percent or absolute price).
```
$ python3 market.py watchlist add NVDA --alert-down=5 --alert-price=900
```

### `market.py watchlist rm <SYM>`
Remove a symbol from the watchlist.

### `market.py snapshot`
Generate `market-summary.md` from the full watchlist. Token-optimized — readable in a single `read` call.

## Sentinel Daemon

### How It Works
`sentinel.py` is a polling script designed for `task-orchestrator`:
1. Reads `watchlist.json`
2. Fetches current prices via yfinance
3. Checks alert thresholds
4. Updates `market-summary.md` (always)
5. Prints alerts to stdout **only if thresholds are breached**
6. `interrupt-wrapper.sh` captures stdout → fires OpenClaw interrupt → Magnus notifies Jesten via Telegram

### De-duplication
`sentinel-state.json` tracks which alerts have already fired today (resets at midnight UTC) to prevent spam.

### Register with Task Orchestrator
```bash
node /home/jherrild/.openclaw/workspace/skills/task-orchestrator/orchestrator.js add \
  market-sentinel \
  /home/jherrild/.openclaw/workspace/skills/market-watch/sentinel.sh \
  --interval=5m \
  --interrupt="alert: Market alert triggered. Read skills/market-watch/market-summary.md for details and notify Jesten via Telegram."
```

## Files
```
market-watch/
├── PRD.md              # Product requirements
├── SKILL.md            # This file
├── market.py           # Core CLI tool
├── sentinel.py         # Polling daemon script
├── sentinel.sh         # Shell wrapper (activates venv)
├── watchlist.json      # Persistent watchlist config
├── market-summary.md   # Auto-generated snapshot (by sentinel/snapshot)
├── sentinel-state.json # Alert de-duplication state (auto-managed)
└── .venv/              # Python virtual environment
```

## Configuration
- **watchlist.json**: Edit directly or use `market.py watchlist add/rm`.
- **Alert thresholds**: Per-symbol. `alert_down_pct` (%), `alert_up_pct` (%), `alert_price` ($).
- **Poll interval**: Set via `--interval` when registering with task-orchestrator.

## Security
- **Read-only**: No trading or transaction capabilities.
- **No API keys needed**: yfinance uses public Yahoo Finance endpoints.
- **No third-party executables**: All code authored in-house.
- **Venv isolated**: Dependencies contained in `.venv/`.

## Integration
- **Interrupt Service**: Sentinel stdout → interrupt-wrapper → interrupt-service → Telegram
- **Task Orchestrator**: Manages polling schedule via systemd timers
- **Magnus Context**: `market-summary.md` provides a token-efficient daily snapshot
