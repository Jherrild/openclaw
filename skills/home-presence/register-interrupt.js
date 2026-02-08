#!/usr/bin/env node
// register-interrupt.js — CLI to add interrupt rules for the ha-bridge
// Intelligent Interrupt Dispatcher.
// Validates entity_id (and optionally state) against live Home Assistant
// entities before saving. Wildcard patterns (e.g. 'light.*') skip validation.
//
// Usage:
//   node register-interrupt.js persistent <entity_id> [--state <state>] [--label <label>] [--message <msg>] [--instruction <text>] [--channel <channel>] [--skip-validation]
//   node register-interrupt.js one-off    <entity_id> [--state <state>] [--label <label>] [--message <msg>] [--instruction <text>] [--channel <channel>] [--skip-validation]
//   node register-interrupt.js list
//   node register-interrupt.js remove <id>

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PERSISTENT_FILE = path.join(__dirname, 'persistent-interrupts.json');
const ONEOFF_FILE = path.join(__dirname, 'one-off-interrupts.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

const HA_URL = 'http://homeassistant:8123';
const TOKEN = (() => {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'mcporter.json'), 'utf8')
    );
    const bearerArg = cfg.mcpServers['ha-stdio-final'].args
      .find(a => typeof a === 'string' && a.startsWith('Bearer '));
    return bearerArg ? bearerArg.replace('Bearer ', '').trim() : null;
  } catch { return null; }
})();

// ── Validation helpers ──────────────────────────────────────────────────────

async function fetchAllEntities() {
  const res = await fetch(`${HA_URL}/api/states`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`HA API ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Find entity IDs most similar to the target using substring + Levenshtein distance.
 * Returns up to `count` suggestions.
 */
function findSimilarEntities(target, allEntityIds, count = 5) {
  const scored = allEntityIds.map(id => {
    // Prefer substring matches
    const substringBonus = id.includes(target) || target.includes(id) ? -1000 : 0;
    // Domain match bonus
    const targetDomain = target.split('.')[0];
    const idDomain = id.split('.')[0];
    const domainBonus = targetDomain === idDomain ? -500 : 0;
    // Simple Levenshtein distance
    const dist = levenshtein(target, id);
    return { id, score: dist + substringBonus + domainBonus };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, count).map(s => s.id);
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Known plausible states per entity domain
const DOMAIN_STATES = {
  binary_sensor: ['on', 'off', 'unavailable'],
  sensor: null, // numeric/string — skip strict validation
  person: ['home', 'not_home', 'away', 'unavailable'],
  device_tracker: ['home', 'not_home', 'away', 'unavailable'],
  light: ['on', 'off', 'unavailable'],
  switch: ['on', 'off', 'unavailable'],
  climate: ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only', 'unavailable'],
  cover: ['open', 'closed', 'opening', 'closing', 'stopped', 'unavailable'],
  lock: ['locked', 'unlocked', 'jammed', 'unavailable'],
  alarm_control_panel: ['armed_home', 'armed_away', 'armed_night', 'disarmed', 'triggered', 'unavailable'],
  media_player: ['on', 'off', 'playing', 'paused', 'idle', 'standby', 'unavailable'],
  automation: ['on', 'off', 'unavailable'],
  input_boolean: ['on', 'off'],
  fan: ['on', 'off', 'unavailable'],
  vacuum: ['cleaning', 'docked', 'returning', 'idle', 'paused', 'error', 'unavailable'],
};

/**
 * Validate that a state value is plausible for the given entity domain.
 * Returns { valid: true } or { valid: false, reason: string, suggestions: string[] }.
 */
function validateState(entityId, state) {
  if (state === null || state === undefined) return { valid: true };
  const domain = entityId.split('.')[0];
  const known = DOMAIN_STATES[domain];
  if (!known) return { valid: true }; // no strict list for this domain
  if (known.includes(state)) return { valid: true };
  return {
    valid: false,
    reason: `State '${state}' is not a known state for domain '${domain}'.`,
    suggestions: known.filter(s => s !== 'unavailable'),
  };
}

/**
 * Validate entity_id and optional state against live HA entities.
 * Wildcard patterns (containing '*') skip entity existence checks.
 * Returns { valid: true } or { valid: false, error: string }.
 */
async function validateEntity(entityId, state) {
  // Wildcard patterns skip existence check but still validate state
  if (entityId.includes('*')) {
    if (state !== null && state !== undefined) {
      const stateCheck = validateState(entityId, state);
      if (!stateCheck.valid) {
        return { valid: false, error: `Warning (wildcard pattern): ${stateCheck.reason} Known states: ${stateCheck.suggestions.join(', ')}` };
      }
    }
    return { valid: true };
  }

  if (!TOKEN) {
    return { valid: false, error: 'Cannot validate: HA bearer token not found in config/mcporter.json. Use --skip-validation to bypass.' };
  }

  let entities;
  try {
    entities = await fetchAllEntities();
  } catch (err) {
    return { valid: false, error: `Cannot validate: failed to fetch HA entities: ${err.message}. Use --skip-validation to bypass.` };
  }

  const allIds = entities.map(e => e.entity_id);
  const found = allIds.includes(entityId);

  if (!found) {
    const similar = findSimilarEntities(entityId, allIds);
    return {
      valid: false,
      error: `Entity '${entityId}' does not exist in Home Assistant.\n\nDid you mean one of these?\n${similar.map(s => `  - ${s}`).join('\n')}`,
    };
  }

  // Validate state plausibility
  if (state !== null && state !== undefined) {
    const stateCheck = validateState(entityId, state);
    if (!stateCheck.valid) {
      return { valid: false, error: `${stateCheck.reason} Known states for '${entityId.split('.')[0]}': ${stateCheck.suggestions.join(', ')}` };
    }
  }

  return { valid: true };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { default_channel: 'telegram' };
  }
}

/**
 * Fetch valid notification channels from openclaw.
 * Returns an array of channel names (e.g. ['telegram']).
 */
function fetchValidChannels() {
  try {
    const raw = execFileSync('openclaw', ['channels', 'list', '--json'], { encoding: 'utf8', timeout: 10000 });
    const data = JSON.parse(raw);
    return Object.keys(data.chat || {});
  } catch {
    return null; // validation impossible — offline / not installed
  }
}

/**
 * Validate a channel name.
 * Returns { valid: true } or { valid: false, error: string }.
 */
function validateChannel(channel) {
  if (channel === 'default') return { valid: true };
  const channels = fetchValidChannels();
  if (channels === null) {
    return { valid: false, error: 'Cannot validate channel: failed to run "openclaw channels list --json". Use --skip-validation to bypass.' };
  }
  if (channels.includes(channel)) return { valid: true };
  return { valid: false, error: `Invalid channel '${channel}'. Valid channels: ${channels.join(', ')}` };
}

function writeJson(filePath, data) {
  const bak = filePath + '.bak';
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, bak);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function generateId() {
  return 'int-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function parseArgs(argv) {
  const args = { _positional: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--skip-validation') {
      args['skip-validation'] = true;
    } else if (argv[i].startsWith('--') && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    } else {
      args._positional.push(argv[i]);
    }
  }
  return args;
}

function usage() {
  console.log(`Usage:
  node register-interrupt.js persistent <entity_id> [--state <state>] [--label <label>] [--message <msg>] [--instruction <text>] [--channel <channel>] [--skip-validation]
  node register-interrupt.js one-off    <entity_id> [--state <state>] [--label <label>] [--message <msg>] [--instruction <text>] [--channel <channel>] [--skip-validation]
  node register-interrupt.js list
  node register-interrupt.js remove <id>

Options:
  --skip-validation   Skip live entity and channel validation
  --instruction       Custom context/instructions appended to the system event when the interrupt fires.
                      Use this to tell the agent HOW to react (e.g., "announce via TTS", "log but don't wake").
  --channel           Notification channel to use when dispatching (e.g., "telegram").
                      If omitted, defaults to "default" which resolves to config.json's default_channel at dispatch time.
                      Valid channels are retrieved from "openclaw channels list --json".

Examples:
  # Alert when front door motion is detected
  node register-interrupt.js persistent binary_sensor.front_door_motion --state on --label "Front door motion"

  # One-off alert when Jesten arrives home, with instructions for the agent
  node register-interrupt.js one-off person.jesten --state home --label "Jesten arrived" --instruction "Greet Jesten warmly via follow-and-speak"

  # Specify a notification channel explicitly
  node register-interrupt.js persistent binary_sensor.front_door_motion --state on --label "Front door" --channel telegram

  # Wildcard: any light turning on (wildcard skips entity existence check)
  node register-interrupt.js persistent "light.*" --state on --label "Light activated"

  # Persistent interrupt with custom instruction
  node register-interrupt.js persistent binary_sensor.front_door_motion --state on --label "Front door" --instruction "Check if anyone is expected; if not, announce security alert"

  # Skip validation (e.g. when HA is temporarily unavailable)
  node register-interrupt.js persistent sensor.future_entity --skip-validation

  # List all registered interrupts
  node register-interrupt.js list

  # Remove an interrupt by ID
  node register-interrupt.js remove int-abc123

Interrupt schema:
  {
    "id": "auto-generated",
    "entity_id": "binary_sensor.front_door_motion",
    "state": "on",            // optional — if omitted, triggers on ANY state change
    "label": "Front door motion",
    "message": "custom message text",  // optional — used in the system event
    "instruction": "Tell the agent how to react",  // optional — appended to system event
    "channel": "default",     // optional — notification channel ("default" resolves to config.json)
    "created": "ISO timestamp"
  }

Validation:
  Entity IDs are validated against live Home Assistant entities before saving.
  If the entity doesn't exist, you'll get suggestions for similar entities.
  Wildcard patterns (e.g. 'light.*') skip entity existence checks.
  State values are validated against known domain states (e.g. binary_sensor: on/off).
  Channel names are validated against "openclaw channels list --json".
  Use --skip-validation to bypass all checks.`);
}

// ── Main ────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const command = args._positional[0];
const skipValidation = args['skip-validation'] !== undefined;

if (!command || command === 'help' || command === '--help') {
  usage();
  process.exit(0);
}

if (command === 'list') {
  const persistent = readJson(PERSISTENT_FILE);
  const oneOff = readJson(ONEOFF_FILE);
  const config = readConfig();
  const formatRule = r => {
    const ch = r.channel && r.channel !== 'default' ? r.channel : `default (${config.default_channel})`;
    let line = `  [${r.id}] ${r.entity_id}${r.state != null ? ` = ${r.state}` : ' (any)'} — ${r.label || '(no label)'} [channel: ${ch}]`;
    if (r.instruction) line += `\n    instruction: ${r.instruction}`;
    return line;
  };
  console.log('=== Persistent Interrupts ===');
  if (persistent.length === 0) console.log('  (none)');
  else persistent.forEach(r => console.log(formatRule(r)));
  console.log('\n=== One-Off Interrupts ===');
  if (oneOff.length === 0) console.log('  (none)');
  else oneOff.forEach(r => console.log(formatRule(r)));
  process.exit(0);
}

if (command === 'remove') {
  const targetId = args._positional[1];
  if (!targetId) { console.error('Error: provide an interrupt ID to remove.'); process.exit(1); }

  let found = false;
  for (const [filePath, label] of [[PERSISTENT_FILE, 'persistent'], [ONEOFF_FILE, 'one-off']]) {
    const data = readJson(filePath);
    const filtered = data.filter(r => r.id !== targetId);
    if (filtered.length < data.length) {
      writeJson(filePath, filtered);
      console.log(`Removed '${targetId}' from ${label} interrupts.`);
      found = true;
    }
  }
  if (!found) console.error(`No interrupt found with ID '${targetId}'.`);
  process.exit(found ? 0 : 1);
}

if (command === 'persistent' || command === 'one-off') {
  const entityId = args._positional[1];
  if (!entityId) { console.error('Error: provide an entity_id.'); usage(); process.exit(1); }

  (async () => {
    // Validate entity_id and state against live HA entities
    if (!skipValidation) {
      const validation = await validateEntity(entityId, args.state !== undefined ? args.state : null);
      if (!validation.valid) {
        console.error(`Validation failed: ${validation.error}`);
        process.exit(1);
      }
    }

    // Determine and validate channel
    const channel = args.channel || 'default';
    if (!skipValidation) {
      const chValidation = validateChannel(channel);
      if (!chValidation.valid) {
        console.error(`Validation failed: ${chValidation.error}`);
        process.exit(1);
      }
    }

    const rule = {
      id: generateId(),
      entity_id: entityId,
      state: args.state !== undefined ? args.state : null,
      label: args.label || entityId,
      message: args.message || null,
      instruction: args.instruction || null,
      channel: channel,
      created: new Date().toISOString(),
    };

    const filePath = command === 'persistent' ? PERSISTENT_FILE : ONEOFF_FILE;
    const data = readJson(filePath);
    data.push(rule);
    writeJson(filePath, data);

    console.log(`Added ${command} interrupt:`);
    console.log(JSON.stringify(rule, null, 2));
    process.exit(0);
  })().catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else {
  console.error(`Unknown command: '${command}'`);
  usage();
  process.exit(1);
}
