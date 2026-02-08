#!/usr/bin/env node
// interrupt-manager.js — Intelligent Interrupt Dispatcher for ha-bridge.
// Matches HA state_changed events against registered conditions in
// persistent-interrupts.json and one-off-interrupts.json, with batching,
// rate limiting, and circuit-breaker protection.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PERSISTENT_FILE = path.join(__dirname, 'persistent-interrupts.json');
const ONEOFF_FILE = path.join(__dirname, 'one-off-interrupts.json');
const STATUS_LOG = path.join(__dirname, 'ha-bridge.status.log');

const BATCH_WINDOW_MS = 5000;
const RATE_LIMIT_MAX = 4;
const RATE_LIMIT_WINDOW_MS = 60000;
const FILE_POLL_MS = 2000;

class InterruptManager {
  constructor() {
    this.persistent = [];
    this.oneOff = [];
    this.batchQueue = [];
    this.batchTimer = null;
    this.dispatchTimestamps = [];
    this.circuitOpen = false;

    this._loadFiles();
    this._watchFiles();
  }

  // ── File I/O ──────────────────────────────────────────────────────────────

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
    fs.watchFile(PERSISTENT_FILE, { interval: FILE_POLL_MS }, () => {
      this.persistent = this._readJson(PERSISTENT_FILE);
      this._statusLog('info', `Reloaded persistent-interrupts.json (${this.persistent.length} rules)`);
    });
    fs.watchFile(ONEOFF_FILE, { interval: FILE_POLL_MS }, () => {
      this.oneOff = this._readJson(ONEOFF_FILE);
      this._statusLog('info', `Reloaded one-off-interrupts.json (${this.oneOff.length} rules)`);
    });
  }

  // ── Status Logging ────────────────────────────────────────────────────────

  _statusLog(level, msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [interrupt-mgr] [${level}] ${msg}\n`;
    try { fs.appendFileSync(STATUS_LOG, line); } catch { /* ignore */ }
    console[level === 'error' ? 'error' : 'log'](line.trim());
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

    // Queue one-off removals immediately
    if (matchedOneOff.length > 0) {
      const matchedIds = new Set(matchedOneOff.map(r => r.id));
      this.oneOff = this.oneOff.filter(r => !matchedIds.has(r.id));
      this._writeJson(ONEOFF_FILE, this.oneOff);
      this._statusLog('info', `Consumed ${matchedOneOff.length} one-off interrupt(s): ${[...matchedIds].join(', ')}`);
    }

    const allMatched = [...matchedPersistent, ...matchedOneOff];
    for (const rule of allMatched) {
      this._enqueue({
        id: rule.id,
        label: rule.label || rule.id,
        entity_id: entityId,
        old_state: oldState,
        new_state: newState,
        message: rule.message || `${rule.label || rule.id}: ${entityId} → ${newState}`,
        instruction: rule.instruction || null,
      });
    }
  }

  _matches(rule, entityId, newState) {
    if (!rule || !rule.entity_id) return false;
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

  // ── Batching ──────────────────────────────────────────────────────────────

  _enqueue(trigger) {
    this.batchQueue.push(trigger);
    this._statusLog('info', `Interrupt queued: ${trigger.label} (${trigger.entity_id} → ${trigger.new_state})`);

    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this._flushBatch(), BATCH_WINDOW_MS);
    }
  }

  _flushBatch() {
    this.batchTimer = null;
    if (this.batchQueue.length === 0) return;

    const batch = this.batchQueue.splice(0);
    this._statusLog('info', `Batching ${batch.length} interrupt(s) into single dispatch`);

    // Rate limiting check
    const now = Date.now();
    this.dispatchTimestamps = this.dispatchTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);

    if (this.dispatchTimestamps.length >= RATE_LIMIT_MAX) {
      if (!this.circuitOpen) {
        this.circuitOpen = true;
        this._statusLog('warn', `CIRCUIT BREAKER OPEN — rate limit exceeded (${RATE_LIMIT_MAX}/min). Interrupts suppressed.`);
      }
      this._statusLog('warn', `Rate-limited: dropped batch of ${batch.length} interrupt(s): ${batch.map(b => b.label).join(', ')}`);
      return;
    }

    // Reset circuit breaker if we're below limit
    if (this.circuitOpen) {
      this.circuitOpen = false;
      this._statusLog('info', 'Circuit breaker closed — rate limit recovered');
    }

    this.dispatchTimestamps.push(now);
    this._dispatch(batch);
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────

  _dispatch(batch) {
    const summaries = batch.map(b => {
      let s = b.message;
      if (b.instruction) s += ` [instruction: ${b.instruction}]`;
      return s;
    });
    const text = `home-presence interrupt: ${summaries.join(' | ')}`;

    this._statusLog('info', `Dispatching openclaw system event: ${text}`);

    execFile('openclaw', ['system', 'event', '--text', text, '--mode', 'now'], (err, stdout, stderr) => {
      if (err) {
        this._statusLog('error', `openclaw system event failed: ${err.message}`);
        if (stderr) this._statusLog('error', `  stderr: ${stderr.trim()}`);
      } else {
        this._statusLog('info', `Dispatch successful (${batch.length} interrupt(s))`);
      }
    });
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroy() {
    fs.unwatchFile(PERSISTENT_FILE);
    fs.unwatchFile(ONEOFF_FILE);
    if (this.batchTimer) { clearTimeout(this.batchTimer); this.batchTimer = null; }
  }

  // ── Stats (for status reporting) ──────────────────────────────────────────

  stats() {
    return {
      persistentRules: this.persistent.length,
      oneOffRules: this.oneOff.length,
      batchPending: this.batchQueue.length,
      dispatchesInWindow: this.dispatchTimestamps.filter(t => Date.now() - t < RATE_LIMIT_WINDOW_MS).length,
      circuitOpen: this.circuitOpen,
    };
  }
}

module.exports = InterruptManager;
