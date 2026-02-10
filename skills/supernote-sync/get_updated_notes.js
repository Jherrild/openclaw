#!/usr/bin/env node
// get_updated_notes.js — Returns JSON array of updated notes (already mapped).
//
// For updated notes the sync script has already refreshed the buffer content.
// This tool provides the agent with the updated text so it can regenerate
// the vault .md file if needed.
//
// Usage: node get_updated_notes.js
// Output: JSON array to stdout

const fs = require('fs');
const path = require('path');
const { getConfig, readMapping, findByFileId } = require('./mapping-utils');

const SKILL_DIR = __dirname;
const AGENT_PENDING = path.join(SKILL_DIR, '.agent-pending');

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function main() {
  if (!fs.existsSync(AGENT_PENDING)) {
    console.log(JSON.stringify([]));
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(AGENT_PENDING, 'utf8'));
  } catch (e) {
    console.error(`Error reading .agent-pending: ${e.message}`);
    process.exit(1);
  }

  const updatedNotes = manifest.updated || [];
  if (updatedNotes.length === 0) {
    console.log(JSON.stringify([]));
    return;
  }

  const config = getConfig();
  const entries = readMapping(config.vault_root);
  const results = [];

  for (const entry of updatedNotes) {
    const noteDir = entry.dir || path.join(SKILL_DIR, 'buffer', entry.noteName || entry.name.replace(/\.note$/, ''));
    const noteName = entry.noteName || entry.name.replace(/\.note$/, '');

    const txtPath = path.join(noteDir, `${noteName}.txt`);
    const pdfPath = path.join(noteDir, `${noteName}.pdf`);

    // Look up existing vault paths from the YAML mapping
    const mapped = findByFileId(entries, entry.fileId);
    const mdPath = mapped ? (mapped.mdPath || mapped.localPath || null) : null;
    const existingPdfPath = mapped ? (mapped.pdfPath || null) : null;

    results.push({
      fileId: entry.fileId,
      name: noteName,
      text: readTextFile(txtPath),
      pdfPath: fs.existsSync(pdfPath) ? pdfPath : null,
      mdPath: mdPath ? path.join(config.vault_root, mdPath) : null,
      existingPdfPath: existingPdfPath ? path.join(config.vault_root, existingPdfPath) : null,
      modifiedTime: entry.modifiedTime,
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

main();
