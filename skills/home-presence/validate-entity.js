#!/usr/bin/env node
// validate-entity.js — Checks if an entity_id exists in Home Assistant.
//
// Usage: validate-entity.js <entity_id>
// Exit code 0 = entity exists, non-zero = invalid or unreachable.
//
// Uses the HA REST API (same auth source as presence.js via mcporter.json).

const fs = require('fs');
const path = require('path');

const HA_URL = 'http://homeassistant:8123';

function getToken() {
  const cfg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'mcporter.json'), 'utf8')
  );
  const bearerArg = cfg.mcpServers['ha-stdio-final'].args
    .find(a => typeof a === 'string' && a.startsWith('Bearer '));
  return bearerArg ? bearerArg.replace('Bearer ', '').trim() : null;
}

async function main() {
  const entityId = process.argv[2];
  if (!entityId) {
    console.error(JSON.stringify({ valid: false, error: 'Usage: validate-entity.js <entity_id>' }));
    process.exit(1);
  }

  const token = getToken();
  if (!token) {
    console.error(JSON.stringify({ valid: false, error: 'Could not extract HA token from mcporter.json' }));
    process.exit(1);
  }

  try {
    const res = await fetch(`${HA_URL}/api/states/${entityId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (res.ok) {
      const state = await res.json();
      console.log(JSON.stringify({ valid: true, entity_id: entityId, state: state.state }));
      process.exit(0);
    } else if (res.status === 404) {
      console.error(JSON.stringify({ valid: false, entity_id: entityId, error: 'Entity not found in Home Assistant' }));
      process.exit(1);
    } else {
      console.error(JSON.stringify({ valid: false, entity_id: entityId, error: `HA API returned ${res.status}` }));
      process.exit(1);
    }
  } catch (err) {
    console.error(JSON.stringify({ valid: false, entity_id: entityId, error: err.message }));
    process.exit(1);
  }
}

main();
