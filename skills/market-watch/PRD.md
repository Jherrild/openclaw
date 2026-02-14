# PRD: Magnus Market Watch (Real-Time Financial Intelligence)

## Vision
To provide Magnus with low-latency, token-efficient, and secure access to financial market data. This tool replaces unreliable web searches with direct API queries and provides a background monitoring system for a user-defined watchlist.

## Core Requirements

### 1. Real-Time Data Access (The "Pulse" Tool)
- **CLI/MCP Interface:** A tool Magnus can call (e.g., `market.js quote <symbol>`) to get instant price, volume, and % change.
- **Token Efficiency:** Output MUST be formatted as a single line or a compact JSON object (e.g., `AVGO: $330.15 (-3.2%) | Vol: 1.2M | 5m-Trend: UP`).
- **Data Source:** Use a reliable, free-tier-friendly API (e.g., Yahoo Finance/yfinance or Alpha Vantage).

### 2. Market Watchdog (The "Sentinel" Daemon)
- **Watchlist:** A persistent configuration file (`watchlist.json`) where Jesten can add symbols and alert thresholds.
- **Background Tracking:** A lightweight systemd service (or cron-compatible script) that polls the watchlist at a configurable interval (e.g., every 5 minutes during market hours).
- **Proactive Alerts:** If a stock hits a threshold (e.g., "Down > 5%" or "Breaks $340"), the daemon should trigger an **OpenClaw Interrupt** to wake Magnus and notify Jesten via Telegram.

### 3. "The Snapshot" (Token-Optimized Context)
- **Daily Summary:** A single file `market-summary.md` that is updated by the daemon and can be read by Magnus in one `read` call.
- **Content:** Current status of all watchlist items, top movers, and any triggered alerts in the last 24h.

## Security & Privacy
- **No Third-Party Executables:** All code must be authored by Copilot/Magnus (Node.js or Python).
- **Secret Management:** API keys must be stored in `.env` or retrieved via 1Password (`op` CLI).
- **Read-Only:** The tool should have NO trading or transaction capabilities.

## Potential Extras (Proposed by Copilot)
- **Correlation Engine:** Ability for Magnus to ask "Why is X falling?" and the tool returns a mini-heatmap of the *sector* (e.g., "Semiconductors are all down 2%").
- **Option Sentiment Snap:** A quick look at Put/Call ratios to detect "Stop-Loss Cascades" like the one seen today.
- **Obsidian Integration:** Auto-log a "Daily Close" for the watchlist into Jesten's Obsidian PARA vault under `2-Areas/Finance/Market Logs/`.
- **Chart-to-Text:** Convert basic price action into a Sparkline (e.g., `[▬▬▬_▬]`) for quick visual context in the chat.

## Implementation Steps (Magnus to Delegate)
1.  **Draft Implementation:** Build the core `market.js` or `market.py` CLI.
2.  **Alert Logic:** Integrate with the existing `interrupt-service` skill.
3.  **Daemonization:** Use the `task-orchestrator` skill to manage the polling service.
