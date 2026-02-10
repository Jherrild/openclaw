#!/usr/bin/env node
// interrupt-cli.js — CLI client for the Interrupt Service daemon.
//
// Usage:
//   interrupt-cli.js trigger --source <src> [--data <json>] [--level <info|warn|alert>]
//   interrupt-cli.js stats
//   interrupt-cli.js health
//   interrupt-cli.js reload
//
// Collectors (ha-bridge, mail-sentinel, etc.) call this to inject events
// into the central Interrupt Service without needing to manage state.

const http = require('http');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

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
  const command = args[0];
  const flags = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      const key = args[i].slice(2);
      flags[key] = args[i + 1];
      i++;
    }
  }

  return { command, flags };
}

function usage() {
  console.log(`Usage:
  interrupt-cli.js trigger --source <src> [--data <json>] [--level info|warn|alert] [--message <text>]
  interrupt-cli.js add-rule --id <id> --source <src> [--condition <json>] [--action message|subagent] [--message <text>]
  interrupt-cli.js stats
  interrupt-cli.js health
  interrupt-cli.js reload

Commands:
  trigger   Send an event to the interrupt service
  add-rule  Add or update a rule (validated against source-specific checks)
  stats     Show pipeline statistics and active rules
  health    Check if the service is running
  reload    Reload rules from disk

Options for trigger:
  --source   (required) Event source identifier (e.g., home-assistant, email, system)
  --data     JSON string of event data (default: {})
  --level    Priority level: info, warn, alert (default: info)
  --message  Shorthand: sets data.message (merged with --data if both provided)

Options for add-rule:
  --id        (required) Unique rule identifier
  --source    (required) Source type (e.g., ha.state_change, email, system)
  --condition JSON string of match conditions (default: {})
  --action    Action type: message or subagent (default: message)
  --message   Message template (supports {{placeholder}} interpolation)
  --channel   Delivery channel for subagent actions (default: telegram)

Examples:
  interrupt-cli.js trigger --source home-assistant --data '{"entity_id":"binary_sensor.motion","state":"on"}'
  interrupt-cli.js trigger --source email --data '{"subject":"Server down","priority":true}' --level alert
  interrupt-cli.js trigger --source system --message "Disk usage above 90%" --level warn
  interrupt-cli.js add-rule --id motion-alert --source ha.state_change --condition '{"entity_id":"binary_sensor.front_door_motion"}' --action message --message "Motion at front door: {{new_state}}"
  interrupt-cli.js stats
  interrupt-cli.js health`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { command, flags } = parseArgs(process.argv);

  if (!command || command === 'help' || command === '--help') {
    usage();
    process.exit(0);
  }

  try {
    switch (command) {
      case 'trigger': {
        if (!flags.source) {
          console.error('Error: --source is required');
          usage();
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

        // --message shorthand
        if (flags.message) {
          data.message = flags.message;
        }

        const result = await request('POST', '/trigger', {
          source: flags.source,
          data,
          level: flags.level || 'info',
        });

        console.log(JSON.stringify(result.body, null, 2));
        process.exit(result.status === 200 ? 0 : 1);
        break;
      }

      case 'add-rule': {
        if (!flags.id) {
          console.error('Error: --id is required');
          usage();
          process.exit(1);
        }
        if (!flags.source) {
          console.error('Error: --source is required');
          usage();
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

        const rulePayload = {
          id: flags.id,
          source: flags.source,
          condition,
          action: flags.action || 'message',
          enabled: true,
        };
        if (flags.message) rulePayload.message = flags.message;
        if (flags.channel) rulePayload.channel = flags.channel;

        const ruleResult = await request('POST', '/add-rule', rulePayload);
        console.log(JSON.stringify(ruleResult.body, null, 2));
        process.exit(ruleResult.status === 200 ? 0 : 1);
        break;
      }

      case 'stats': {
        const result = await request('GET', '/stats');
        console.log(JSON.stringify(result.body, null, 2));
        break;
      }

      case 'health': {
        const result = await request('GET', '/health');
        console.log(JSON.stringify(result.body, null, 2));
        break;
      }

      case 'reload': {
        const result = await request('POST', '/reload');
        console.log(JSON.stringify(result.body, null, 2));
        break;
      }

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
