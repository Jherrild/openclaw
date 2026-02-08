#!/usr/bin/env node
// register-interrupt.js — CLI to add interrupt rules for the ha-bridge
// Intelligent Interrupt Dispatcher.
//
// Usage:
//   node register-interrupt.js persistent <entity_id> [--state <state>] [--label <label>] [--message <msg>]
//   node register-interrupt.js one-off    <entity_id> [--state <state>] [--label <label>] [--message <msg>]
//   node register-interrupt.js list
//   node register-interrupt.js remove <id>

const fs = require('fs');
const path = require('path');

const PERSISTENT_FILE = path.join(__dirname, 'persistent-interrupts.json');
const ONEOFF_FILE = path.join(__dirname, 'one-off-interrupts.json');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
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
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    } else {
      args._positional.push(argv[i]);
    }
  }
  return args;
}

function usage() {
  console.log(`Usage:
  node register-interrupt.js persistent <entity_id> [--state <state>] [--label <label>] [--message <msg>]
  node register-interrupt.js one-off    <entity_id> [--state <state>] [--label <label>] [--message <msg>]
  node register-interrupt.js list
  node register-interrupt.js remove <id>

Examples:
  # Alert when front door motion is detected
  node register-interrupt.js persistent binary_sensor.front_door_motion --state on --label "Front door motion"

  # One-off alert when Jesten arrives home
  node register-interrupt.js one-off person.jesten --state home --label "Jesten arrived"

  # Wildcard: any light turning on
  node register-interrupt.js persistent "light.*" --state on --label "Light activated"

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
    "created": "ISO timestamp"
  }`);
}

// ── Main ────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv.slice(2));
const command = args._positional[0];

if (!command || command === 'help' || command === '--help') {
  usage();
  process.exit(0);
}

if (command === 'list') {
  const persistent = readJson(PERSISTENT_FILE);
  const oneOff = readJson(ONEOFF_FILE);
  console.log('=== Persistent Interrupts ===');
  if (persistent.length === 0) console.log('  (none)');
  else persistent.forEach(r => console.log(`  [${r.id}] ${r.entity_id}${r.state != null ? ` = ${r.state}` : ' (any)'} — ${r.label || '(no label)'}`));
  console.log('\n=== One-Off Interrupts ===');
  if (oneOff.length === 0) console.log('  (none)');
  else oneOff.forEach(r => console.log(`  [${r.id}] ${r.entity_id}${r.state != null ? ` = ${r.state}` : ' (any)'} — ${r.label || '(no label)'}`));
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

  const rule = {
    id: generateId(),
    entity_id: entityId,
    state: args.state !== undefined ? args.state : null,
    label: args.label || entityId,
    message: args.message || null,
    created: new Date().toISOString(),
  };

  const filePath = command === 'persistent' ? PERSISTENT_FILE : ONEOFF_FILE;
  const data = readJson(filePath);
  data.push(rule);
  writeJson(filePath, data);

  console.log(`Added ${command} interrupt:`);
  console.log(JSON.stringify(rule, null, 2));
  process.exit(0);
}

console.error(`Unknown command: '${command}'`);
usage();
process.exit(1);
