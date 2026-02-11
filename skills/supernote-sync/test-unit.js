#!/usr/bin/env node
// Tests for supernote-sync: mapping-utils.js and agent tools.
// All tests use temp directories — no production data is touched.
//
// Usage: node skills/supernote-sync/test-unit.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const SKILL_DIR = __dirname;
let tmpDir;
let passed = 0;
let failed = 0;
const failures = [];

// ── Helpers ────────────────────────────────────────────────────────────────

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supernote-test-'));
  // Create a mock vault with metadata dir
  fs.mkdirSync(path.join(tmpDir, 'vault', 'metadata'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'buffer'), { recursive: true });

  // Write a mock config.json that points to our temp vault
  const configPath = path.join(SKILL_DIR, 'config.json');
  // Save original config
  fs.copyFileSync(configPath, path.join(tmpDir, 'config.json.bak'));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config._original_vault_root = config.vault_root;
  config.vault_root = path.join(tmpDir, 'vault');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function teardown() {
  // Restore original config
  const configPath = path.join(SKILL_DIR, 'config.json');
  const bakPath = path.join(tmpDir, 'config.json.bak');
  if (fs.existsSync(bakPath)) {
    fs.copyFileSync(bakPath, configPath);
  }
  // Clean up temp dir
  fs.rmSync(tmpDir, { recursive: true, force: true });
  // Clean up any .agent-pending we created
  const pending = path.join(SKILL_DIR, '.agent-pending');
  if (fs.existsSync(pending)) {
    const content = fs.readFileSync(pending, 'utf8');
    if (content.includes('test-file-id')) {
      fs.unlinkSync(pending);
    }
  }
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

// Force fresh require (clear module cache)
function freshRequire(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

// ── mapping-utils.js tests ─────────────────────────────────────────────────

function testMappingUtils() {
  console.log('\n── mapping-utils.js ──');

  const mu = freshRequire('./mapping-utils');
  const vaultRoot = path.join(tmpDir, 'vault');

  test('readMapping returns empty array for missing file', () => {
    const entries = mu.readMapping(vaultRoot);
    assert.deepStrictEqual(entries, []);
  });

  test('writeMapping + readMapping round-trip', () => {
    const entries = [
      { fileId: 'abc123', name: 'Test.note', localPath: '2-Areas/Test.note', modifiedTime: '2026-01-01T00:00:00Z' },
      { fileId: 'def456', name: 'Other.note', mdPath: '3-Resources/Other.md', pdfPath: '3-Resources/documents/Other.pdf', modifiedTime: '2026-01-02T00:00:00Z' },
    ];
    mu.writeMapping(entries, vaultRoot);
    const read = mu.readMapping(vaultRoot);
    assert.strictEqual(read.length, 2);
    assert.strictEqual(read[0].fileId, 'abc123');
    assert.strictEqual(read[0].name, 'Test.note');
    assert.strictEqual(read[0].localPath, '2-Areas/Test.note');
    assert.strictEqual(read[1].fileId, 'def456');
    assert.strictEqual(read[1].mdPath, '3-Resources/Other.md');
    assert.strictEqual(read[1].pdfPath, '3-Resources/documents/Other.pdf');
  });

  test('writeMapping creates .bak file on subsequent writes', () => {
    // First write creates the file; second write triggers backup
    const entries = mu.readMapping(vaultRoot);
    mu.writeMapping(entries, vaultRoot);  // second write
    const mappingPath = mu.getMappingPath(vaultRoot);
    assert.ok(fs.existsSync(mappingPath + '.bak'), 'Backup file should exist after second write');
  });

  test('findByFileId finds existing entry', () => {
    const entries = mu.readMapping(vaultRoot);
    const found = mu.findByFileId(entries, 'abc123');
    assert.ok(found);
    assert.strictEqual(found.name, 'Test.note');
  });

  test('findByFileId returns null for missing', () => {
    const entries = mu.readMapping(vaultRoot);
    const found = mu.findByFileId(entries, 'nonexistent');
    assert.strictEqual(found, null);
  });

  test('findByPath matches localPath', () => {
    const entries = mu.readMapping(vaultRoot);
    const found = mu.findByPath(entries, '2-Areas/Test.note');
    assert.ok(found);
    assert.strictEqual(found.fileId, 'abc123');
  });

  test('findByPath matches mdPath', () => {
    const entries = mu.readMapping(vaultRoot);
    const found = mu.findByPath(entries, '3-Resources/Other.md');
    assert.ok(found);
    assert.strictEqual(found.fileId, 'def456');
  });

  test('findByPath matches pdfPath', () => {
    const entries = mu.readMapping(vaultRoot);
    const found = mu.findByPath(entries, '3-Resources/documents/Other.pdf');
    assert.ok(found);
    assert.strictEqual(found.fileId, 'def456');
  });

  test('findByPath returns null for no match', () => {
    const entries = mu.readMapping(vaultRoot);
    assert.strictEqual(mu.findByPath(entries, 'nonexistent/path'), null);
  });

  test('upsertEntry updates existing entry', () => {
    let entries = mu.readMapping(vaultRoot);
    mu.upsertEntry(entries, 'abc123', { mdPath: '1-Projects/Test.md' });
    assert.strictEqual(entries.find(e => e.fileId === 'abc123').mdPath, '1-Projects/Test.md');
    assert.strictEqual(entries.length, 2, 'Should not add duplicate');
  });

  test('upsertEntry adds new entry', () => {
    let entries = mu.readMapping(vaultRoot);
    mu.upsertEntry(entries, 'new789', { name: 'New.note', localPath: '2-Areas/New.note' });
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries.find(e => e.fileId === 'new789').name, 'New.note');
  });

  test('removeEntry removes by fileId', () => {
    let entries = mu.readMapping(vaultRoot);
    entries = mu.removeEntry(entries, 'new789');
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(mu.findByFileId(entries, 'new789'), null);
  });

  test('YAML preserves quotes and special characters', () => {
    const entries = [
      { fileId: 'special', name: 'Note: "Test" & More.note', localPath: '2-Areas/Note.note' },
    ];
    mu.writeMapping(entries, vaultRoot);
    const read = mu.readMapping(vaultRoot);
    assert.strictEqual(read[0].name, 'Note: "Test" & More.note');
  });
}

// ── get_new_notes.js tests ─────────────────────────────────────────────────

function testGetNewNotes() {
  console.log('\n── get_new_notes.js ──');

  test('returns empty array when no .agent-pending', () => {
    const pending = path.join(SKILL_DIR, '.agent-pending');
    if (fs.existsSync(pending)) fs.unlinkSync(pending);
    const result = execSync(`node "${path.join(SKILL_DIR, 'get_new_notes.js')}"`, { encoding: 'utf8' });
    assert.deepStrictEqual(JSON.parse(result), []);
  });

  test('returns new notes from manifest with text content', () => {
    const noteDir = path.join(SKILL_DIR, 'buffer', 'Test Note');
    fs.mkdirSync(noteDir, { recursive: true });
    fs.writeFileSync(path.join(noteDir, 'Test Note.txt'), 'Hello world extracted text');
    fs.writeFileSync(path.join(noteDir, 'Test Note.pdf'), 'fake pdf');

    const manifest = {
      new: [{ fileId: 'test-file-id-1', name: 'Test Note.note', noteName: 'Test Note', dir: noteDir, modifiedTime: '2026-01-01T00:00:00Z' }],
      updated: [],
    };
    fs.writeFileSync(path.join(SKILL_DIR, '.agent-pending'), JSON.stringify(manifest));

    const result = JSON.parse(execSync(`node "${path.join(SKILL_DIR, 'get_new_notes.js')}"`, { encoding: 'utf8' }));
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].fileId, 'test-file-id-1');
    assert.strictEqual(result[0].name, 'Test Note');
    assert.strictEqual(result[0].text, 'Hello world extracted text');
    assert.ok(result[0].pdfPath.endsWith('Test Note.pdf'));

    // Cleanup
    fs.rmSync(noteDir, { recursive: true, force: true });
    fs.unlinkSync(path.join(SKILL_DIR, '.agent-pending'));
  });

  test('handles missing text/pdf gracefully', () => {
    const noteDir = path.join(SKILL_DIR, 'buffer', 'Empty Note');
    fs.mkdirSync(noteDir, { recursive: true });

    const manifest = {
      new: [{ fileId: 'test-file-id-2', name: 'Empty Note.note', noteName: 'Empty Note', dir: noteDir, modifiedTime: '2026-01-01T00:00:00Z' }],
      updated: [],
    };
    fs.writeFileSync(path.join(SKILL_DIR, '.agent-pending'), JSON.stringify(manifest));

    const result = JSON.parse(execSync(`node "${path.join(SKILL_DIR, 'get_new_notes.js')}"`, { encoding: 'utf8' }));
    assert.strictEqual(result[0].text, '');
    assert.strictEqual(result[0].pdfPath, null);

    fs.rmSync(noteDir, { recursive: true, force: true });
    fs.unlinkSync(path.join(SKILL_DIR, '.agent-pending'));
  });
}

// ── store_markdown.js tests ────────────────────────────────────────────────

function testStoreMarkdown() {
  console.log('\n── store_markdown.js ──');

  test('writes markdown to correct buffer directory', () => {
    const noteDir = path.join(SKILL_DIR, 'buffer', 'Store Test');
    fs.mkdirSync(noteDir, { recursive: true });

    const manifest = {
      new: [{ fileId: 'test-file-id-store', name: 'Store Test.note', noteName: 'Store Test', dir: noteDir, modifiedTime: '2026-01-01T00:00:00Z' }],
      updated: [],
    };
    fs.writeFileSync(path.join(SKILL_DIR, '.agent-pending'), JSON.stringify(manifest));

    const mdContent = '---\ntags: [supernote]\n---\n# Store Test\nHello!';
    execSync(`node "${path.join(SKILL_DIR, 'store_markdown.js')}" --file-id test-file-id-store --content "${mdContent.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });

    const written = fs.readFileSync(path.join(noteDir, 'Store Test.md'), 'utf8');
    assert.ok(written.includes('# Store Test'));
    assert.ok(written.includes('tags: [supernote]'));

    fs.rmSync(noteDir, { recursive: true, force: true });
    fs.unlinkSync(path.join(SKILL_DIR, '.agent-pending'));
  });

  test('fails with unknown file ID', () => {
    const manifest = { new: [], updated: [] };
    fs.writeFileSync(path.join(SKILL_DIR, '.agent-pending'), JSON.stringify(manifest));

    try {
      execSync(`node "${path.join(SKILL_DIR, 'store_markdown.js')}" --file-id nonexistent --content "test"`, { encoding: 'utf8', stdio: 'pipe' });
      assert.fail('Should have thrown');
    } catch (e) {
      assert.ok(e.status !== 0);
    }

    fs.unlinkSync(path.join(SKILL_DIR, '.agent-pending'));
  });
}

// ── obsidian_migrate.js tests ──────────────────────────────────────────────

function testObsidianMigrate() {
  console.log('\n── obsidian_migrate.js ──');

  const mu = freshRequire('./mapping-utils');
  const vaultRoot = path.join(tmpDir, 'vault');

  test('migrates new note to vault (md + pdf)', () => {
    // Set up buffer with a note
    const noteDir = path.join(SKILL_DIR, 'buffer', 'Migrate Test');
    fs.mkdirSync(noteDir, { recursive: true });
    fs.writeFileSync(path.join(noteDir, 'Migrate Test.md'), '# Migrate Test\nContent here');
    fs.writeFileSync(path.join(noteDir, 'Migrate Test.pdf'), 'fake pdf data');

    // Set up mapping with a destination
    let entries = mu.readMapping(vaultRoot);
    mu.upsertEntry(entries, 'test-migrate-id', {
      name: 'Migrate Test.note',
      mdPath: '2-Areas/Notes/Migrate Test.md',
      pdfPath: '2-Areas/Notes/documents/Migrate Test.pdf',
      modifiedTime: '2026-01-01T00:00:00Z',
    });
    mu.writeMapping(entries, vaultRoot);

    // Create the vault target dirs (obsidian_migrate will create them, but let's be safe)
    const manifest = {
      new: [{ fileId: 'test-migrate-id', name: 'Migrate Test.note', noteName: 'Migrate Test', dir: noteDir, modifiedTime: '2026-01-01T00:00:00Z' }],
      updated: [],
    };
    fs.writeFileSync(path.join(SKILL_DIR, '.agent-pending'), JSON.stringify(manifest));

    const result = JSON.parse(execSync(`node "${path.join(SKILL_DIR, 'obsidian_migrate.js')}"`, { encoding: 'utf8' }));
    assert.strictEqual(result.migrated, 1);
    assert.strictEqual(result.skipped, 0);

    // Verify files in vault
    const vaultMd = path.join(vaultRoot, '2-Areas/Notes/Migrate Test.md');
    const vaultPdf = path.join(vaultRoot, '2-Areas/Notes/documents/Migrate Test.pdf');
    assert.ok(fs.existsSync(vaultMd), 'MD should exist in vault');
    assert.ok(fs.existsSync(vaultPdf), 'PDF should exist in vault');
    const mdContent = fs.readFileSync(vaultMd, 'utf8');
    assert.ok(mdContent.includes('# Migrate Test'), 'MD should contain original heading');
    assert.ok(mdContent.includes('Content here'), 'MD should contain original body');
    assert.ok(mdContent.startsWith('---\n'), 'MD should be linted with frontmatter');

    // Verify buffer cleaned up
    assert.ok(!fs.existsSync(noteDir), 'Buffer dir should be removed');

    // Verify .agent-pending removed
    assert.ok(!fs.existsSync(path.join(SKILL_DIR, '.agent-pending')), '.agent-pending should be removed');

    // Verify mapping updated
    entries = mu.readMapping(vaultRoot);
    const entry = mu.findByFileId(entries, 'test-migrate-id');
    assert.strictEqual(entry.mdPath, '2-Areas/Notes/Migrate Test.md');
    assert.strictEqual(entry.pdfPath, '2-Areas/Notes/documents/Migrate Test.pdf');
  });

  test('skips note without .md in buffer', () => {
    const noteDir = path.join(SKILL_DIR, 'buffer', 'No MD Note');
    fs.mkdirSync(noteDir, { recursive: true });
    fs.writeFileSync(path.join(noteDir, 'No MD Note.pdf'), 'pdf only');

    const manifest = {
      new: [{ fileId: 'test-no-md', name: 'No MD Note.note', noteName: 'No MD Note', dir: noteDir, modifiedTime: '2026-01-01T00:00:00Z' }],
      updated: [],
    };
    fs.writeFileSync(path.join(SKILL_DIR, '.agent-pending'), JSON.stringify(manifest));

    const result = JSON.parse(execSync(`node "${path.join(SKILL_DIR, 'obsidian_migrate.js')}"`, { encoding: 'utf8' }));
    assert.strictEqual(result.migrated, 0);
    assert.strictEqual(result.skipped, 1);

    // .agent-pending should still exist with the skipped item
    assert.ok(fs.existsSync(path.join(SKILL_DIR, '.agent-pending')));

    fs.rmSync(noteDir, { recursive: true, force: true });
    fs.unlinkSync(path.join(SKILL_DIR, '.agent-pending'));
  });

  test('dry-run does not modify files', () => {
    const noteDir = path.join(SKILL_DIR, 'buffer', 'Dry Run Note');
    fs.mkdirSync(noteDir, { recursive: true });
    fs.writeFileSync(path.join(noteDir, 'Dry Run Note.md'), '# Dry Run');
    fs.writeFileSync(path.join(noteDir, 'Dry Run Note.pdf'), 'pdf');

    let entries = mu.readMapping(vaultRoot);
    mu.upsertEntry(entries, 'test-dry-run', {
      name: 'Dry Run Note.note',
      mdPath: '2-Areas/DryRun/Dry Run Note.md',
      pdfPath: '2-Areas/DryRun/documents/Dry Run Note.pdf',
      modifiedTime: '2026-01-01T00:00:00Z',
    });
    mu.writeMapping(entries, vaultRoot);

    const manifest = {
      new: [{ fileId: 'test-dry-run', name: 'Dry Run Note.note', noteName: 'Dry Run Note', dir: noteDir, modifiedTime: '2026-01-01T00:00:00Z' }],
      updated: [],
    };
    fs.writeFileSync(path.join(SKILL_DIR, '.agent-pending'), JSON.stringify(manifest));

    execSync(`node "${path.join(SKILL_DIR, 'obsidian_migrate.js')}" --dry-run`, { encoding: 'utf8' });

    // Buffer should still exist
    assert.ok(fs.existsSync(noteDir), 'Buffer should not be removed in dry-run');
    // Vault files should NOT exist
    assert.ok(!fs.existsSync(path.join(vaultRoot, '2-Areas/DryRun/Dry Run Note.md')));

    fs.rmSync(noteDir, { recursive: true, force: true });
    fs.unlinkSync(path.join(SKILL_DIR, '.agent-pending'));
  });
}

// ── vault_update.js tests ──────────────────────────────────────────────────

function testVaultUpdate() {
  console.log('\n── vault_update.js ──');

  test('updates vault_root in config.json', () => {
    const newPath = path.join(tmpDir, 'new-vault');
    fs.mkdirSync(newPath, { recursive: true });

    execSync(`node "${path.join(SKILL_DIR, 'vault_update.js')}" --path "${newPath}"`, { encoding: 'utf8' });

    const config = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'config.json'), 'utf8'));
    assert.strictEqual(config.vault_root, newPath);

    // Restore for other tests
    config.vault_root = path.join(tmpDir, 'vault');
    fs.writeFileSync(path.join(SKILL_DIR, 'config.json'), JSON.stringify(config, null, 2) + '\n');
  });

  test('strips trailing slashes', () => {
    const newPath = path.join(tmpDir, 'slash-vault');
    fs.mkdirSync(newPath, { recursive: true });

    execSync(`node "${path.join(SKILL_DIR, 'vault_update.js')}" --path "${newPath}///"`, { encoding: 'utf8' });

    const config = JSON.parse(fs.readFileSync(path.join(SKILL_DIR, 'config.json'), 'utf8'));
    assert.strictEqual(config.vault_root, newPath);

    config.vault_root = path.join(tmpDir, 'vault');
    fs.writeFileSync(path.join(SKILL_DIR, 'config.json'), JSON.stringify(config, null, 2) + '\n');
  });
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log('supernote-sync unit tests');
console.log('='.repeat(50));

try {
  setup();
  testMappingUtils();
  testGetNewNotes();
  testStoreMarkdown();
  testObsidianMigrate();
  testVaultUpdate();
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
