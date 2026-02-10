#!/usr/bin/env node
// interrupt-manager.js — Intelligent Interrupt Dispatcher for ha-bridge.
// Matches HA state_changed events against registered conditions in
// persistent-interrupts.json and one-off-interrupts.json.
//
// Architecture: Two separate pipelines — 'message' and 'subagent' — each with
// independent batching windows, rate limits, and circuit breakers. Settings are
// loaded from interrupt-settings.json and can be updated at runtime.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PERSISTENT_FILE = path.join(__dirname, 'persistent-interrupts.json');
const ONEOFF_FILE = path.join(__dirname, 'one-off-interrupts.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const SETTINGS_FILE = path.join(__dirname, 'interrupt-settings.json');
const OPENCLAW_BIN = '/home/jherrild/.npm-global/bin/openclaw';

const DEFAULT_SETTINGS = {
  message: { batch_window_ms: 2000, rate_limit_max: 10, rate_limit_window_ms: 60000 },
  subagent: { batch_window_ms: 5000, rate_limit_max: 4, rate_limit_window_ms: 60000 },
  file_poll_ms: 2000,
  log_limit: 1000,
};

class InterruptManager {
  constructor() {
    this.persistent = [];
    this.oneOff = [];
    this.settings = this._loadSettings();

    // Separate pipeline state per type
    this.pipelines = {
      message:  { queue: [], timer: null, timestamps: [], circuitOpen: false },
      subagent: { queue: [], timer: null, timestamps: [], circuitOpen: false },
    };

    this._loadFiles();
    this._watchFiles();
  }

  // ── Settings I/O ────────────────────────────────────────────────────────────

  _loadSettings() {
    try {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return {
        message:  { ...DEFAULT_SETTINGS.message,  ...raw.message },
        subagent: { ...DEFAULT_SETTINGS.subagent, ...raw.subagent },
        file_poll_ms: raw.file_poll_ms ?? DEFAULT_SETTINGS.file_poll_ms,
        log_limit:    raw.log_limit    ?? DEFAULT_SETTINGS.log_limit,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  _saveSettings() {
    try {
      const bak = SETTINGS_FILE + '.bak';
      if (fs.existsSync(SETTINGS_FILE)) fs.copyFileSync(SETTINGS_FILE, bak);
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2) + '\n');
    } catch (err) {
      this._statusLog('error', `Failed to save settings: ${err.message}`);
    }
  }

  /** Get current settings (or a specific key). */
  getSettings(key) {
    if (key) return this.settings[key];
    return { ...this.settings };
  }

  /** Update settings at runtime. Merges provided object into current settings. */
  updateSettings(patch) {
    for (const k of ['message', 'subagent']) {
      if (patch[k] && typeof patch[k] === 'object') {
        this.settings[k] = { ...this.settings[k], ...patch[k] };
      }
    }
    if (patch.file_poll_ms !== undefined) this.settings.file_poll_ms = patch.file_poll_ms;
    if (patch.log_limit !== undefined)    this.settings.log_limit = patch.log_limit;
    this._saveSettings();
    this._statusLog('info', `Settings updated: ${JSON.stringify(this.settings)}`);
  }

  // ── File I/O ──────────────────────────────────────────────────────────────

  _readConfig() {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
      return { default_channel: 'telegram' };
    }
  }

  _loadFiles() {
    this.persistent = this._readJson(PERSISTENT_FILE);
    this.oneOff = this._readJson(ONEOFF_FILE);
  }

  _readJson(filePath) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _writeJson(filePath, data) {
    try {
      const bak = filePath + '.bak';
      if (fs.existsSync(filePath)) fs.copyFileSync(filePath, bak);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
    } catch (err) {
      this._statusLog('error', `Failed to write ${path.basename(filePath)}: ${err.message}`);
    }
  }

  _watchFiles() {
    const poll = this.settings.file_poll_ms;
    fs.watchFile(PERSISTENT_FILE, { interval: poll }, () => {
      this.persistent = this._readJson(PERSISTENT_FILE);
      this._statusLog('info', `Reloaded persistent-interrupts.json (${this.persistent.length} rules)`);
    });
    fs.watchFile(ONEOFF_FILE, { interval: poll }, () => {
      this.oneOff = this._readJson(ONEOFF_FILE);
      this._statusLog('info', `Reloaded one-off-interrupts.json (${this.oneOff.length} rules)`);
    });
    fs.watchFile(SETTINGS_FILE, { interval: poll }, () => {
      this.settings = this._loadSettings();
      this._statusLog('info', `Reloaded interrupt-settings.json`);
    });
  }

  // ── Status Logging ────────────────────────────────────────────────────────

  _statusLog(level, msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [interrupt-mgr] [${level}] ${msg}\n`;
    // Only write to console — ha-bridge redirects stdout to status log
    // (Writing to file AND console causes duplicate entries)
    console[level === 'error' ? 'error' : 'log'](line.trim());
  }

  // ── Logging ────────────────────────────────────────────────────────────────

  _logDispatchResult(cmdArgs, stdout, stderr) {
    const timestamp = new Date().toISOString();
    const logFile = path.join(__dirname, 'dispatch.log');
    const logEntry = `[${timestamp}] CMD: openclaw ${cmdArgs.join(' ')}\n` +
                     (stdout ? `STDOUT:\n${stdout}\n` : '') +
                     (stderr ? `STDERR:\n${stderr}\n` : '') +
                     '--------------------------------------------------------------------------------\n';
    
    try {
      let content = '';
      if (fs.existsSync(logFile)) {
        content = fs.readFileSync(logFile, 'utf8');
      }
      
      const limit = this.settings.log_limit;
      const lines = (content + logEntry).split('\n');
      if (lines.length > limit) {
        const keptLines = lines.slice(lines.length - limit);
        fs.writeFileSync(logFile, keptLines.join('\n'));
      } else {
        fs.appendFileSync(logFile, logEntry);
      }
    } catch (err) {
      this._statusLog('error', `Failed to write to dispatch log: ${err.message}`);
    }
  }

  // ── One-Off Lifecycle ─────────────────────────────────────────────────────

  /** Remove successfully dispatched one-off triggers. */
  _finalizeOneOffs(triggers) {
    const ids = triggers.filter(t => t._oneOff).map(t => t.id);
    if (ids.length === 0) return;
    this.oneOff = this.oneOff.filter(r => !ids.includes(r.id));
    this._writeJson(ONEOFF_FILE, this.oneOff);
    this._statusLog('info', `Consumed ${ids.length} one-off interrupt(s) after successful dispatch: ${ids.join(', ')}`);
  }

  /** Restore pending one-offs so they can re-trigger after a failed dispatch. */
  _restoreOneOffs(triggers) {
    const ids = triggers.filter(t => t._oneOff).map(t => t.id);
    if (ids.length === 0) return;
    for (const r of this.oneOff) {
      if (ids.includes(r.id)) delete r._pending;
    }
    this._writeJson(ONEOFF_FILE, this.oneOff);
    this._statusLog('warn', `Restored ${ids.length} one-off interrupt(s) after failed dispatch: ${ids.join(', ')}`);
  }

  // ── Matching ──────────────────────────────────────────────────────────────

  /**
   * Check a state_changed event against all registered interrupts.
   * @param {string} entityId - e.g. 'binary_sensor.front_door_motion'
   * @param {string} oldState - previous state
   * @param {string} newState - new state
   */
  evaluate(entityId, oldState, newState) {
    const matchedPersistent = this.persistent.filter(r => this._matches(r, entityId, newState));
    const matchedOneOff = this.oneOff.filter(r => this._matches(r, entityId, newState));

    if (matchedPersistent.length === 0 && matchedOneOff.length === 0) return;

    // Mark matched one-offs as pending (prevents re-triggering) instead of
    // removing immediately — they are only deleted after successful dispatch.
    if (matchedOneOff.length > 0) {
      const matchedIds = new Set(matchedOneOff.map(r => r.id));
      for (const r of this.oneOff) {
        if (matchedIds.has(r.id)) r._pending = true;
      }
      this._writeJson(ONEOFF_FILE, this.oneOff);
      this._statusLog('info', `Marked ${matchedOneOff.length} one-off interrupt(s) as pending: ${[...matchedIds].join(', ')}`);
    }

    const allMatched = [...matchedPersistent, ...matchedOneOff];
    for (const rule of allMatched) {
      let msg = rule.message || `${rule.label || rule.id}: ${entityId} → ${newState}`;
      // Interpolate placeholders
      if (msg.includes('{{new_state}}')) {
        msg = msg.replace(/{{new_state}}/g, newState);
      }
      if (msg.includes('{{entity_id}}')) {
        msg = msg.replace(/{{entity_id}}/g, entityId);
      }

      this._enqueue({
        id: rule.id,
        label: rule.label || rule.id,
        entity_id: entityId,
        old_state: oldState,
        new_state: newState,
        message: msg,
        instruction: rule.instruction || null,
        channel: rule.channel || 'default',
        session_id: rule.session_id || 'main',
        type: rule.type || 'subagent',
        _oneOff: matchedOneOff.includes(rule),
      });
    }
  }

  _matches(rule, entityId, newState) {
    if (!rule || !rule.entity_id) return false;
    // Skip rules already pending dispatch (one-off safety)
    if (rule._pending) return false;
    // Support exact match or glob-style wildcard (e.g. 'light.*')
    const pattern = rule.entity_id;
    if (pattern.includes('*')) {
      const re = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      if (!re.test(entityId)) return false;
    } else {
      if (pattern !== entityId) return false;
    }
    // State filter: if specified, must match new state
    if (rule.state !== undefined && rule.state !== null) {
      if (String(rule.state) !== String(newState)) return false;
    }
    return true;
  }

  // ── Batching (per-pipeline) ─────────────────────────────────────────────────

  _enqueue(trigger) {
    const type = trigger.type === 'message' ? 'message' : 'subagent';
    const pipeline = this.pipelines[type];
    const cfg = this.settings[type];

    pipeline.queue.push(trigger);
    this._statusLog('info', `[${type}] Interrupt queued: ${trigger.label} (${trigger.entity_id} → ${trigger.new_state})`);

    if (!pipeline.timer) {
      pipeline.timer = setTimeout(() => this._flushPipeline(type), cfg.batch_window_ms);
    }
  }

  _flushPipeline(type) {
    const pipeline = this.pipelines[type];
    const cfg = this.settings[type];
    pipeline.timer = null;
    if (pipeline.queue.length === 0) return;

    const batch = pipeline.queue.splice(0);
    this._statusLog('info', `[${type}] Batching ${batch.length} interrupt(s) into single dispatch`);

    // Rate limiting check
    const now = Date.now();
    pipeline.timestamps = pipeline.timestamps.filter(t => now - t < cfg.rate_limit_window_ms);

    if (pipeline.timestamps.length >= cfg.rate_limit_max) {
      if (!pipeline.circuitOpen) {
        pipeline.circuitOpen = true;
        this._statusLog('warn', `[${type}] CIRCUIT BREAKER OPEN — rate limit exceeded (${cfg.rate_limit_max}/${cfg.rate_limit_window_ms}ms). Interrupts suppressed.`);
      }
      this._statusLog('warn', `[${type}] Rate-limited: dropped batch of ${batch.length} interrupt(s): ${batch.map(b => b.label).join(', ')}`);
      return;
    }

    if (pipeline.circuitOpen) {
      pipeline.circuitOpen = false;
      this._statusLog('info', `[${type}] Circuit breaker closed — rate limit recovered`);
    }

    pipeline.timestamps.push(now);

    if (type === 'message') {
      this._dispatchMessages(batch);
    } else {
      this._dispatchSubagents(batch);
    }
  }

  // ── Dispatch: Message Pipeline ──────────────────────────────────────────────
  // Injects system events into the Main Session via `openclaw system event`.

  _dispatchMessages(batch) {
    this._statusLog('info', `[message] Dispatching ${batch.length} message interrupt(s) via system event`);

    let pending = batch.length;
    let anyFailed = false;

    for (const t of batch) {
      const text = t.message || `${t.label}: ${t.new_state}`;
      const args = ['system', 'event', '--text', text, '--mode', 'now'];

      this._statusLog('info', `[message] Injecting system event: openclaw ${args.join(' ')}`);
      execFile(OPENCLAW_BIN, args, (err, stdout, stderr) => {
        this._logDispatchResult(args, stdout, stderr);

        if (err) {
          anyFailed = true;
          this._statusLog('error', `[message] Failed to inject event for '${t.label}': ${err.message}`);
          if (stderr) this._statusLog('error', `[message]   stderr: ${stderr.trim()}`);
        } else {
          this._statusLog('info', `[message] Injected system event for '${t.label}'`);
        }

        pending--;
        if (pending === 0) {
          if (anyFailed) {
            this._restoreOneOffs(batch);
          } else {
            this._finalizeOneOffs(batch);
          }
        }
      });
    }
  }

  // ── Dispatch: Subagent Pipeline ───────────────────────────────────────────
  // Spawns a sub-agent (cheap model) to evaluate and optionally notify.

  _dispatchSubagents(batch) {
    const config = this._readConfig();
    const resolveChannel = (ch) => (!ch || ch === 'default') ? config.default_channel : ch;

    // Group triggers by resolved channel AND session_id
    const byGroup = {};
    for (const b of batch) {
      const ch = resolveChannel(b.channel);
      const sess = b.session_id || 'main';
      const key = `${ch}::${sess}`;
      if (!byGroup[key]) byGroup[key] = [];
      byGroup[key].push(b);
    }

    const groupKeys = Object.keys(byGroup);
    let groupsPending = groupKeys.length;
    let anyFailed = false;

    for (const [key, triggers] of Object.entries(byGroup)) {
      const [channel] = key.split('::');
      const summaries = triggers.map(b => {
        let s = b.message;
        if (b.instruction) s += ` [instruction: ${b.instruction}]`;
        return s;
      });

      const prompt = `You are a home automation sub-agent handling an interrupt.

INTERRUPT DETAILS:
${summaries.join('\n')}

YOUR GOAL:
1. Analyze the interrupt and any provided instructions.
2. Check relevant logs (e.g. skills/home-presence/presence-log.jsonl) or use 'GetLiveContext' if needed to verify conditions.
3. DECIDE: Does the user need to be notified?

IF NOTIFICATION IS NEEDED:
- Send a message using: openclaw message send --channel ${channel} --message "Your message here"

IF NO NOTIFICATION IS NEEDED:
- Exit silently.

CRITICAL:
- Be concise.
- Only notify if the condition is truly met and important.
- Do NOT simply echo the interrupt; add value or verify context.`;

      const args = [
        'agent', '--local',
        '--message', prompt,
      ];

      this._statusLog('info', `[subagent] Spawning sub-agent for interrupt(s) on channel: ${channel}`);
      this._statusLog('info', `[subagent] Command: openclaw ${args.slice(0, 3).join(' ')} --message <prompt>`);

      execFile(OPENCLAW_BIN, args, { timeout: 120000 }, (err, stdout, stderr) => {
        this._logDispatchResult(args.slice(0, 3), stdout, stderr);

        if (err) {
          anyFailed = true;
          this._statusLog('error', `[subagent] Failed to spawn sub-agent: ${err.message}`);
          if (stderr) this._statusLog('error', `[subagent]   stderr: ${stderr.trim()}`);
          if (err.killed) this._statusLog('error', `[subagent]   Process was killed (timeout or signal)`);
        } else {
          this._statusLog('info', `[subagent] Sub-agent completed successfully (${triggers.length} interrupt(s))`);
        }

        groupsPending--;
        if (groupsPending === 0) {
          if (anyFailed) {
            this._restoreOneOffs(batch);
          } else {
            this._finalizeOneOffs(batch);
          }
        }
      });
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroy() {
    fs.unwatchFile(PERSISTENT_FILE);
    fs.unwatchFile(ONEOFF_FILE);
    fs.unwatchFile(SETTINGS_FILE);
    for (const p of Object.values(this.pipelines)) {
      if (p.timer) { clearTimeout(p.timer); p.timer = null; }
    }
  }

  // ── Stats (for status reporting) ──────────────────────────────────────────

  stats() {
    const now = Date.now();
    const pipelineStats = (type) => {
      const p = this.pipelines[type];
      const cfg = this.settings[type];
      return {
        batchPending: p.queue.length,
        dispatchesInWindow: p.timestamps.filter(t => now - t < cfg.rate_limit_window_ms).length,
        circuitOpen: p.circuitOpen,
        batchWindowMs: cfg.batch_window_ms,
        rateLimitMax: cfg.rate_limit_max,
      };
    };
    return {
      persistentRules: this.persistent.length,
      oneOffRules: this.oneOff.length,
      message: pipelineStats('message'),
      subagent: pipelineStats('subagent'),
    };
  }
}

module.exports = InterruptManager;
