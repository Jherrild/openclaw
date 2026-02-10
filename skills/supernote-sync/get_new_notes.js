#!/usr/bin/env node
// get_new_notes.js — Returns JSON array of new notes awaiting categorization.
//
// Reads .agent-pending manifest and buffer directories to provide the agent
// with everything needed to categorize and file new Supernote notes.
//
// Usage: node get_new_notes.js
// Output: JSON array to stdout

const fs = require('fs');
const path = require('path');

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

  const newNotes = manifest.new || [];
  const results = [];

  for (const entry of newNotes) {
    const noteDir = entry.dir || path.join(SKILL_DIR, 'buffer', entry.noteName || entry.name.replace(/\.note$/, ''));
    const noteName = entry.noteName || entry.name.replace(/\.note$/, '');

    const txtPath = path.join(noteDir, `${noteName}.txt`);
    const pdfPath = path.join(noteDir, `${noteName}.pdf`);

    results.push({
      fileId: entry.fileId,
      name: noteName,
      text: readTextFile(txtPath),
      pdfPath: fs.existsSync(pdfPath) ? pdfPath : null,
      modifiedTime: entry.modifiedTime,
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

main();
