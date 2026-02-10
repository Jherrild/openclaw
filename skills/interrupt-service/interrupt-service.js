#!/usr/bin/env node
// interrupt-service.js — Unified Interrupt Service Daemon (Phase 1)
//
// A source-agnostic daemon that receives events from collectors (HA Bridge,
// Mail Sentinel, etc.) via a local HTTP API, matches them against configured
// rules, and dispatches notifications through message or subagent pipelines.
//
// Designed to run as a systemd user service. Holds all stateful logic
// (batching timers, rate limits, circuit breakers) in memory.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SKILL_DIR = __dirname;
const RULES_FILE = path.join(SKILL_DIR, 'interrupt-rules.json');
const SETTINGS_FILE = path.join(SKILL_DIR, 'settings.json');
const LOG_FILE = path.join(SKILL_DIR, 'dispatch.log');
const OPENCLAW_BIN = '/home/jherrild/.npm-global/bin/openclaw';

// ── Default Settings ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  port: 7600,
  message:  { batch_window_ms: 2000, rate_limit_max: 10, rate_limit_window_ms: 60000 },
  subagent: { batch_window_ms: 5000, rate_limit_max: 4,  rate_limit_window_ms: 60000 },
  log_limit: 1000,
};

// ── Utility ─────────────────────────────────────────────────────────────────

function log(level, msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [interrupt-svc] [${level}] ${msg}`;
  console[level === 'error' ? 'error' : 'log'](line);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function appendLog(entry) {
  try {
    const settings = loadSettings();
    let content = '';
    if (fs.existsSync(LOG_FILE)) content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = (content + entry).split('\n');
    if (lines.length > settings.log_limit) {
      fs.writeFileSync(LOG_FILE, lines.slice(lines.length - settings.log_limit).join('\n'));
    } else {
      fs.appendFileSync(LOG_FILE, entry);
    }
  } catch (err) {
    log('error', `Failed to write dispatch log: ${err.message}`);
  }
}

// ── Settings ────────────────────────────────────────────────────────────────

function loadSettings() {
  const raw = readJson(SETTINGS_FILE, {});
  return {
    port: raw.port ?? DEFAULT_SETTINGS.port,
    message:  { ...DEFAULT_SETTINGS.message,  ...raw.message },
    subagent: { ...DEFAULT_SETTINGS.subagent, ...raw.subagent },
    log_limit: raw.log_limit ?? DEFAULT_SETTINGS.log_limit,
  };
}

// ── Rules ───────────────────────────────────────────────────────────────────

function loadRules() {
  const rules = readJson(RULES_FILE, []);
  return Array.isArray(rules) ? rules.filter(r => r.enabled !== false) : [];
}

// ── Pluggable Matchers ──────────────────────────────────────────────────────

function matchCondition(condition, eventData) {
  if (!condition || typeof condition !== 'object') return true;
  for (const [key, expected] of Object.entries(condition)) {
    const actual = eventData[key];
    if (actual === undefined) return false;
    // Wildcard/glob match for strings
    if (typeof expected === 'string' && expected.includes('*')) {
      const re = new RegExp('^' + expected.replace(/[.*+?^${}()|[\]\\]/g, m => m === '*' ? '.*' : '\\' + m) + '$');
      if (!re.test(String(actual))) return false;
    } else {
      if (String(actual) !== String(expected)) return false;
    }
  }
  return true;
}

function matchRule(rule, source, eventData) {
  if (rule.source && rule.source !== source) return false;
  return matchCondition(rule.condition, eventData);
}

// ── Pipeline State ──────────────────────────────────────────────────────────

const pipelines = {
  message:  { queue: [], timer: null, timestamps: [], circuitOpen: false },
  subagent: { queue: [], timer: null, timestamps: [], circuitOpen: false },
};

function enqueue(trigger) {
  const type = trigger.action === 'message' ? 'message' : 'subagent';
  const pipeline = pipelines[type];
  const settings = loadSettings();
  const cfg = settings[type];

  pipeline.queue.push(trigger);
  log('info', `[${type}] Queued: ${trigger.label} (source=${trigger.source})`);

  if (!pipeline.timer) {
    pipeline.timer = setTimeout(() => flushPipeline(type), cfg.batch_window_ms);
  }
}

function flushPipeline(type) {
  const pipeline = pipelines[type];
  const settings = loadSettings();
  const cfg = settings[type];
  pipeline.timer = null;
  if (pipeline.queue.length === 0) return;

  const batch = pipeline.queue.splice(0);
  log('info', `[${type}] Flushing ${batch.length} interrupt(s)`);

  // Rate limiting
  const now = Date.now();
  pipeline.timestamps = pipeline.timestamps.filter(t => now - t < cfg.rate_limit_window_ms);

  if (pipeline.timestamps.length >= cfg.rate_limit_max) {
    if (!pipeline.circuitOpen) {
      pipeline.circuitOpen = true;
      log('warn', `[${type}] CIRCUIT BREAKER OPEN — rate limit exceeded (${cfg.rate_limit_max}/${cfg.rate_limit_window_ms}ms)`);
    }
    log('warn', `[${type}] Dropped batch of ${batch.length}: ${batch.map(b => b.label).join(', ')}`);
    return;
  }

  if (pipeline.circuitOpen) {
    pipeline.circuitOpen = false;
    log('info', `[${type}] Circuit breaker closed — rate limit recovered`);
  }

  pipeline.timestamps.push(now);

  if (type === 'message') {
    dispatchMessages(batch);
  } else {
    dispatchSubagents(batch);
  }
}

// ── Dispatch: Message Pipeline ──────────────────────────────────────────────

function dispatchMessages(batch) {
  log('info', `[message] Dispatching ${batch.length} interrupt(s) via system event`);

  for (const t of batch) {
    const text = t.message || `${t.label}: ${JSON.stringify(t.data)}`;
    const args = ['system', 'event', '--text', text, '--mode', 'now'];

    log('info', `[message] Injecting: openclaw ${args.join(' ')}`);
    execFile(OPENCLAW_BIN, args, (err, stdout, stderr) => {
      const ts = new Date().toISOString();
      appendLog(`[${ts}] CMD: openclaw ${args.join(' ')}\n${stdout || ''}${stderr ? `STDERR: ${stderr}\n` : ''}---\n`);

      if (err) {
        log('error', `[message] Failed for '${t.label}': ${err.message}`);
      } else {
        log('info', `[message] Delivered: ${t.label}`);
      }
    });
  }
}

// ── Dispatch: Subagent Pipeline ─────────────────────────────────────────────

function dispatchSubagents(batch) {
  log('info', `[subagent] Dispatching ${batch.length} interrupt(s) via sub-agent`);

  const summaries = batch.map(b => {
    let s = b.message || `${b.label}: ${JSON.stringify(b.data)}`;
    if (b.instruction) s += ` [instruction: ${b.instruction}]`;
    return s;
  });

  const channel = batch[0].channel || 'telegram';
  const prompt = `You are an interrupt analysis sub-agent.

INTERRUPT DETAILS:
${summaries.join('\n')}

YOUR GOAL:
1. Analyze the interrupt(s) and any provided instructions.
2. DECIDE: Does the user need to be notified?

IF NOTIFICATION IS NEEDED:
- Send a message using: openclaw message send --channel ${channel} --message "Your message here"

IF NO NOTIFICATION IS NEEDED:
- Exit silently.

Be concise. Only notify if truly important.`;

  const args = ['agent', '--local', '--message', prompt];

  log('info', `[subagent] Spawning sub-agent for ${batch.length} interrupt(s)`);
  execFile(OPENCLAW_BIN, args, { timeout: 120000 }, (err, stdout, stderr) => {
    const ts = new Date().toISOString();
    appendLog(`[${ts}] SUBAGENT: ${batch.map(b => b.label).join(', ')}\n${stdout || ''}${stderr ? `STDERR: ${stderr}\n` : ''}---\n`);

    if (err) {
      log('error', `[subagent] Failed: ${err.message}`);
    } else {
      log('info', `[subagent] Completed for ${batch.length} interrupt(s)`);
    }
  });
}

// ── Trigger Processing ──────────────────────────────────────────────────────

function processTrigger(source, data, level) {
  const rules = loadRules();
  const matched = rules.filter(r => matchRule(r, source, data));

  if (matched.length === 0) {
    // No matching rule — use default action based on level
    if (level === 'alert' || level === 'warn') {
      enqueue({
        id: `auto-${Date.now()}`,
        label: `${source}/${level}`,
        source,
        data,
        action: level === 'alert' ? 'subagent' : 'message',
        message: data.message || data.text || `[${source}] ${level}: ${JSON.stringify(data)}`,
        level,
      });
      return { status: 'queued', matched: 0, defaultAction: true };
    }
    return { status: 'ignored', matched: 0, reason: 'no matching rules' };
  }

  for (const rule of matched) {
    let msg = rule.message || data.message || `${rule.id}: event from ${source}`;
    // Interpolate placeholders from eventData
    msg = msg.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? `{{${key}}}`);

    enqueue({
      id: rule.id,
      label: rule.label || rule.id,
      source,
      data,
      action: rule.action || 'message',
      message: msg,
      instruction: rule.instruction || null,
      channel: rule.channel || 'telegram',
      level,
    });
  }

  return { status: 'queued', matched: matched.length };
}

// ── Stats ───────────────────────────────────────────────────────────────────

function getStats() {
  const settings = loadSettings();
  const now = Date.now();
  const pipelineStats = (type) => {
    const p = pipelines[type];
    const cfg = settings[type];
    return {
      batchPending: p.queue.length,
      dispatchesInWindow: p.timestamps.filter(t => now - t < cfg.rate_limit_window_ms).length,
      circuitOpen: p.circuitOpen,
      settings: cfg,
    };
  };
  return {
    rules: loadRules().length,
    message: pipelineStats('message'),
    subagent: pipelineStats('subagent'),
    uptime: process.uptime(),
  };
}

// ── HTTP Server ─────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function startServer() {
  const settings = loadSettings();
  const port = settings.port;

  const server = http.createServer(async (req, res) => {
    const sendJson = (code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data) + '\n');
    };

    try {
      // POST /trigger — main API
      if (req.method === 'POST' && req.url === '/trigger') {
        const body = await parseBody(req);
        const { source, data, level } = body;
        if (!source) return sendJson(400, { error: 'Missing required field: source' });
        const result = processTrigger(source, data || {}, level || 'info');
        return sendJson(200, result);
      }

      // GET /stats — health/status
      if (req.method === 'GET' && req.url === '/stats') {
        return sendJson(200, getStats());
      }

      // GET /health — simple liveness check
      if (req.method === 'GET' && req.url === '/health') {
        return sendJson(200, { status: 'ok', pid: process.pid });
      }

      // POST /reload — reload rules from disk
      if (req.method === 'POST' && req.url === '/reload') {
        const rules = loadRules();
        log('info', `Rules reloaded: ${rules.length} active rule(s)`);
        return sendJson(200, { status: 'reloaded', rules: rules.length });
      }

      sendJson(404, { error: 'Not found' });
    } catch (err) {
      log('error', `HTTP error: ${err.message}`);
      sendJson(500, { error: err.message });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    log('info', `Interrupt Service listening on http://127.0.0.1:${port}`);
    log('info', `Loaded ${loadRules().length} active rule(s)`);
  });

  // Graceful shutdown
  const shutdown = (signal) => {
    log('info', `Received ${signal}, shutting down...`);
    for (const p of Object.values(pipelines)) {
      if (p.timer) { clearTimeout(p.timer); p.timer = null; }
    }
    server.close(() => {
      log('info', 'Server closed');
      process.exit(0);
    });
    // Force exit after 5s
    setTimeout(() => process.exit(1), 5000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// ── Main ────────────────────────────────────────────────────────────────────

startServer();
