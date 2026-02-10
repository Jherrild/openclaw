#!/usr/bin/env node
// interrupt-service.js — Unified Interrupt Service Daemon (Phase 2)
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
const { execFile, execFileSync } = require('child_process');

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
  file_poll_ms: 2000,
  default_channel: 'telegram',
  collectors: {},
};

// ── In-memory rules cache (for _pending flag tracking) ──────────────────────

let rulesCache = null;

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
    file_poll_ms: raw.file_poll_ms ?? DEFAULT_SETTINGS.file_poll_ms,
    default_channel: raw.default_channel ?? DEFAULT_SETTINGS.default_channel,
    validators: raw.validators || {},
    collectors: raw.collectors || {},
  };
}

function saveSettings(settings) {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      fs.copyFileSync(SETTINGS_FILE, SETTINGS_FILE + '.bak');
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
    log('info', 'Settings saved to disk');
  } catch (err) {
    log('error', `Failed to save settings: ${err.message}`);
    throw err;
  }
}

// ── Collector Push ──────────────────────────────────────────────────────────

async function notifyCollector(source) {
  const settings = loadSettings();
  const collectorUrl = settings.collectors[source];
  if (!collectorUrl) return { ok: true };

  // Build watchlist: unique entity_ids from active rules matching this source
  const rules = loadRules();
  const entities = [...new Set(
    rules
      .filter(r => r.source === source && r.condition && r.condition.entity_id)
      .map(r => r.condition.entity_id)
  )];

  const payload = JSON.stringify({ entities });

  return new Promise((resolve) => {
    let url;
    try { url = new URL('/watchlist', collectorUrl); } catch (err) {
      return resolve({ ok: false, error: `Invalid collector URL: ${err.message}` });
    }

    const opts = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 5000,
    };

    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          log('info', `[collector] Push to ${source} succeeded: ${body}`);
          resolve({ ok: true });
        } else {
          resolve({ ok: false, error: `Collector returned HTTP ${res.statusCode}: ${body}` });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ ok: false, error: `Collector unreachable: ${err.message}` });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Collector push timed out (5s)' });
    });

    req.write(payload);
    req.end();
  });
}

// ── Channel Resolution ──────────────────────────────────────────────────────

function resolveChannel(channel) {
  if (!channel || channel === 'default') {
    return loadSettings().default_channel;
  }
  return channel;
}

// ── Rule Validation ─────────────────────────────────────────────────────────

function extractValidationArg(rule) {
  if (rule.source === 'ha.state_change') {
    return rule.condition && rule.condition.entity_id ? rule.condition.entity_id : null;
  }
  return null;
}

function validateRule(rule) {
  if (rule.skip_validation) return { valid: true };

  const settings = loadSettings();
  const validatorScript = settings.validators[rule.source];
  if (!validatorScript) return { valid: true };

  const arg = extractValidationArg(rule);
  if (!arg) {
    return { valid: false, error: `Rule source '${rule.source}' requires a validatable field (e.g. entity_id in condition)` };
  }

  // Skip validation for wildcards and virtual entities
  if (arg.includes('*') || arg.startsWith('magnus.')) return { valid: true };

  try {
    execFileSync('node', [validatorScript, arg], {
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { valid: true };
  } catch (err) {
    let detail = err.message;
    if (err.stderr) {
      try {
        const parsed = JSON.parse(err.stderr.toString());
        detail = parsed.error || detail;
      } catch { detail = err.stderr.toString().trim() || detail; }
    }
    return { valid: false, error: `Validation failed for '${arg}': ${detail}` };
  }
}

function saveRules(rules) {
  // Strip transient _pending flag before persisting
  const clean = rules.map(r => {
    const { _pending, ...rest } = r;
    return rest;
  });
  fs.writeFileSync(RULES_FILE, JSON.stringify(clean, null, 2) + '\n');
}

// ── Rules ───────────────────────────────────────────────────────────────────

function loadRules() {
  const rules = readJson(RULES_FILE, []);
  rulesCache = Array.isArray(rules) ? rules : [];
  return rulesCache.filter(r => r.enabled !== false && r._pending !== true);
}

function loadAllRules() {
  const rules = readJson(RULES_FILE, []);
  rulesCache = Array.isArray(rules) ? rules : [];
  return rulesCache;
}

// ── One-Off Lifecycle ───────────────────────────────────────────────────────

function markOneOffsPending(matchedRules) {
  for (const rule of matchedRules) {
    if (rule.one_off) {
      rule._pending = true;
    }
  }
}

function finalizeOneOffs(batch) {
  const oneOffIds = new Set(
    batch.filter(t => t.one_off).map(t => t.id)
  );
  if (oneOffIds.size === 0) return;

  const allRules = readJson(RULES_FILE, []);
  const filtered = allRules.filter(r => !oneOffIds.has(r.id));
  if (filtered.length !== allRules.length) {
    saveRules(filtered);
    log('info', `[one-off] Removed ${oneOffIds.size} completed one-off rule(s): ${[...oneOffIds].join(', ')}`);
  }
}

function restoreOneOffs(batch) {
  const oneOffIds = new Set(
    batch.filter(t => t.one_off).map(t => t.id)
  );
  if (oneOffIds.size === 0) return;

  if (rulesCache) {
    for (const rule of rulesCache) {
      if (oneOffIds.has(rule.id)) {
        delete rule._pending;
      }
    }
  }
  log('info', `[one-off] Restored ${oneOffIds.size} one-off rule(s) after dispatch failure: ${[...oneOffIds].join(', ')}`);
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
  if (rule._pending === true) return false;
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
    restoreOneOffs(batch);
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

  let pending = batch.length;
  let anyFailed = false;

  const onComplete = () => {
    pending--;
    if (pending <= 0) {
      if (anyFailed) {
        restoreOneOffs(batch);
      } else {
        finalizeOneOffs(batch);
      }
    }
  };

  for (const t of batch) {
    const text = t.message || `${t.label}: ${JSON.stringify(t.data)}`;
    const args = ['system', 'event', '--text', text, '--mode', 'now', '--session-id', 'agent:main:main'];

    log('info', `[message] Injecting: openclaw ${args.join(' ')}`);
    execFile(OPENCLAW_BIN, args, (err, stdout, stderr) => {
      const ts = new Date().toISOString();
      appendLog(`[${ts}] CMD: openclaw ${args.join(' ')}\n${stdout || ''}${stderr ? `STDERR: ${stderr}\n` : ''}---\n`);

      if (err) {
        log('error', `[message] Failed for '${t.label}': ${err.message}`);
        anyFailed = true;
      } else {
        log('info', `[message] Delivered: ${t.label}`);
      }
      onComplete();
    });
  }
}

// ── Dispatch: Subagent Pipeline ─────────────────────────────────────────────

function dispatchSubagents(batch) {
  log('info', `[subagent] Dispatching ${batch.length} interrupt(s) via sub-agent`);

  // Group by resolvedChannel::session_id
  const groups = {};
  for (const t of batch) {
    const resolved = resolveChannel(t.channel);
    const session = t.session_id || 'main';
    const key = `${resolved}::${session}`;
    if (!groups[key]) groups[key] = { channel: resolved, session_id: session, triggers: [] };
    groups[key].triggers.push(t);
  }

  const groupKeys = Object.keys(groups);
  let pending = groupKeys.length;
  let anyFailed = false;

  const onComplete = () => {
    pending--;
    if (pending <= 0) {
      if (anyFailed) {
        restoreOneOffs(batch);
      } else {
        finalizeOneOffs(batch);
      }
    }
  };

  for (const key of groupKeys) {
    const group = groups[key];
    const summaries = group.triggers.map(b => {
      let s = b.message || `${b.label}: ${JSON.stringify(b.data)}`;
      if (b.instruction) s += `\n  [instruction: ${b.instruction}]`;
      return `- ${s}`;
    });

    const prompt = `You are a home automation sub-agent handling an interrupt.

INTERRUPT DETAILS:
${summaries.join('\n')}

YOUR GOAL:
1. Analyze the interrupt and any provided instructions.
2. Check relevant logs (e.g. skills/home-presence/presence-log.jsonl) or use 'GetLiveContext' if needed to verify conditions.
3. DECIDE: Does the user need to be notified?

IF NOTIFICATION IS NEEDED:
- Use the 'message' tool (action='send') to deliver the notification.

IF NO NOTIFICATION IS NEEDED:
- Exit silently.

CRITICAL:
- Be concise.
- Only notify if the condition is truly met and important.
- Do NOT simply echo the interrupt; add value or verify context.`;

    const args = ['agent', '--local', '--message', prompt, '--session-id', 'agent:main:main'];

    log('info', `[subagent] Spawning sub-agent for group ${key} (${group.triggers.length} interrupt(s))`);
    execFile(OPENCLAW_BIN, args, { timeout: 120000 }, (err, stdout, stderr) => {
      const ts = new Date().toISOString();
      appendLog(`[${ts}] SUBAGENT [${key}]: ${group.triggers.map(b => b.label).join(', ')}\n${stdout || ''}${stderr ? `STDERR: ${stderr}\n` : ''}---\n`);

      if (err) {
        log('error', `[subagent] Failed for group ${key}: ${err.message}`);
        anyFailed = true;
      } else {
        log('info', `[subagent] Completed for group ${key} (${group.triggers.length} interrupt(s))`);
      }
      onComplete();
    });
  }
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

  // Mark one-off rules as pending before enqueueing
  markOneOffsPending(matched);

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
      channel: rule.channel || 'default',
      session_id: rule.session_id || 'main',
      one_off: rule.one_off || false,
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

// Shared handler for POST /rules and POST /add-rule
async function handleAddRule(req, sendJson) {
  const rule = await parseBody(req);
  if (!rule.id) return sendJson(400, { error: 'Missing required field: id' });
  if (!rule.source) return sendJson(400, { error: 'Missing required field: source' });

  // Support skip_validation from query param or body
  if (req._skipValidation) rule.skip_validation = true;

  const validation = validateRule(rule);
  if (!validation.valid) {
    log('warn', `Rule '${rule.id}' rejected: ${validation.error}`);
    return sendJson(422, { error: validation.error, rule: rule.id });
  }

  // Strip transient fields before persisting
  delete rule.skip_validation;

  const rules = readJson(RULES_FILE, []);
  const existing = rules.findIndex(r => r.id === rule.id);
  const previousRule = existing !== -1 ? { ...rules[existing] } : null;
  if (existing !== -1) {
    rules[existing] = { ...rules[existing], ...rule };
  } else {
    if (rule.enabled === undefined) rule.enabled = true;
    rules.push(rule);
  }
  saveRules(rules);

  // Push updated watchlist to collector; roll back on failure
  const pushResult = await notifyCollector(rule.source);
  if (!pushResult.ok) {
    // Roll back: restore previous state
    if (previousRule) {
      const rollback = readJson(RULES_FILE, []);
      const idx = rollback.findIndex(r => r.id === rule.id);
      if (idx !== -1) rollback[idx] = previousRule;
      saveRules(rollback);
    } else {
      const rollback = readJson(RULES_FILE, []);
      saveRules(rollback.filter(r => r.id !== rule.id));
    }
    log('warn', `Rule '${rule.id}' rolled back — collector push failed: ${pushResult.error}`);
    return sendJson(503, { error: `Collector unavailable: ${pushResult.error}`, code: 'COLLECTOR_UNAVAILABLE', rule: rule.id });
  }

  log('info', `Rule '${rule.id}' added/updated (source=${rule.source})`);
  return sendJson(200, { status: 'added', rule: rule.id, validated: true });
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

      // GET /settings — return current settings
      if (req.method === 'GET' && req.url === '/settings') {
        return sendJson(200, loadSettings());
      }

      // PUT /settings — JSON merge patch
      if (req.method === 'PUT' && req.url === '/settings') {
        const patch = await parseBody(req);
        const current = readJson(SETTINGS_FILE, {});
        const merged = { ...current, ...patch };
        // Deep-merge pipeline sub-objects
        if (patch.message) merged.message = { ...current.message, ...patch.message };
        if (patch.subagent) merged.subagent = { ...current.subagent, ...patch.subagent };
        saveSettings(merged);
        return sendJson(200, loadSettings());
      }

      // GET /rules/ha-entities — return unique entity_ids from active ha.state_change rules
      if (req.method === 'GET' && req.url === '/rules/ha-entities') {
        const rules = loadRules();
        const entities = [...new Set(
          rules
            .filter(r => r.source === 'ha.state_change' && r.condition && r.condition.entity_id)
            .map(r => r.condition.entity_id)
        )];
        return sendJson(200, { entities });
      }

      // GET /rules — list all rules
      if (req.method === 'GET' && req.url === '/rules') {
        return sendJson(200, loadAllRules());
      }

      // DELETE /rules/:id — remove a rule by ID
      if (req.method === 'DELETE' && req.url.startsWith('/rules/')) {
        const id = decodeURIComponent(req.url.slice('/rules/'.length));
        if (!id) return sendJson(400, { error: 'Missing rule ID' });
        const rules = readJson(RULES_FILE, []);
        const idx = rules.findIndex(r => r.id === id);
        if (idx === -1) return sendJson(404, { error: `Rule '${id}' not found` });
        const deletedRule = rules[idx];
        rules.splice(idx, 1);
        saveRules(rules);
        log('info', `Rule '${id}' deleted`);

        // Push updated watchlist; warn on failure but don't roll back
        const pushResult = await notifyCollector(deletedRule.source);
        if (!pushResult.ok) {
          log('warn', `[collector] Notification failed after deleting rule '${id}': ${pushResult.error}`);
          return sendJson(200, { status: 'deleted', rule: id, warning: `Collector notification failed: ${pushResult.error}` });
        }
        return sendJson(200, { status: 'deleted', rule: id });
      }

      // POST /rules — add/update a rule (new canonical endpoint)
      if (req.method === 'POST' && (req.url === '/rules' || req.url.startsWith('/rules?'))) {
        // Pass skip_validation query param into the rule body for validateRule()
        if (req.url.includes('skip_validation=1')) {
          req._skipValidation = true;
        }
        return handleAddRule(req, sendJson);
      }

      // POST /reload — reload rules from disk
      if (req.method === 'POST' && req.url === '/reload') {
        const allRules = readJson(RULES_FILE, []);
        const errors = [];
        for (const rule of allRules) {
          if (rule.enabled === false) continue;
          const result = validateRule(rule);
          if (!result.valid) errors.push({ id: rule.id, error: result.error });
        }
        const active = loadRules();
        log('info', `Rules reloaded: ${active.length} active rule(s), ${errors.length} validation error(s)`);

        // Push to all configured collectors (best-effort)
        const settings = loadSettings();
        const collectorResults = {};
        for (const source of Object.keys(settings.collectors)) {
          const pushResult = await notifyCollector(source);
          collectorResults[source] = pushResult.ok ? 'ok' : pushResult.error;
          if (!pushResult.ok) log('warn', `[collector] Reload push to ${source} failed: ${pushResult.error}`);
        }

        return sendJson(200, { status: 'reloaded', rules: active.length, validationErrors: errors, collectors: collectorResults });
      }

      // POST /add-rule — backward-compatible alias
      if (req.method === 'POST' && req.url === '/add-rule') {
        return handleAddRule(req, sendJson);
      }

      sendJson(404, { error: 'Not found' });
    } catch (err) {
      log('error', `HTTP error: ${err.message}`);
      sendJson(500, { error: err.message });
    }
  });

  // ── File Watching / Hot Reload ──────────────────────────────────────────
  const pollInterval = settings.file_poll_ms || DEFAULT_SETTINGS.file_poll_ms;

  fs.watchFile(RULES_FILE, { interval: pollInterval }, () => {
    log('info', `[watch] Rules file changed on disk, reloading...`);
    loadRules();
  });

  fs.watchFile(SETTINGS_FILE, { interval: pollInterval }, () => {
    log('info', `[watch] Settings file changed on disk, reloading...`);
    loadSettings();
  });

  server.listen(port, '127.0.0.1', () => {
    log('info', `Interrupt Service listening on http://127.0.0.1:${port}`);
    log('info', `Loaded ${loadRules().length} active rule(s)`);
  });

  // Graceful shutdown
  const shutdown = (signal) => {
    log('info', `Received ${signal}, shutting down...`);
    fs.unwatchFile(RULES_FILE);
    fs.unwatchFile(SETTINGS_FILE);
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
