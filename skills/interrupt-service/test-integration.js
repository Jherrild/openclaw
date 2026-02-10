#!/usr/bin/env node
// Integration tests for interrupt-service HTTP API
// Usage: node skills/interrupt-service/test-integration.js
// Requires: interrupt-service daemon running on localhost

const http = require('http');
const path = require('path');
const fs = require('fs');

// Load port from settings.json, fallback 7600
let PORT = 7600;
try {
  const settings = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf8'));
  if (settings.port) PORT = settings.port;
} catch (_) {}

const HOST = '127.0.0.1';

// ── HTTP Helper ──────────────────────────────────────────────────────

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: HOST,
      port: PORT,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', (err) => reject(err));
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Test Definitions ─────────────────────────────────────────────────

async function testServiceHealth() {
  const { status, body } = await request('GET', '/health');
  if (status !== 200) return { pass: false, detail: `status ${status}, expected 200` };
  if (body.status !== 'ok') return { pass: false, detail: `body.status="${body.status}", expected "ok"` };
  if (typeof body.pid !== 'number') return { pass: false, detail: `pid is ${typeof body.pid}, expected number` };
  return { pass: true, detail: '' };
}

async function testGetSettings() {
  const { status, body } = await request('GET', '/settings');
  if (status !== 200) return { pass: false, detail: `status ${status}` };
  const required = ['port', 'default_channel', 'validators'];
  for (const key of required) {
    if (body[key] === undefined) return { pass: false, detail: `missing key "${key}"` };
  }
  if (!body.message || body.message.batch_window_ms === undefined)
    return { pass: false, detail: 'missing message.batch_window_ms' };
  if (!body.subagent || body.subagent.batch_window_ms === undefined)
    return { pass: false, detail: 'missing subagent.batch_window_ms' };
  return { pass: true, detail: '' };
}

async function testGetStats() {
  const { status, body } = await request('GET', '/stats');
  if (status !== 200) return { pass: false, detail: `status ${status}` };
  if (typeof body.rules !== 'number') return { pass: false, detail: `rules is ${typeof body.rules}` };
  if (body.message === undefined || body.message.batchPending === undefined)
    return { pass: false, detail: 'missing message.batchPending' };
  if (body.subagent === undefined || body.subagent.circuitOpen === undefined)
    return { pass: false, detail: 'missing subagent.circuitOpen' };
  return { pass: true, detail: '' };
}

async function testListRules() {
  const { status, body } = await request('GET', '/rules');
  if (status !== 200) return { pass: false, detail: `status ${status}` };
  if (!Array.isArray(body)) return { pass: false, detail: 'body is not an array' };
  return { pass: true, detail: '' };
}

async function testAddRulePersistent() {
  const rule = {
    id: '__test_persistent',
    source: 'system',
    condition: { type: 'test' },
    action: 'message',
    label: 'Test Persistent',
    message: 'test {{type}}',
  };
  const { status, body } = await request('POST', '/rules', rule);
  if (status !== 200) return { pass: false, detail: `status ${status}: ${JSON.stringify(body)}` };
  if (body.status !== 'added') return { pass: false, detail: `body.status="${body.status}", expected "added"` };
  return { pass: true, detail: '' };
}

async function testAddRuleOneOff() {
  const rule = {
    id: '__test_oneoff',
    source: 'system',
    condition: { type: 'oneoff_test' },
    action: 'message',
    label: 'Test One-Off',
    message: 'oneoff',
    one_off: true,
  };
  const { status, body } = await request('POST', '/rules', rule);
  if (status !== 200) return { pass: false, detail: `status ${status}: ${JSON.stringify(body)}` };
  return { pass: true, detail: '' };
}

async function testListRulesShowsNew() {
  const { status, body } = await request('GET', '/rules');
  if (status !== 200) return { pass: false, detail: `status ${status}` };
  const ids = body.map((r) => r.id);
  if (!ids.includes('__test_persistent'))
    return { pass: false, detail: '__test_persistent not found in rules' };
  if (!ids.includes('__test_oneoff'))
    return { pass: false, detail: '__test_oneoff not found in rules' };
  return { pass: true, detail: '' };
}

async function testTriggerMatching() {
  const { status, body } = await request('POST', '/trigger', {
    source: 'system',
    data: { type: 'test' },
    level: 'info',
  });
  if (status !== 200) return { pass: false, detail: `status ${status}` };
  if (body.matched !== 1) return { pass: false, detail: `matched=${body.matched}, expected 1` };
  return { pass: true, detail: '' };
}

async function testTriggerNonMatching() {
  const { status, body } = await request('POST', '/trigger', {
    source: 'system',
    data: { type: 'nomatch' },
    level: 'info',
  });
  if (status !== 200) return { pass: false, detail: `status ${status}` };
  if (body.matched !== 0) return { pass: false, detail: `matched=${body.matched}, expected 0` };
  if (body.status !== 'ignored') return { pass: false, detail: `status="${body.status}", expected "ignored"` };
  return { pass: true, detail: '' };
}

async function testTriggerOneOff() {
  const { status, body } = await request('POST', '/trigger', {
    source: 'system',
    data: { type: 'oneoff_test' },
    level: 'info',
  });
  if (status !== 200) return { pass: false, detail: `trigger status ${status}` };
  if (body.matched !== 1) return { pass: false, detail: `matched=${body.matched}, expected 1` };

  // Wait for dispatch attempt to complete (will fail since gateway is down, rule should be restored)
  await sleep(5000);

  const list = await request('GET', '/rules');
  const ids = list.body.map((r) => r.id);
  if (!ids.includes('__test_oneoff'))
    return { pass: false, detail: '__test_oneoff was removed but should have been restored after failed dispatch' };
  return { pass: true, detail: '' };
}

async function testDefaultActionAlert() {
  const { status, body } = await request('POST', '/trigger', {
    source: 'unknown_source',
    data: { info: 'alert_test' },
    level: 'alert',
  });
  if (status !== 200) return { pass: false, detail: `status ${status}` };
  if (!body.defaultAction) return { pass: false, detail: `defaultAction=${body.defaultAction}, expected true` };
  return { pass: true, detail: '' };
}

async function testDefaultActionIgnoredInfo() {
  const { status, body } = await request('POST', '/trigger', {
    source: 'unknown_source',
    data: { info: 'info_test' },
    level: 'info',
  });
  if (status !== 200) return { pass: false, detail: `status ${status}` };
  if (body.status !== 'ignored') return { pass: false, detail: `status="${body.status}", expected "ignored"` };
  return { pass: true, detail: '' };
}

async function testRemoveRule() {
  const del = await request('DELETE', '/rules/__test_persistent');
  if (del.status !== 200) return { pass: false, detail: `DELETE status ${del.status}` };
  if (del.body.status !== 'deleted') return { pass: false, detail: `body.status="${del.body.status}"` };

  const list = await request('GET', '/rules');
  const ids = list.body.map((r) => r.id);
  if (ids.includes('__test_persistent'))
    return { pass: false, detail: '__test_persistent still exists after deletion' };
  return { pass: true, detail: '' };
}

async function testRemoveNonExistent() {
  const { status } = await request('DELETE', '/rules/__test_nonexistent');
  if (status !== 404) return { pass: false, detail: `status ${status}, expected 404` };
  return { pass: true, detail: '' };
}

async function testAddRuleSkipValidation() {
  const rule = {
    id: '__test_skipval',
    source: 'ha.state_change',
    condition: { entity_id: 'sensor.fake_entity_xyz' },
  };
  const { status, body } = await request('POST', '/rules?skip_validation=1', rule);
  if (status !== 200) return { pass: false, detail: `status ${status}: ${JSON.stringify(body)}` };
  return { pass: true, detail: '' };
}

async function testHaEntitiesWatchlist() {
  const { status, body } = await request('GET', '/rules/ha-entities');
  if (status !== 200) return { pass: false, detail: `status ${status}` };
  if (!body.entities || !Array.isArray(body.entities))
    return { pass: false, detail: 'missing or non-array entities field' };
  return { pass: true, detail: '' };
}

async function testReloadRules() {
  const { status, body } = await request('POST', '/reload');
  if (status !== 200) return { pass: false, detail: `status ${status}` };
  if (body.status !== 'reloaded') return { pass: false, detail: `body.status="${body.status}"` };
  if (typeof body.rules !== 'number') return { pass: false, detail: `rules is ${typeof body.rules}` };
  return { pass: true, detail: '' };
}

async function testUpdateSettings() {
  // Change batch_window_ms
  const put1 = await request('PUT', '/settings', { message: { batch_window_ms: 9999 } });
  if (put1.status !== 200) return { pass: false, detail: `PUT status ${put1.status}` };

  // Verify
  const get1 = await request('GET', '/settings');
  if (get1.body.message.batch_window_ms !== 9999)
    return { pass: false, detail: `batch_window_ms=${get1.body.message.batch_window_ms}, expected 9999` };

  // Restore
  const put2 = await request('PUT', '/settings', { message: { batch_window_ms: 2000 } });
  if (put2.status !== 200) return { pass: false, detail: `restore PUT status ${put2.status}` };

  return { pass: true, detail: '' };
}

async function testCollectorPush() {
  // Check ha-bridge health on port 7601
  let bridgeHealth;
  try {
    bridgeHealth = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: HOST, port: 7601, path: '/health', method: 'GET', timeout: 3000 }, (res) => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
  } catch (err) {
    return { pass: false, detail: `ha-bridge not reachable on port 7601: ${err.message}` };
  }
  if (bridgeHealth.status !== 200) return { pass: false, detail: `ha-bridge health returned ${bridgeHealth.status}` };
  const sizeBefore = bridgeHealth.body.watchlist_size;

  // Add an ha.state_change rule — should push to ha-bridge
  const addRes = await request('POST', '/rules?skip_validation=1', {
    id: '__test_push', source: 'ha.state_change',
    condition: { entity_id: 'binary_sensor.__test_push_entity' },
    action: 'message', label: 'Push Test',
  });
  if (addRes.status !== 200) return { pass: false, detail: `Add rule returned ${addRes.status}: ${JSON.stringify(addRes.body)}` };

  // Check ha-bridge watchlist grew
  let bridgeAfter;
  try {
    bridgeAfter = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: HOST, port: 7601, path: '/health', method: 'GET', timeout: 3000 }, (res) => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
  } catch (err) {
    return { pass: false, detail: `ha-bridge health after push: ${err.message}` };
  }

  if (bridgeAfter.body.watchlist_size <= sizeBefore)
    return { pass: false, detail: `Watchlist did not grow: before=${sizeBefore}, after=${bridgeAfter.body.watchlist_size}` };

  return { pass: true, detail: '' };
}

async function testCollectorSettings() {
  // Verify collectors config exists
  const res = await request('GET', '/settings');
  const collectors = res.body.collectors || {};
  if (!collectors['ha.state_change'])
    return { pass: false, detail: 'No collector configured for ha.state_change' };

  // A system-source rule (no collector) should always succeed
  const sysRes = await request('POST', '/rules', {
    id: '__test_no_collector', source: 'system',
    condition: { type: 'nocoll' }, action: 'message', label: 'No Collector',
  });
  if (sysRes.status !== 200)
    return { pass: false, detail: `System rule add failed: ${sysRes.status}` };

  return { pass: true, detail: '' };
}

// ── Cleanup ──────────────────────────────────────────────────────────

async function cleanup() {
  await request('DELETE', '/rules/__test_persistent').catch(() => {});
  await request('DELETE', '/rules/__test_oneoff').catch(() => {});
  await request('DELETE', '/rules/__test_skipval').catch(() => {});
  await request('DELETE', '/rules/__test_push').catch(() => {});
  await request('DELETE', '/rules/__test_no_collector').catch(() => {});
}

// ── Test Runner ──────────────────────────────────────────────────────

const tests = [
  ['Service Health', testServiceHealth],
  ['Get Settings', testGetSettings],
  ['Get Stats', testGetStats],
  ['List Rules', testListRules],
  ['Add Rule (persistent)', testAddRulePersistent],
  ['Add Rule (one-off)', testAddRuleOneOff],
  ['List Rules Shows New Rules', testListRulesShowsNew],
  ['Trigger Matching Event', testTriggerMatching],
  ['Trigger Non-Matching Event', testTriggerNonMatching],
  ['Trigger One-Off Match (restore on failed dispatch)', testTriggerOneOff],
  ['Default Action for Alert Level', testDefaultActionAlert],
  ['Default Action Ignored for Info Level', testDefaultActionIgnoredInfo],
  ['Remove Rule', testRemoveRule],
  ['Remove Non-Existent Rule', testRemoveNonExistent],
  ['Add Rule with Skip Validation', testAddRuleSkipValidation],
  ['HA Entities Watchlist', testHaEntitiesWatchlist],
  ['Reload Rules', testReloadRules],
  ['Update Settings', testUpdateSettings],
  ['Collector Push (ha-bridge)', testCollectorPush],
  ['Collector Config (no-collector source)', testCollectorSettings],
];

async function main() {
  const bar = '═'.repeat(36);
  console.log(`\nInterrupt Service Integration Tests`);
  console.log(bar + '\n');

  let passed = 0;
  const total = tests.length;

  try {
    for (const [name, fn] of tests) {
      try {
        const result = await fn();
        if (result.pass) {
          console.log(`✅ ${name}`);
          passed++;
        } else {
          console.log(`❌ ${name}: ${result.detail}`);
        }
      } catch (err) {
        console.log(`❌ ${name}: ${err.message}`);
      }
    }
  } finally {
    // Always clean up
    await cleanup();
  }

  console.log(`\n${bar}`);
  console.log(`Result: ${passed}/${total} tests passed`);
  process.exit(passed === total ? 0 : 1);
}

main();
