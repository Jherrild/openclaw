#!/usr/bin/env node
// Tests for obsidian-scribe: sync-mapping.js and move.js document co-movement.
// All tests use temp directories — no production data is touched.
//
// Usage: node skills/obsidian-scribe/test-unit.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILL_DIR = __dirname;
const SUPERNOTE_DIR = path.join(SKILL_DIR, '..', 'supernote-sync');
let tmpDir;
let passed = 0;
let failed = 0;
const failures = [];

// ── Helpers ────────────────────────────────────────────────────────────────

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribe-test-'));
  fs.mkdirSync(path.join(tmpDir, 'vault', 'metadata'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'vault', '2-Areas', 'Notes', 'documents'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'vault', '3-Resources', 'documents'), { recursive: true });

  // Override supernote-sync config to point at temp vault
  const configPath = path.join(SUPERNOTE_DIR, 'config.json');
  fs.copyFileSync(configPath, path.join(tmpDir, 'config.json.bak'));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.vault_root = path.join(tmpDir, 'vault');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  // Seed a YAML mapping with test entries
  const mu = freshRequire(path.join(SUPERNOTE_DIR, 'mapping-utils'));
  const vaultRoot = path.join(tmpDir, 'vault');
  const entries = [
    { fileId: 'scribe-test-1', name: 'Meeting Notes.note', mdPath: '2-Areas/Notes/Meeting Notes.md', pdfPath: '2-Areas/Notes/documents/Meeting Notes.pdf', modifiedTime: '2026-01-01T00:00:00Z' },
    { fileId: 'scribe-test-2', name: 'Quick Note.note', localPath: '2-Areas/Notes/Quick Note.note', modifiedTime: '2026-01-02T00:00:00Z' },
  ];
  mu.writeMapping(entries, vaultRoot);
}

function teardown() {
  // Restore original config
  const configPath = path.join(SUPERNOTE_DIR, 'config.json');
  const bakPath = path.join(tmpDir, 'config.json.bak');
  if (fs.existsSync(bakPath)) {
    fs.copyFileSync(bakPath, configPath);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function freshRequire(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

// ── lib/sync-mapping.js tests ──────────────────────────────────────────────

function testSyncMapping() {
  console.log('\n── lib/sync-mapping.js ──');

  const sm = freshRequire('./lib/sync-mapping');
  const vaultRoot = path.join(tmpDir, 'vault');

  test('getVaultRoot returns temp vault path', () => {
    const root = sm.getVaultRoot();
    assert.strictEqual(root, vaultRoot);
  });

  test('toVaultRelative strips vault root prefix', () => {
    const abs = path.join(vaultRoot, '2-Areas/Notes/Test.md');
    const rel = sm.toVaultRelative(abs, vaultRoot);
    assert.strictEqual(rel, '2-Areas/Notes/Test.md');
  });

  test('toVaultRelative returns path unchanged if not under vault', () => {
    const rel = sm.toVaultRelative('/some/other/path.md', vaultRoot);
    assert.strictEqual(rel, '/some/other/path.md');
  });

  test('findEntryByPath finds by mdPath', () => {
    const entry = sm.findEntryByPath('2-Areas/Notes/Meeting Notes.md');
    assert.ok(entry);
    assert.strictEqual(entry.fileId, 'scribe-test-1');
  });

  test('findEntryByPath finds by localPath', () => {
    const entry = sm.findEntryByPath('2-Areas/Notes/Quick Note.note');
    assert.ok(entry);
    assert.strictEqual(entry.fileId, 'scribe-test-2');
  });

  test('findEntryByPath returns null for unknown path', () => {
    const entry = sm.findEntryByPath('nonexistent/path.md');
    assert.strictEqual(entry, null);
  });

  test('updateMapping updates mdPath and pdfPath for moved file', () => {
    const oldPath = path.join(vaultRoot, '2-Areas/Notes/Meeting Notes.md');
    const newPath = path.join(vaultRoot, '3-Resources/Meeting Notes.md');

    sm.updateMapping({
      fileId: null,
      localPath: newPath,
      oldPath: oldPath,
      newPdfPath: path.join(vaultRoot, '3-Resources/documents/Meeting Notes.pdf'),
      oldPdfPath: null,
    });

    // Verify the mapping was updated
    const mu = freshRequire(path.join(SUPERNOTE_DIR, 'mapping-utils'));
    const entries = mu.readMapping(vaultRoot);
    const entry = mu.findByFileId(entries, 'scribe-test-1');
    assert.strictEqual(entry.mdPath, '3-Resources/Meeting Notes.md');
    assert.strictEqual(entry.pdfPath, '3-Resources/documents/Meeting Notes.pdf');
  });

  test('updateMapping infers pdfPath from md move when not explicit', () => {
    // Reset mapping
    const mu = freshRequire(path.join(SUPERNOTE_DIR, 'mapping-utils'));
    let entries = mu.readMapping(vaultRoot);
    // Set entry back to original
    mu.upsertEntry(entries, 'scribe-test-1', {
      mdPath: '2-Areas/Notes/Meeting Notes.md',
      pdfPath: '2-Areas/Notes/documents/Meeting Notes.pdf',
    });
    mu.writeMapping(entries, vaultRoot);

    // Clear sync-mapping module cache to pick up fresh mapping
    const sm2 = freshRequire('./lib/sync-mapping');

    const oldPath = path.join(vaultRoot, '2-Areas/Notes/Meeting Notes.md');
    const newPath = path.join(vaultRoot, '3-Resources/Meeting Notes.md');

    sm2.updateMapping({
      fileId: null,
      localPath: newPath,
      oldPath: oldPath,
      newPdfPath: null,  // not provided explicitly
      oldPdfPath: null,
    });

    entries = mu.readMapping(vaultRoot);
    const entry = mu.findByFileId(entries, 'scribe-test-1');
    assert.strictEqual(entry.pdfPath, '3-Resources/documents/Meeting Notes.pdf', 'Should infer pdfPath from md move');
  });

  test('updateMapping ignores non-supernote files', () => {
    const sm3 = freshRequire('./lib/sync-mapping');
    const mu = freshRequire(path.join(SUPERNOTE_DIR, 'mapping-utils'));
    const entriesBefore = mu.readMapping(vaultRoot);

    sm3.updateMapping({
      fileId: null,
      localPath: path.join(vaultRoot, 'random/untracked-file.md'),
      oldPath: path.join(vaultRoot, 'other/untracked-file.md'),
    });

    const entriesAfter = mu.readMapping(vaultRoot);
    assert.strictEqual(entriesBefore.length, entriesAfter.length, 'Entry count should not change');
  });
}

// ── move.js document co-movement tests ─────────────────────────────────────

function testMoveDocumentCoMovement() {
  console.log('\n── move.js (document co-movement) ──');

  const vaultRoot = path.join(tmpDir, 'vault');

  test('moves linked documents alongside .md file', () => {
    // Create source .md with a document link
    const srcDir = path.join(vaultRoot, '2-Areas', 'Source');
    const srcDocsDir = path.join(srcDir, 'documents');
    fs.mkdirSync(srcDocsDir, { recursive: true });

    const mdContent = '---\ntags: [supernote]\n---\n# Test\n![[documents/Test File.pdf]]\nSome text';
    fs.writeFileSync(path.join(srcDir, 'Test File.md'), mdContent);
    fs.writeFileSync(path.join(srcDocsDir, 'Test File.pdf'), 'fake pdf content');

    // Target
    const dstDir = path.join(vaultRoot, '3-Resources', 'Dest');

    // Run move.js (it uses VAULT_ROOT from lib/utils.js — we override via absolute paths)
    const srcPath = path.join(srcDir, 'Test File.md');
    const dstPath = path.join(dstDir, 'Test File.md');

    try {
      const { execSync } = require('child_process');
      execSync(`node "${path.join(SKILL_DIR, 'move.js')}" "${srcPath}" "${dstPath}"`, {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (e) {
      // move.js may warn about linting/RAG — that's fine
      if (!fs.existsSync(dstPath)) throw e;
    }

    // Verify .md was moved
    assert.ok(fs.existsSync(dstPath), 'MD should be at destination');
    assert.ok(!fs.existsSync(srcPath), 'MD should not remain at source');

    // Verify PDF was co-moved
    const dstDocsDir = path.join(dstDir, 'documents');
    assert.ok(fs.existsSync(path.join(dstDocsDir, 'Test File.pdf')), 'PDF should be at destination documents/');
    assert.ok(!fs.existsSync(path.join(srcDocsDir, 'Test File.pdf')), 'PDF should not remain at source');

    // Verify empty source documents/ was cleaned up
    assert.ok(!fs.existsSync(srcDocsDir), 'Empty source documents/ should be removed');
  });

  test('does not fail when .md has no document links', () => {
    const srcDir = path.join(vaultRoot, '2-Areas', 'NoLinks');
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'Plain.md'), '# Just text\nNo embeds here');

    const dstDir = path.join(vaultRoot, '3-Resources', 'MovedPlain');
    const srcPath = path.join(srcDir, 'Plain.md');
    const dstPath = path.join(dstDir, 'Plain.md');

    try {
      const { execSync } = require('child_process');
      execSync(`node "${path.join(SKILL_DIR, 'move.js')}" "${srcPath}" "${dstPath}"`, {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (e) {
      if (!fs.existsSync(dstPath)) throw e;
    }

    assert.ok(fs.existsSync(dstPath), 'MD should be moved');
    assert.ok(!fs.existsSync(srcPath), 'Source should be removed');
  });

  test('handles collision avoidance', () => {
    const srcDir = path.join(vaultRoot, '2-Areas', 'Collision');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'Dupe.md'), '# Original');

    const dstDir = path.join(vaultRoot, '3-Resources', 'CollisionDest');
    fs.mkdirSync(dstDir, { recursive: true });
    // Create existing file at destination
    fs.writeFileSync(path.join(dstDir, 'Dupe.md'), '# Existing');

    const srcPath = path.join(srcDir, 'Dupe.md');
    const dstPath = path.join(dstDir, 'Dupe.md');

    try {
      const { execSync } = require('child_process');
      execSync(`node "${path.join(SKILL_DIR, 'move.js')}" "${srcPath}" "${dstPath}"`, {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (e) {
      // May have warnings
    }

    // Original should still be there
    assert.ok(fs.existsSync(path.join(dstDir, 'Dupe.md')), 'Original should remain');
    // Collision-renamed file should exist
    assert.ok(fs.existsSync(path.join(dstDir, 'Dupe-1.md')), 'Collision-renamed file should exist');
    assert.ok(!fs.existsSync(srcPath), 'Source should be removed');
  });
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log('obsidian-scribe unit tests');
console.log('='.repeat(50));

try {
  setup();
  testSyncMapping();
  testMoveDocumentCoMovement();
} finally {
  teardown();
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ✗ ${f.name}: ${f.error}`);
  }
  process.exit(1);
}
