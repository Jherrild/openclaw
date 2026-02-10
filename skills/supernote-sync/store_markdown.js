#!/usr/bin/env node
// store_markdown.js — Write agent-generated markdown into a note's buffer directory.
//
// The agent calls this after categorizing a note to store the enriched .md content
// (with frontmatter, PDF embed, extracted text) before calling obsidian_migrate.
//
// Usage: node store_markdown.js --file-id <id> --content "<markdown>"
//    or: node store_markdown.js --file-id <id> --stdin  (reads content from stdin)

const fs = require('fs');
const path = require('path');

const SKILL_DIR = __dirname;
const AGENT_PENDING = path.join(SKILL_DIR, '.agent-pending');

function main() {
  const args = process.argv.slice(2);
  let fileId = null;
  let content = null;
  let useStdin = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file-id' && args[i + 1]) {
      fileId = args[++i];
    } else if (args[i] === '--content' && args[i + 1]) {
      content = args[++i];
    } else if (args[i] === '--stdin') {
      useStdin = true;
    }
  }

  if (!fileId) {
    console.error('Usage: node store_markdown.js --file-id <id> --content "<markdown>"');
    console.error('   or: node store_markdown.js --file-id <id> --stdin');
    process.exit(1);
  }

  if (useStdin) {
    content = fs.readFileSync('/dev/stdin', 'utf8');
  }

  if (!content) {
    console.error('Error: No content provided. Use --content or --stdin.');
    process.exit(1);
  }

  // Find the note's buffer directory from the manifest
  if (!fs.existsSync(AGENT_PENDING)) {
    console.error('Error: No .agent-pending manifest found.');
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(AGENT_PENDING, 'utf8'));
  } catch (e) {
    console.error(`Error reading .agent-pending: ${e.message}`);
    process.exit(1);
  }

  // Search both new and updated entries
  const allEntries = [...(manifest.new || []), ...(manifest.updated || [])];
  const entry = allEntries.find(e => e.fileId === fileId);

  if (!entry) {
    console.error(`Error: fileId '${fileId}' not found in .agent-pending manifest.`);
    process.exit(1);
  }

  const noteName = entry.noteName || entry.name.replace(/\.note$/, '');
  const noteDir = entry.dir || path.join(SKILL_DIR, 'buffer', noteName);
  const mdPath = path.join(noteDir, `${noteName}.md`);

  if (!fs.existsSync(noteDir)) {
    console.error(`Error: Buffer directory not found: ${noteDir}`);
    process.exit(1);
  }

  fs.writeFileSync(mdPath, content);
  console.log(JSON.stringify({ success: true, path: mdPath }));
}

main();
