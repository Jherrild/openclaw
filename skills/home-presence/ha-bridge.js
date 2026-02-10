#!/usr/bin/env node
// ha-bridge.js — Persistent WebSocket bridge from Home Assistant to OpenClaw.
// Subscribes to state_changed events and routes them to multiple rolling JSONL
// logs based on dynamic domain/pattern filters. Agent-waking is reserved for
// high-priority entities listed in WAKE_ON_ENTITIES (currently empty).

const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

// ── Configuration ──────────────────────────────────────────────────────────────

const HA_WS_URL = process.env.HA_WS_URL || 'ws://homeassistant:8123/api/websocket';

const TOKEN = process.env.HA_TOKEN || (() => {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'mcporter.json'), 'utf8')
    );
    const bearerArg = cfg.mcpServers['ha-stdio-final'].args
      .find(a => typeof a === 'string' && a.startsWith('Bearer '));
    return bearerArg ? bearerArg.replace('Bearer ', '').trim() : null;
  } catch { return null; }
})();

if (!TOKEN) {
  console.error('FATAL: Could not resolve HA token. Set HA_TOKEN env var or ensure config/mcporter.json is valid.');
  process.exit(1);
}

// ── Dynamic Watchlist (synced from interrupt-service) ────────────────────────
// Replaces the old hardcoded WAKE_ON_ENTITIES. Periodically fetches the list
// of watched entity_ids from the interrupt-service's active ha.state_change
// rules. Entities in this set are forwarded to the interrupt-service on change.
const WATCHLIST = new Set();
const WATCHLIST_SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes (fallback; push is primary)
let watchlistSyncTimer = null;

function syncWatchlist() {
  const opts = {
    hostname: '127.0.0.1',
    port: INTERRUPT_SERVICE_PORT,
    path: '/rules/ha-entities',
    method: 'GET',
    timeout: 5000,
  };

  const req = http.request(opts, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      if (res.statusCode !== 200) {
        log('error', `[watchlist] Sync failed — HTTP ${res.statusCode}: ${body}`);
        return;
      }
      try {
        const { entities } = JSON.parse(body);
        if (!Array.isArray(entities)) throw new Error('Expected entities array');
        const prev = new Set(WATCHLIST);
        WATCHLIST.clear();
        for (const e of entities) WATCHLIST.add(e);
        const added = entities.filter(e => !prev.has(e));
        const removed = [...prev].filter(e => !WATCHLIST.has(e));
        if (added.length || removed.length) {
          log('info', `[watchlist] Updated: ${WATCHLIST.size} entities (added=${added.length}, removed=${removed.length})`);
        } else {
          log('info', `[watchlist] Synced — ${WATCHLIST.size} entities (no changes)`);
        }
      } catch (err) {
        log('error', `[watchlist] Failed to parse response: ${err.message}`);
      }
    });
  });

  req.on('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
      log('error', '[watchlist] interrupt-service not running — will retry next cycle');
    } else {
      log('error', `[watchlist] Sync error: ${err.message}`);
    }
  });

  req.on('timeout', () => { req.destroy(); });
  req.end();
}

function startWatchlistSync() {
  // Immediate sync on startup
  syncWatchlist();
  // Periodic sync every 15 minutes (safety net; push is primary)
  watchlistSyncTimer = setInterval(syncWatchlist, WATCHLIST_SYNC_INTERVAL_MS);
}

// SIGUSR2 — manual watchlist sync trigger
process.on('SIGUSR2', () => {
  log('info', '[watchlist] SIGUSR2 received — forcing immediate sync');
  syncWatchlist();
});

// ── Dynamic Entity Filter / Router ──────────────────────────────────────────
// Each tier defines regex patterns matched against entity_id. An event is
// routed to the FIRST tier whose pattern matches. The final 'raw' tier is the
// catch-all for everything not matched above (minus noisy exclusions).

const NOISY_EXCLUSIONS = /^(sun\.|sensor\..*uptime|sensor\..*last_boot)/;

const LOG_TIERS = [
  {
    name: 'presence',
    file: 'presence-log.jsonl',
    patterns: [
      /^person\./,
      /^binary_sensor\..*occupancy/,
      /^binary_sensor\..*motion/,
      /^binary_sensor\..*presence/,
    ],
  },
  {
    name: 'lighting',
    file: 'lighting-log.jsonl',
    patterns: [
      /^light\./,
    ],
  },
  {
    name: 'climate',
    file: 'climate-log.jsonl',
    patterns: [
      /^climate\./,
      /^sensor\..*temperature/,
      /^sensor\..*humidity/,
      /^sensor\..*co2/,
      /^switch\..*heater/,
      /^switch\..*fan/,
    ],
  },
  {
    name: 'automation',
    file: 'automation-log.jsonl',
    patterns: [
      /^automation\./,
      /^script\./,
    ],
  },
  {
    name: 'raw',
    file: 'home-status-raw.jsonl',
    // Catch-all — no patterns means "everything else"
    patterns: [],
  },
];

// Pre-compile a lookup: returns the tier for a given entity_id
function classifyEntity(entityId) {
  for (const tier of LOG_TIERS) {
    if (tier.patterns.length === 0) continue; // skip catch-all during matching
    for (const re of tier.patterns) {
      if (re.test(entityId)) return tier;
    }
  }
  // Catch-all: 'raw' tier (last entry), but exclude noisy entities
  if (NOISY_EXCLUSIONS.test(entityId)) return null;
  return LOG_TIERS[LOG_TIERS.length - 1];
}

// Legacy entity-to-area map for human-readable presence events
const ENTITY_AREA = {
  'binary_sensor.everything_presence_lite_5c0db4_occupancy': 'Kitchen',
  'binary_sensor.everything_presence_lite_4f1008_occupancy': 'Office',
  'binary_sensor.everything_presence_lite_5c0d08_occupancy': 'Gym',
  'binary_sensor.everything_presence_lite_5c0da4_occupancy': 'Bedroom',
  'binary_sensor.everything_presence_lite_ab20a4_occupancy': 'Basement',
  'binary_sensor.front_door_motion': 'Front Yard',
  'person.jesten': null,
  'person.april_jane': null,
};

// ── Rolling JSONL Log Configuration ─────────────────────────────────────────

const LOG_MAX_LINES = 5000;
// After a trim we keep this many lines so we don't trim on every single write
const LOG_TRIM_TO  = 4000;

// Reconnection parameters (exponential backoff)
const RECONNECT_BASE_MS  = 1000;
const RECONNECT_MAX_MS   = 60000;
const RECONNECT_FACTOR   = 2;
const PING_INTERVAL_MS   = 30000;
const PONG_TIMEOUT_MS    = 10000;

// ── State ──────────────────────────────────────────────────────────────────────

let ws = null;
let msgId = 0;
let reconnectDelay = RECONNECT_BASE_MS;
let reconnectTimer = null;
let pingTimer = null;
let pongTimer = null;
let shuttingDown = false;

// ── Debug Entity Dump (SIGUSR1) ─────────────────────────────────────────────
// Send SIGUSR1 to dump ALL incoming entity IDs to debug-entities.log for 30s.
let debugDumpActive = false;
let debugDumpTimer = null;
const DEBUG_DUMP_FILE = path.join(__dirname, 'debug-entities.log');
const DEBUG_DUMP_DURATION_MS = 30000;

process.on('SIGUSR1', () => {
  if (debugDumpActive) {
    log('info', '[DEBUG] Debug dump already active — ignoring SIGUSR1');
    return;
  }
  debugDumpActive = true;
  const header = `\n=== DEBUG ENTITY DUMP STARTED ${new Date().toISOString()} (${DEBUG_DUMP_DURATION_MS / 1000}s) ===\n`;
  try { fs.appendFileSync(DEBUG_DUMP_FILE, header); } catch {}
  log('info', `[DEBUG] Entity dump started — writing ALL entity IDs to ${DEBUG_DUMP_FILE} for ${DEBUG_DUMP_DURATION_MS / 1000}s`);
  debugDumpTimer = setTimeout(() => {
    debugDumpActive = false;
    debugDumpTimer = null;
    const footer = `=== DEBUG ENTITY DUMP ENDED ${new Date().toISOString()} ===\n`;
    try { fs.appendFileSync(DEBUG_DUMP_FILE, footer); } catch {}
    log('info', '[DEBUG] Entity dump ended');
  }, DEBUG_DUMP_DURATION_MS);
});

// ── Interrupt Service Client ────────────────────────────────────────────────
const INTERRUPT_SERVICE_PORT = 7600;
const HA_BRIDGE_HTTP_PORT = 7601;

/**
 * Forward an event to the central interrupt-service via HTTP POST /trigger.
 * Fire-and-forget — errors are logged but never block the bridge.
 */
function triggerInterrupt(source, data, level = 'info') {
  const payload = JSON.stringify({ source, data, level });
  const opts = {
    hostname: '127.0.0.1',
    port: INTERRUPT_SERVICE_PORT,
    path: '/trigger',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    timeout: 5000,
  };

  const req = http.request(opts, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      if (res.statusCode !== 200) {
        log('error', `[interrupt] Service returned ${res.statusCode}: ${body}`);
      }
    });
  });

  req.on('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
      log('error', `[interrupt] Service not running on port ${INTERRUPT_SERVICE_PORT}`);
    } else {
      log('error', `[interrupt] Request failed: ${err.message}`);
    }
  });

  req.on('timeout', () => { req.destroy(); });
  req.write(payload);
  req.end();
}

// Per-file line counts, lazy-initialized on first write
const _lineCounts = {};

// ── Logging ────────────────────────────────────────────────────────────────────

function log(level, ...args) {
  const ts = new Date().toISOString();
  console[level === 'error' ? 'error' : 'log'](`[${ts}] [ha-bridge] [${level}]`, ...args);
}

// ── Rolling JSONL log writer (generic, per-file) ────────────────────────────

function countLines(filePath) {
  try {
    const buf = fs.readFileSync(filePath, 'utf8');
    if (!buf) return 0;
    let n = 0;
    for (let i = 0; i < buf.length; i++) { if (buf[i] === '\n') n++; }
    return n;
  } catch { return 0; }
}

function trimLog(filePath) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= LOG_MAX_LINES) return;
    const kept = lines.slice(lines.length - LOG_TRIM_TO);
    fs.writeFileSync(filePath, kept.join('\n') + '\n');
    _lineCounts[filePath] = kept.length;
    log('info', `Trimmed ${path.basename(filePath)} from ${lines.length} to ${kept.length} lines`);
  } catch (err) {
    log('error', `Failed to trim ${path.basename(filePath)}: ${err.message}`);
  }
}

function appendLog(filePath, entry) {
  const line = JSON.stringify(entry) + '\n';
  try {
    fs.appendFileSync(filePath, line);
    if (_lineCounts[filePath] === undefined) _lineCounts[filePath] = countLines(filePath);
    else _lineCounts[filePath]++;
    if (_lineCounts[filePath] > LOG_MAX_LINES) trimLog(filePath);
  } catch (err) {
    log('error', `Failed to write ${path.basename(filePath)}: ${err.message}`);
  }
}

// ── Format a state_changed event into a concise event string ───────────────────

function formatStateChange(entityId, oldState, newState) {
  const area = ENTITY_AREA[entityId];

  if (entityId.startsWith('person.')) {
    const name = entityId.replace('person.', '').replace(/_/g, ' ');
    const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
    return `home-presence: ${capitalize(name)} is now ${newState} (was ${oldState})`;
  }

  if (entityId.includes('occupancy')) {
    const status = newState === 'on' ? 'occupied' : 'vacant';
    return `home-presence: ${area || entityId} is now ${status}`;
  }

  if (entityId.includes('motion')) {
    const status = newState === 'on' ? 'motion detected' : 'motion cleared';
    return `home-presence: ${area || entityId} — ${status}`;
  }

  return `home-presence: ${entityId} changed to ${newState} (was ${oldState})`;
}

// ── WebSocket lifecycle ────────────────────────────────────────────────────────

function nextId() { return ++msgId; }

function clearTimers() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function scheduleReconnect() {
  if (shuttingDown) return;
  clearTimers();
  log('info', `Reconnecting in ${reconnectDelay}ms...`);
  reconnectTimer = setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * RECONNECT_FACTOR, RECONNECT_MAX_MS);
    connect();
  }, reconnectDelay);
}

function startPingLoop() {
  pingTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const id = nextId();
    ws.send(JSON.stringify({ id, type: 'ping' }));
    pongTimer = setTimeout(() => {
      log('error', 'Pong timeout — closing socket');
      if (ws) ws.terminate();
    }, PONG_TIMEOUT_MS);
  }, PING_INTERVAL_MS);
}

function connect() {
  if (shuttingDown) return;
  clearTimers();

  log('info', `Connecting to ${HA_WS_URL}`);
  ws = new WebSocket(HA_WS_URL);

  ws.on('open', () => {
    log('info', 'WebSocket connected');
    // Reset backoff on successful connection
    reconnectDelay = RECONNECT_BASE_MS;
  });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'auth_required':
        log('info', 'Authenticating...');
        ws.send(JSON.stringify({ type: 'auth', access_token: TOKEN }));
        break;

      case 'auth_ok':
        log('info', 'Authenticated — subscribing to state_changed events');
        ws.send(JSON.stringify({
          id: nextId(),
          type: 'subscribe_events',
          event_type: 'state_changed',
        }));
        ws.send(JSON.stringify({
          id: nextId(),
          type: 'subscribe_events',
          event_type: 'magnus_voice_command',
        }));
        startPingLoop();
        break;

      case 'auth_invalid':
        log('error', `Authentication failed: ${msg.message}`);
        shuttingDown = true;
        ws.close();
        process.exit(1);
        break;

      case 'event': {
        // Handle custom voice command events
        if (msg.event.event_type === 'magnus_voice_command') {
          const data = msg.event.data;
          const message = data && data.message ? data.message : '';
          if (message) {
            log('info', `[voice] Received voice command: "${message}"`);
            triggerInterrupt('ha.voice_command', { message }, 'alert');
          }
          break;
        }

        const data = msg.event && msg.event.data;
        if (!data || !data.entity_id) break;

        // Debug dump: log ALL entity IDs before any filtering
        if (debugDumpActive) {
          const oldDbg = data.old_state ? data.old_state.state : '?';
          const newDbg = data.new_state ? data.new_state.state : '?';
          const line = `${new Date().toISOString()} ${data.entity_id} ${oldDbg} → ${newDbg}\n`;
          try { fs.appendFileSync(DEBUG_DUMP_FILE, line); } catch {}
        }

        const oldState = data.old_state ? data.old_state.state : 'unknown';
        const newState = data.new_state ? data.new_state.state : 'unknown';
        if (oldState === newState) break; // no actual state change

        const tier = classifyEntity(data.entity_id);
        if (!tier) break; // excluded (noisy entity)

        const logPath = path.join(__dirname, tier.file);
        const eventText = formatStateChange(data.entity_id, oldState, newState);

        const entry = {
          ts: new Date().toISOString(),
          entity_id: data.entity_id,
          domain: data.entity_id.split('.')[0],
          area: ENTITY_AREA[data.entity_id] || (data.new_state && data.new_state.attributes && data.new_state.attributes.friendly_name) || null,
          old_state: oldState,
          new_state: newState,
          summary: eventText,
        };

        appendLog(logPath, entry);
        log('info', `[${tier.name}] ${eventText}`);

        // Forward watched entities to interrupt service
        if (WATCHLIST.has(data.entity_id)) {
          triggerInterrupt('ha.state_change', {
            entity_id: data.entity_id,
            old_state: oldState,
            new_state: newState,
            summary: eventText,
          }, 'alert');
        }

        break;
      }

      case 'pong':
        if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
        break;

      case 'result':
        if (!msg.success) {
          log('error', `Command ${msg.id} failed:`, msg.error);
        }
        break;
    }
  });

  ws.on('error', (err) => {
    log('error', `WebSocket error: ${err.message}`);
  });

  ws.on('close', (code, reason) => {
    log('info', `WebSocket closed (code=${code}, reason=${reason || 'none'})`);
    clearTimers();
    ws = null;
    scheduleReconnect();
  });
}

// ── HTTP Server (collector push endpoint) ───────────────────────────────────

let httpServer = null;

function startHttpServer() {
  httpServer = http.createServer((req, res) => {
    const sendJson = (code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data) + '\n');
    };

    if (req.method === 'POST' && req.url === '/watchlist') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { entities } = JSON.parse(body);
          if (!Array.isArray(entities)) return sendJson(400, { error: 'Expected entities array' });

          const prev = new Set(WATCHLIST);
          WATCHLIST.clear();
          for (const e of entities) WATCHLIST.add(e);
          const added = entities.filter(e => !prev.has(e));
          const removed = [...prev].filter(e => !WATCHLIST.has(e));
          log('info', `[watchlist] Push received: ${WATCHLIST.size} entities (added=${added.length}, removed=${removed.length})`);
          sendJson(200, { status: 'ok', entities: WATCHLIST.size });
        } catch (err) {
          sendJson(400, { error: `Invalid JSON: ${err.message}` });
        }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(200, { status: 'ok', watchlist_size: WATCHLIST.size });
    }

    sendJson(404, { error: 'Not found' });
  });

  httpServer.listen(HA_BRIDGE_HTTP_PORT, '127.0.0.1', () => {
    log('info', `[http] Listening on http://127.0.0.1:${HA_BRIDGE_HTTP_PORT}`);
  });
}

// ── Process guard (singleton via pgrep, filtering out vscode) ──────────────────

function checkAlreadyRunning() {
  const { execSync } = require('child_process');
  try {
    // Find ha-bridge.js processes, exclude this PID
    const output = execSync(
      `pgrep -f 'node.*ha-bridge\\.js' | grep -v '^${process.pid}$' || true`,
      { encoding: 'utf8' }
    ).trim();

    if (!output) return false;

    // Filter out vscode and copilot CLI processes (common false positives
    // where 'ha-bridge.js' appears as a substring in their arguments)
    const pids = output.split('\n').filter(pid => {
      if (!pid) return false;
      try {
        const cmdline = execSync(`cat /proc/${pid}/cmdline 2>/dev/null || true`, { encoding: 'utf8' });
        if (cmdline.includes('vscode') || cmdline.includes('.vscode')) return false;
        if (cmdline.includes('copilot')) return false;
        return true;
      } catch { return false; }
    });

    return pids.length > 0;
  } catch { return false; }
}

// ── Main ───────────────────────────────────────────────────────────────────────

if (checkAlreadyRunning()) {
  log('info', 'Another ha-bridge instance is already running. Exiting.');
  process.exit(0);
}

log('info', 'Starting HA WebSocket bridge');
log('info', `Log tiers: ${LOG_TIERS.map(t => t.name).join(', ')}`);
log('info', `All logs capped at ${LOG_MAX_LINES} lines, stored in ${__dirname}`);
log('info', `Interrupt forwarding via interrupt-service on port ${INTERRUPT_SERVICE_PORT}`);
log('info', 'Watchlist mode: push-primary (fallback poll every 15m, SIGUSR2 to force sync)');

startHttpServer();
startWatchlistSync();
connect();

// Graceful shutdown
function shutdown(signal) {
  log('info', `Received ${signal} — shutting down`);
  shuttingDown = true;
  clearTimers();
  if (watchlistSyncTimer) { clearInterval(watchlistSyncTimer); watchlistSyncTimer = null; }
  if (debugDumpTimer) { clearTimeout(debugDumpTimer); debugDumpTimer = null; }
  if (httpServer) { httpServer.close(); httpServer = null; }
  if (ws) {
    ws.close();
    ws = null;
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Keep the process alive
process.on('uncaughtException', (err) => {
  log('error', `Uncaught exception: ${err.message}`);
  log('error', err.stack);
  // Don't crash — the reconnect logic will handle socket issues
});

process.on('unhandledRejection', (reason) => {
  log('error', `Unhandled rejection: ${reason}`);
});
