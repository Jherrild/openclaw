#!/usr/bin/env node
// manage-channel.js — View or update the default notification channel in config.json.
//
// Usage:
//   node manage-channel.js get                  Show current default_channel
//   node manage-channel.js set <channel>        Update default_channel (validates against openclaw channels)
//   node manage-channel.js set <channel> --skip-validation   Update without validation
//   node manage-channel.js list-valid            List valid channels from openclaw

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CONFIG_FILE = path.join(__dirname, 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { default_channel: 'telegram' };
  }
}

function writeConfig(config) {
  const bak = CONFIG_FILE + '.bak';
  if (fs.existsSync(CONFIG_FILE)) fs.copyFileSync(CONFIG_FILE, bak);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

function fetchValidChannels() {
  try {
    const raw = execFileSync('openclaw', ['channels', 'list', '--json'], { encoding: 'utf8', timeout: 10000 });
    const data = JSON.parse(raw);
    return Object.keys(data.chat || {});
  } catch (err) {
    return null;
  }
}

function usage() {
  console.log(`Usage:
  node manage-channel.js get                           Show current default_channel
  node manage-channel.js set <channel>                 Update default_channel
  node manage-channel.js set <channel> --skip-validation   Update without validation
  node manage-channel.js list-valid                    List valid channels from openclaw`);
}

const args = process.argv.slice(2);
const command = args[0];
const skipValidation = args.includes('--skip-validation');

if (!command || command === 'help' || command === '--help') {
  usage();
  process.exit(0);
}

if (command === 'get') {
  const config = readConfig();
  console.log(`default_channel: ${config.default_channel}`);
  process.exit(0);
}

if (command === 'list-valid') {
  const channels = fetchValidChannels();
  if (channels === null) {
    console.error('Error: could not retrieve channels from openclaw. Is the gateway running?');
    process.exit(1);
  }
  console.log('Valid notification channels:');
  for (const ch of channels) console.log(`  - ${ch}`);
  if (channels.length === 0) console.log('  (none configured)');
  process.exit(0);
}

if (command === 'set') {
  const channel = args[1];
  if (!channel || channel.startsWith('--')) {
    console.error('Error: provide a channel name. Run "list-valid" to see options.');
    process.exit(1);
  }

  if (!skipValidation) {
    const channels = fetchValidChannels();
    if (channels === null) {
      console.error('Error: could not validate channel — failed to run "openclaw channels list --json". Use --skip-validation to bypass.');
      process.exit(1);
    }
    if (!channels.includes(channel)) {
      console.error(`Error: invalid channel '${channel}'. Valid channels: ${channels.join(', ')}`);
      process.exit(1);
    }
  }

  const config = readConfig();
  const oldChannel = config.default_channel;
  config.default_channel = channel;
  writeConfig(config);
  console.log(`Updated default_channel: ${oldChannel} → ${channel}`);
  process.exit(0);
}

console.error(`Unknown command: '${command}'`);
usage();
process.exit(1);
