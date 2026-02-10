#!/usr/bin/env node
// vault_update.js — Update the vault root path in config.json.
//
// All mapping paths are vault-relative, so changing the vault root is a
// single config update — no rewriting of mapping entries needed.
//
// Usage: node vault_update.js --path <new-vault-root>

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');

function main() {
  const args = process.argv.slice(2);
  let newPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--path' && args[i + 1]) {
      newPath = args[++i];
    }
  }

  if (!newPath) {
    console.error('Usage: node vault_update.js --path <new-vault-root>');
    process.exit(1);
  }

  // Normalize: ensure trailing slash is stripped for consistency
  newPath = newPath.replace(/\/+$/, '');

  if (!fs.existsSync(newPath)) {
    console.error(`Warning: Path does not exist yet: ${newPath}`);
    console.error('Proceeding anyway (path may be created later).');
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    console.error(`Error reading config.json: ${e.message}`);
    process.exit(1);
  }

  const oldPath = config.vault_root;
  config.vault_root = newPath;

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log(`Updated vault_root: ${oldPath} → ${newPath}`);
}

main();
