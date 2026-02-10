#!/usr/bin/env node
// mapping-utils.js — Read/write YAML mapping in Obsidian vault.
//
// The mapping lives at <vault>/metadata/supernote-sync-mapping.md as YAML.
// This module provides helpers for all sync scripts and agent tools.
//
// Usage as CLI:
//   node mapping-utils.js read                     → print all entries as JSON
//   node mapping-utils.js get <fileId>             → print one entry as JSON
//   node mapping-utils.js set <fileId> <json>      → upsert an entry
//   node mapping-utils.js remove <fileId>          → remove an entry
//   node mapping-utils.js migrate <old-json-path>  → one-time migration from JSON
//
// Usage as module:
//   const { readMapping, writeMapping, findByFileId, upsertEntry, removeEntry, getConfig } = require('./mapping-utils');

const fs = require('fs');
const path = require('path');

const SKILL_DIR = __dirname;
const CONFIG_FILE = path.join(SKILL_DIR, 'config.json');
const MAPPING_FILENAME = 'metadata/supernote-sync-mapping.md';

// ── Config ──────────────────────────────────────────────────────────────────

function getConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to read config.json: ${err.message}`);
  }
}

function getMappingPath(vaultRoot) {
  if (!vaultRoot) vaultRoot = getConfig().vault_root;
  return path.join(vaultRoot, MAPPING_FILENAME);
}

// ── YAML Parsing (minimal, no deps) ────────────────────────────────────────
// The YAML is a simple list of objects with string values. No nested structures.

function parseYamlEntries(yamlBody) {
  const entries = [];
  let current = null;

  for (const rawLine of yamlBody.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith('#')) continue;

    // New entry starts with "- key: value"
    const listMatch = line.match(/^- (\w+):\s*(.*)$/);
    if (listMatch) {
      if (current) entries.push(current);
      current = {};
      current[listMatch[1]] = stripQuotes(listMatch[2]);
      continue;
    }

    // Continuation "  key: value"
    const propMatch = line.match(/^\s+(\w+):\s*(.*)$/);
    if (propMatch && current) {
      current[propMatch[1]] = stripQuotes(propMatch[2]);
    }
  }
  if (current) entries.push(current);
  return entries;
}

function stripQuotes(s) {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function entriesToYaml(entries) {
  const lines = [];
  for (const entry of entries) {
    const keys = Object.keys(entry);
    if (keys.length === 0) continue;
    lines.push(`- ${keys[0]}: "${entry[keys[0]]}"`);
    for (let i = 1; i < keys.length; i++) {
      lines.push(`  ${keys[i]}: "${entry[keys[i]]}"`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildMappingFile(entries) {
  return `---
description: Supernote file sync mappings (auto-managed by supernote-sync)
---

${entriesToYaml(entries)}`;
}

// ── Read / Write ────────────────────────────────────────────────────────────

function readMapping(vaultRoot) {
  const mappingPath = getMappingPath(vaultRoot);
  if (!fs.existsSync(mappingPath)) return [];

  const content = fs.readFileSync(mappingPath, 'utf8');
  // Strip frontmatter
  const fmEnd = content.indexOf('---', content.indexOf('---') + 3);
  const body = fmEnd !== -1 ? content.slice(fmEnd + 3) : content;
  return parseYamlEntries(body);
}

function writeMapping(entries, vaultRoot) {
  const mappingPath = getMappingPath(vaultRoot);
  const dir = path.dirname(mappingPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Backup
  if (fs.existsSync(mappingPath)) {
    fs.copyFileSync(mappingPath, mappingPath + '.bak');
  }

  fs.writeFileSync(mappingPath, buildMappingFile(entries));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function findByFileId(entries, fileId) {
  return entries.find(e => e.fileId === fileId) || null;
}

function upsertEntry(entries, fileId, fields) {
  const idx = entries.findIndex(e => e.fileId === fileId);
  if (idx !== -1) {
    entries[idx] = { ...entries[idx], ...fields, fileId };
  } else {
    entries.push({ fileId, ...fields });
  }
  return entries;
}

function removeEntry(entries, fileId) {
  return entries.filter(e => e.fileId !== fileId);
}

function findByPath(entries, vaultRelativePath) {
  return entries.find(e =>
    e.localPath === vaultRelativePath ||
    e.mdPath === vaultRelativePath ||
    e.pdfPath === vaultRelativePath
  ) || null;
}

// ── Migration from old JSON format ──────────────────────────────────────────

function migrateFromJson(jsonPath, vaultRoot) {
  if (!vaultRoot) vaultRoot = getConfig().vault_root;
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const entries = [];

  for (const [key, value] of Object.entries(raw)) {
    if (key === 'files') continue; // legacy key
    if (!value || typeof value !== 'object') continue;

    const localPath = value.localPath || '';
    // Convert absolute path to vault-relative
    let relativePath = localPath;
    if (localPath.startsWith(vaultRoot)) {
      relativePath = localPath.slice(vaultRoot.length).replace(/^\//, '');
    }

    // Infer name from path basename
    const name = path.basename(localPath);

    entries.push({
      fileId: key,
      name: name,
      localPath: relativePath,
      modifiedTime: value.modifiedTime || '',
    });
  }

  writeMapping(entries, vaultRoot);
  return entries;
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  getConfig,
  getMappingPath,
  readMapping,
  writeMapping,
  findByFileId,
  findByPath,
  upsertEntry,
  removeEntry,
  migrateFromJson,
};

// ── CLI ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const [,, command, ...args] = process.argv;

  try {
    const config = getConfig();
    const vaultRoot = config.vault_root;

    switch (command) {
      case 'read': {
        const entries = readMapping(vaultRoot);
        console.log(JSON.stringify(entries, null, 2));
        break;
      }
      case 'get': {
        const entries = readMapping(vaultRoot);
        const entry = findByFileId(entries, args[0]);
        if (entry) {
          console.log(JSON.stringify(entry, null, 2));
        } else {
          console.error(`Entry not found: ${args[0]}`);
          process.exit(1);
        }
        break;
      }
      case 'set': {
        const entries = readMapping(vaultRoot);
        const fields = JSON.parse(args[1]);
        upsertEntry(entries, args[0], fields);
        writeMapping(entries, vaultRoot);
        console.log(`Updated entry: ${args[0]}`);
        break;
      }
      case 'remove': {
        let entries = readMapping(vaultRoot);
        const before = entries.length;
        entries = removeEntry(entries, args[0]);
        if (entries.length < before) {
          writeMapping(entries, vaultRoot);
          console.log(`Removed entry: ${args[0]}`);
        } else {
          console.error(`Entry not found: ${args[0]}`);
          process.exit(1);
        }
        break;
      }
      case 'migrate': {
        const jsonPath = args[0] || path.join(SKILL_DIR, 'sync-mapping.json');
        const result = migrateFromJson(jsonPath, vaultRoot);
        console.log(`Migrated ${result.length} entries to ${getMappingPath(vaultRoot)}`);
        break;
      }
      default:
        console.log(`Usage:
  node mapping-utils.js read
  node mapping-utils.js get <fileId>
  node mapping-utils.js set <fileId> '<json>'
  node mapping-utils.js remove <fileId>
  node mapping-utils.js migrate [old-json-path]`);
        process.exit(command ? 1 : 0);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
