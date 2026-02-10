#!/usr/bin/env node
// interrupt-cli.js — CLI client for the Interrupt Service daemon.
//
// Full command reference: run with --help or no arguments.

const http = require('http');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');
const BOOLEAN_FLAGS = new Set(['one-off', 'skip-validation']);

function getPort() {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return settings.port || 7600;
  } catch {
    return 7600;
  }
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const port = getPort();
    const opts = {
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new Error(`Interrupt Service not running on port ${port}. Start it with: systemctl --user start interrupt-service`));
      } else {
        reject(err);
      }
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Argument Parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = [];
  const flags = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[key] = args[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(args[i]);
    }
  }

  return { positional, flags };
}

function generateId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `rule-${ts}-${rand}`;
}

// ── Help Text ───────────────────────────────────────────────────────────────

function usage() {
  console.log(`interrupt-cli.js — CLI client for the Interrupt Service daemon

Usage:
  interrupt-cli.js <command> [options]

Commands:
  add              Add or update a rule
  remove <id>      Remove a rule by ID
  list             List all rules
  trigger          Fire an event into the pipeline
  settings get     Show current settings
  settings set '<json>'  Update settings (JSON merge patch)
  stats            Show pipeline statistics
  health           Liveness check
  reload           Reload rules from disk

── add ──────────────────────────────────────────────────────────────────────
  --source <src>        (required) Source type (e.g., ha.state_change, email, system)
  --condition <json>    Match conditions JSON string (default: {})
  --action <type>       message or subagent (default: subagent)
  --label <text>        Human-readable label
  --message <text>      Message template (supports {{key}} interpolation)
  --instruction <text>  Custom instructions for sub-agent
  --channel <name>      Notification channel (default: "default")
  --session-id <id>     Target session (default: "main")
  --one-off             One-off rule (auto-removed after first match)
  --id <id>             Explicit rule ID (auto-generated if omitted)
  --skip-validation     Bypass server-side validation

── remove ───────────────────────────────────────────────────────────────────
  interrupt-cli.js remove <rule-id>

── list ─────────────────────────────────────────────────────────────────────
  interrupt-cli.js list

── trigger ──────────────────────────────────────────────────────────────────
  --source <src>        (required) Event source identifier
  --data <json>         JSON string of event data (default: {})
  --level <lvl>         info, warn, or alert (default: info)
  --message <text>      Shorthand: sets data.message

── settings ─────────────────────────────────────────────────────────────────
  interrupt-cli.js settings get
  interrupt-cli.js settings set '{"port":7601}'

── stats / health / reload ──────────────────────────────────────────────────
  No options required.

Examples:
  interrupt-cli.js add --source ha.state_change --condition '{"entity_id":"binary_sensor.motion"}' --action subagent --label "Motion alert"
  interrupt-cli.js add --source email --action message --message "New mail: {{subject}}" --one-off
  interrupt-cli.js remove rule-abc123
  interrupt-cli.js list
  interrupt-cli.js trigger --source system --message "Disk usage above 90%" --level warn
  interrupt-cli.js trigger --source home-assistant --data '{"entity_id":"light.office","state":"on"}'
  interrupt-cli.js settings get
  interrupt-cli.js settings set '{"message":{"batch_window_ms":3000}}'
  interrupt-cli.js stats
  interrupt-cli.js health
  interrupt-cli.js reload`);
}

// ── Command Handlers ────────────────────────────────────────────────────────

async function cmdAdd(flags) {
  if (!flags.source) {
    console.error('Error: --source is required for add');
    process.exit(1);
  }

  let condition = {};
  if (flags.condition) {
    try {
      condition = JSON.parse(flags.condition);
    } catch {
      console.error('Error: --condition must be valid JSON');
      process.exit(1);
    }
  }

  const rule = {
    id: flags.id || generateId(),
    source: flags.source,
    condition,
    action: flags.action || 'subagent',
    channel: flags.channel || 'default',
    session_id: flags['session-id'] || 'main',
    enabled: true,
  };

  if (flags.label) rule.label = flags.label;
  if (flags.message) rule.message = flags.message;
  if (flags.instruction) rule.instruction = flags.instruction;
  if (flags['one-off']) rule.one_off = true;

  const urlPath = flags['skip-validation'] ? '/rules?skip_validation=1' : '/rules';
  const result = await request('POST', urlPath, rule);
  console.log(JSON.stringify(result.body, null, 2));
  process.exit(result.status >= 200 && result.status < 300 ? 0 : 1);
}

async function cmdRemove(id) {
  if (!id) {
    console.error('Error: rule ID is required. Usage: interrupt-cli.js remove <id>');
    process.exit(1);
  }
  const result = await request('DELETE', `/rules/${encodeURIComponent(id)}`);
  console.log(JSON.stringify(result.body, null, 2));
  process.exit(result.status >= 200 && result.status < 300 ? 0 : 1);
}

async function cmdList() {
  const result = await request('GET', '/rules');
  if (result.status < 200 || result.status >= 300) {
    console.log(JSON.stringify(result.body, null, 2));
    process.exit(1);
  }

  const rules = Array.isArray(result.body) ? result.body : (result.body.rules || []);
  if (rules.length === 0) {
    console.log('No rules configured.');
    return;
  }

  for (const r of rules) {
    const cond = typeof r.condition === 'object' ? JSON.stringify(r.condition) : (r.condition || '{}');
    const oneOff = r.one_off ? ' [one-off]' : '';
    console.log(`[${r.id}] ${r.source} | ${cond} | ${r.action || '-'} | ${r.label || '-'} | ${r.channel || 'default'} | ${r.session_id || 'main'}${oneOff}`);
  }
}

async function cmdTrigger(flags) {
  if (!flags.source) {
    console.error('Error: --source is required for trigger');
    process.exit(1);
  }

  let data = {};
  if (flags.data) {
    try {
      data = JSON.parse(flags.data);
    } catch {
      console.error('Error: --data must be valid JSON');
      process.exit(1);
    }
  }

  if (flags.message) {
    data.message = flags.message;
  }

  const result = await request('POST', '/trigger', {
    source: flags.source,
    data,
    level: flags.level || 'info',
  });

  console.log(JSON.stringify(result.body, null, 2));
  process.exit(result.status >= 200 && result.status < 300 ? 0 : 1);
}

async function cmdSettingsGet() {
  const result = await request('GET', '/settings');
  console.log(JSON.stringify(result.body, null, 2));
  process.exit(result.status >= 200 && result.status < 300 ? 0 : 1);
}

async function cmdSettingsSet(jsonStr) {
  if (!jsonStr) {
    console.error("Error: JSON argument required. Usage: interrupt-cli.js settings set '{...}'");
    process.exit(1);
  }

  let patch;
  try {
    patch = JSON.parse(jsonStr);
  } catch {
    console.error('Error: argument must be valid JSON');
    process.exit(1);
  }

  const result = await request('PUT', '/settings', patch);
  console.log(JSON.stringify(result.body, null, 2));
  process.exit(result.status >= 200 && result.status < 300 ? 0 : 1);
}

async function cmdStats() {
  const result = await request('GET', '/stats');
  console.log(JSON.stringify(result.body, null, 2));
  process.exit(result.status >= 200 && result.status < 300 ? 0 : 1);
}

async function cmdHealth() {
  const result = await request('GET', '/health');
  console.log(JSON.stringify(result.body, null, 2));
  process.exit(result.status >= 200 && result.status < 300 ? 0 : 1);
}

async function cmdReload() {
  const result = await request('POST', '/reload');
  console.log(JSON.stringify(result.body, null, 2));
  process.exit(result.status >= 200 && result.status < 300 ? 0 : 1);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { positional, flags } = parseArgs(process.argv);
  const command = positional[0];

  if (!command || command === 'help' || flags.help) {
    usage();
    process.exit(0);
  }

  try {
    switch (command) {
      case 'add':
        await cmdAdd(flags);
        break;

      case 'remove':
        await cmdRemove(positional[1]);
        break;

      case 'list':
        await cmdList();
        break;

      case 'trigger':
        await cmdTrigger(flags);
        break;

      case 'settings': {
        const sub = positional[1];
        if (sub === 'get') {
          await cmdSettingsGet();
        } else if (sub === 'set') {
          await cmdSettingsSet(positional[2]);
        } else {
          console.error(`Unknown settings subcommand: ${sub || '(none)'}\nUsage: interrupt-cli.js settings get|set '<json>'`);
          process.exit(1);
        }
        break;
      }

      case 'stats':
        await cmdStats();
        break;

      case 'health':
        await cmdHealth();
        break;

      case 'reload':
        await cmdReload();
        break;

      default:
        console.error(`Unknown command: ${command}`);
        usage();
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
