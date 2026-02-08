#!/usr/bin/env node
// ha-bridge.js — Persistent WebSocket bridge from Home Assistant to OpenClaw.
// Subscribes to state_changed events for presence-related entities and writes
// them to a rolling JSONL log. Agent-waking is reserved for high-priority
// entities listed in WAKE_ON_ENTITIES (currently empty — add entities there
// to re-enable direct agent interrupts in the future).

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
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

// Entities we care about — occupancy sensors, motion sensors, person entities
const WATCHED_ENTITIES = new Set([
  // Person entities
  'person.jesten',
  'person.april_jane',
  // mmWave occupancy sensors
  'binary_sensor.everything_presence_lite_5c0db4_occupancy', // Kitchen
  'binary_sensor.everything_presence_lite_4f1008_occupancy', // Office
  'binary_sensor.everything_presence_lite_5c0d08_occupancy', // Gym
  'binary_sensor.everything_presence_lite_5c0da4_occupancy', // Bedroom
  'binary_sensor.everything_presence_lite_ab20a4_occupancy', // Basement
  // Motion sensors
  'binary_sensor.front_door_motion',
]);

// Entity-to-area map for human-readable events
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

// ── High-Priority Wake Configuration ────────────────────────────────────────
// Entities listed here will ALSO fire an `openclaw system event` to wake the
// agent immediately. Leave empty to run in fully passive / log-only mode.
// Example: ['person.jesten', 'binary_sensor.front_door_motion']
const WAKE_ON_ENTITIES = new Set([
  // (none — add entity IDs here to enable direct agent interrupts)
]);

// ── Rolling JSONL Log Configuration ─────────────────────────────────────────

const PRESENCE_LOG_PATH = path.join(__dirname, 'presence-log.jsonl');
const PRESENCE_LOG_MAX_LINES = 5000;
// After a trim we keep this many lines so we don't trim on every single write
const PRESENCE_LOG_TRIM_TO  = 4000;

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

// ── Logging ────────────────────────────────────────────────────────────────────

function log(level, ...args) {
  const ts = new Date().toISOString();
  console[level === 'error' ? 'error' : 'log'](`[${ts}] [ha-bridge] [${level}]`, ...args);
}

// ── Rolling JSONL log writer ────────────────────────────────────────────────

let _lineCount = null; // lazy-initialized on first write

function countLines(filePath) {
  try {
    const buf = fs.readFileSync(filePath, 'utf8');
    if (!buf) return 0;
    // Count newlines; every JSONL entry ends with \n
    let n = 0;
    for (let i = 0; i < buf.length; i++) { if (buf[i] === '\n') n++; }
    return n;
  } catch { return 0; }
}

function trimLog() {
  try {
    const lines = fs.readFileSync(PRESENCE_LOG_PATH, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= PRESENCE_LOG_MAX_LINES) return;
    const kept = lines.slice(lines.length - PRESENCE_LOG_TRIM_TO);
    fs.writeFileSync(PRESENCE_LOG_PATH, kept.join('\n') + '\n');
    _lineCount = kept.length;
    log('info', `Trimmed presence log from ${lines.length} to ${kept.length} lines`);
  } catch (err) {
    log('error', `Failed to trim presence log: ${err.message}`);
  }
}

function appendPresenceLog(entry) {
  const line = JSON.stringify(entry) + '\n';
  try {
    fs.appendFileSync(PRESENCE_LOG_PATH, line);
    if (_lineCount === null) _lineCount = countLines(PRESENCE_LOG_PATH);
    else _lineCount++;
    if (_lineCount > PRESENCE_LOG_MAX_LINES) trimLog();
  } catch (err) {
    log('error', `Failed to write presence log: ${err.message}`);
  }
}

// ── Push event to Magnus via openclaw system event (high-priority only) ─────

function pushToMagnus(text) {
  log('info', `[WAKE] Pushing high-priority event: ${text}`);
  execFile('openclaw', ['system', 'event', '--text', text, '--mode', 'now'], (err, stdout, stderr) => {
    if (err) {
      log('error', `openclaw system event failed: ${err.message}`);
      if (stderr) log('error', `  stderr: ${stderr.trim()}`);
    }
  });
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
        startPingLoop();
        break;

      case 'auth_invalid':
        log('error', `Authentication failed: ${msg.message}`);
        shuttingDown = true;
        ws.close();
        process.exit(1);
        break;

      case 'event': {
        const data = msg.event && msg.event.data;
        if (!data || !data.entity_id) break;
        if (!WATCHED_ENTITIES.has(data.entity_id)) break;

        const oldState = data.old_state ? data.old_state.state : 'unknown';
        const newState = data.new_state ? data.new_state.state : 'unknown';
        if (oldState === newState) break; // no actual state change

        const eventText = formatStateChange(data.entity_id, oldState, newState);

        // Always write to rolling JSONL log
        appendPresenceLog({
          ts: new Date().toISOString(),
          entity_id: data.entity_id,
          area: ENTITY_AREA[data.entity_id] || null,
          old_state: oldState,
          new_state: newState,
          summary: eventText,
        });
        log('info', `Logged: ${eventText}`);

        // Only wake the agent for high-priority entities
        if (WAKE_ON_ENTITIES.has(data.entity_id)) {
          pushToMagnus(eventText);
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

// ── Process guard (singleton via pgrep, filtering out vscode) ──────────────────

function checkAlreadyRunning() {
  const { execSync } = require('child_process');
  try {
    // Find ha-bridge.js processes, exclude this PID and any vscode-related processes
    const output = execSync(
      `pgrep -f 'node.*ha-bridge\\.js' | grep -v '^${process.pid}$' || true`,
      { encoding: 'utf8' }
    ).trim();

    if (!output) return false;

    // Filter out vscode server processes (common false positives)
    const pids = output.split('\n').filter(pid => {
      if (!pid) return false;
      try {
        const cmdline = execSync(`cat /proc/${pid}/cmdline 2>/dev/null || true`, { encoding: 'utf8' });
        return !cmdline.includes('vscode') && !cmdline.includes('.vscode');
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
log('info', `Watching ${WATCHED_ENTITIES.size} entities`);
log('info', `Logging to ${PRESENCE_LOG_PATH} (max ${PRESENCE_LOG_MAX_LINES} lines)`);
log('info', WAKE_ON_ENTITIES.size > 0
  ? `Wake-on entities: ${[...WAKE_ON_ENTITIES].join(', ')}`
  : 'Running in passive log-only mode (no agent interrupts)');

connect();

// Graceful shutdown
function shutdown(signal) {
  log('info', `Received ${signal} — shutting down`);
  shuttingDown = true;
  clearTimers();
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
