#!/usr/bin/env node
// obsidian_migrate.js — Migrate buffered notes into the Obsidian vault.
//
// For each note in .agent-pending that has a .md file in its buffer directory:
//   1. Read the mapping to find the vault destination (mdPath/pdfPath)
//   2. Copy .pdf → <vault>/documents/<NoteName>.pdf
//   3. Copy .md  → <vault>/<NoteName>.md
//   4. Update the YAML mapping with mdPath + pdfPath
//   5. Clean up the buffer directory
//   6. Remove the entry from .agent-pending
//
// For NEW notes: the agent must set the mapping destination first (via mapping-utils.js set).
// For UPDATED notes: the mapping already has the destination; overwrite in place.
//
// Usage: node obsidian_migrate.js [--dry-run]

const fs = require('fs');
const path = require('path');
const { getConfig, readMapping, writeMapping, findByFileId, upsertEntry } = require('./mapping-utils');

const SKILL_DIR = __dirname;
const AGENT_PENDING = path.join(SKILL_DIR, '.agent-pending');

function log(level, msg) {
  const ts = new Date().toISOString();
  console[level === 'error' ? 'error' : 'log'](`[${ts}] [migrate] [${level}] ${msg}`);
}

function copyFile(src, dest) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(src, dest);
}

function rmDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(AGENT_PENDING)) {
    log('info', 'No .agent-pending manifest found. Nothing to migrate.');
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(AGENT_PENDING, 'utf8'));
  } catch (e) {
    log('error', `Failed to read .agent-pending: ${e.message}`);
    process.exit(1);
  }

  const config = getConfig();
  const vaultRoot = config.vault_root;
  let entries = readMapping(vaultRoot);

  const allItems = [
    ...((manifest.new || []).map(e => ({ ...e, isNew: true }))),
    ...((manifest.updated || []).map(e => ({ ...e, isNew: false }))),
  ];

  if (allItems.length === 0) {
    log('info', 'Manifest is empty. Nothing to migrate.');
    return;
  }

  const migrated = [];
  const skipped = [];

  for (const item of allItems) {
    const noteName = item.noteName || item.name.replace(/\.note$/, '');
    const noteDir = item.dir || path.join(SKILL_DIR, 'buffer', noteName);

    const bufferMd = path.join(noteDir, `${noteName}.md`);
    const bufferPdf = path.join(noteDir, `${noteName}.pdf`);

    // Check that agent has generated a .md file
    if (!fs.existsSync(bufferMd)) {
      log('warn', `Skipping '${noteName}': no .md in buffer (run store_markdown first)`);
      skipped.push(item);
      continue;
    }

    // Find mapping entry to get vault destination
    const mapped = findByFileId(entries, item.fileId);

    if (!mapped) {
      if (item.isNew) {
        log('warn', `Skipping new note '${noteName}': no mapping entry (set destination with mapping-utils.js set first)`);
        skipped.push(item);
        continue;
      }
      // Updated note without mapping — shouldn't happen, but skip gracefully
      log('warn', `Skipping updated note '${noteName}': no mapping entry found`);
      skipped.push(item);
      continue;
    }

    // Determine vault paths
    const mdRelPath = mapped.mdPath || mapped.localPath;
    if (!mdRelPath) {
      log('warn', `Skipping '${noteName}': mapping has no mdPath or localPath`);
      skipped.push(item);
      continue;
    }

    const vaultMdPath = path.join(vaultRoot, mdRelPath);
    const vaultDir = path.dirname(vaultMdPath);
    const pdfRelPath = mapped.pdfPath || path.join(path.dirname(mdRelPath), 'documents', `${noteName}.pdf`);
    const vaultPdfPath = path.join(vaultRoot, pdfRelPath);

    if (dryRun) {
      log('info', `[DRY RUN] Would migrate '${noteName}':`);
      log('info', `  .md  → ${vaultMdPath}`);
      if (fs.existsSync(bufferPdf)) {
        log('info', `  .pdf → ${vaultPdfPath}`);
      }
      migrated.push(item);
      continue;
    }

    try {
      // Copy .md to vault
      copyFile(bufferMd, vaultMdPath);
      log('info', `Copied .md → ${vaultMdPath}`);

      // Copy .pdf to vault (if exists)
      if (fs.existsSync(bufferPdf)) {
        copyFile(bufferPdf, vaultPdfPath);
        log('info', `Copied .pdf → ${vaultPdfPath}`);
      }

      // Update mapping with mdPath + pdfPath
      upsertEntry(entries, item.fileId, {
        name: item.name,
        mdPath: mdRelPath,
        pdfPath: pdfRelPath,
        modifiedTime: item.modifiedTime,
      });

      // Clean up buffer directory for this note
      rmDir(noteDir);
      log('info', `Cleaned up buffer: ${noteDir}`);

      migrated.push(item);
    } catch (e) {
      log('error', `Failed to migrate '${noteName}': ${e.message}`);
      skipped.push(item);
    }
  }

  // Write updated mapping
  if (!dryRun && migrated.length > 0) {
    writeMapping(entries, vaultRoot);
    log('info', `Updated YAML mapping (${migrated.length} entries)`);
  }

  // Update .agent-pending: keep only skipped items, or remove file if all done
  if (!dryRun) {
    if (skipped.length > 0) {
      const remaining = {
        new: skipped.filter(s => s.isNew).map(({ isNew, ...rest }) => rest),
        updated: skipped.filter(s => !s.isNew).map(({ isNew, ...rest }) => rest),
      };
      fs.writeFileSync(AGENT_PENDING, JSON.stringify(remaining, null, 2));
      log('info', `${skipped.length} item(s) still pending in .agent-pending`);
    } else {
      fs.unlinkSync(AGENT_PENDING);
      log('info', 'All items migrated. Removed .agent-pending.');
    }

    // Clean up buffer directory if empty
    const bufferDir = path.join(SKILL_DIR, 'buffer');
    if (fs.existsSync(bufferDir)) {
      try {
        const remaining = fs.readdirSync(bufferDir);
        if (remaining.length === 0) {
          fs.rmdirSync(bufferDir);
          log('info', 'Removed empty buffer directory.');
        }
      } catch {
        // non-critical
      }
    }
  }

  // Summary
  console.log(JSON.stringify({
    migrated: migrated.length,
    skipped: skipped.length,
    details: migrated.map(m => m.noteName || m.name.replace(/\.note$/, '')),
  }, null, 2));
}

main();
