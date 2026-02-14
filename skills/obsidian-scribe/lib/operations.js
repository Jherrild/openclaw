/**
 * lib/operations.js — Shared operations for obsidian-scribe
 * 
 * Core file operations used by all commands and the programmatic API.
 * Eliminates duplicated logic across write.js, append.js, move.js, archive.js.
 */
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { VAULT_ROOT, resolveVaultPath, log, normalizeTags } = require('./utils');
const { buildFrontmatter } = require('./frontmatter');

const LINT_SCRIPT = path.join(__dirname, '..', 'lint.js');
const RAG_SCRIPT = path.join(__dirname, '..', '..', 'local-rag', 'rag.js');

/**
 * Ensure parent directories exist for a file path.
 */
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Create a .bak backup of a file before mutation.
 * @param {string} absPath - Absolute path to file
 * @returns {string|null} Backup path, or null if file doesn't exist
 */
function createBackup(absPath) {
  if (!fs.existsSync(absPath)) return null;
  const bakPath = absPath + '.bak';
  fs.copyFileSync(absPath, bakPath);
  return bakPath;
}

/**
 * Run the linter on a file. Non-blocking on failure.
 * @param {string} absPath - Absolute path to file
 * @param {object} [opts] - Options
 * @param {string[]} [opts.tags] - Additional tags to merge
 * @param {boolean} [opts.check] - If true, validate only (no write)
 * @param {boolean} [opts.skip] - If true, skip linting entirely
 */
function runLint(absPath, opts = {}) {
  if (opts.skip) return;
  if (path.extname(absPath).toLowerCase() !== '.md') return;

  try {
    const tags = normalizeTags(opts.tags);
    const tagsArg = tags.length > 0 ? ` --tags "${tags.join(',')}"` : '';
    const checkArg = opts.check ? ' --check' : '';
    execSync(`node "${LINT_SCRIPT}" "${absPath}"${tagsArg}${checkArg}`, { stdio: 'inherit' });
  } catch (e) {
    log.warn(`Linting failed: ${e.message}`);
  }
}

/**
 * Fire-and-forget local-rag re-index for a file.
 * @param {string} absPath - Absolute path to the file to index
 */
function triggerRagIndex(absPath) {
  try {
    const child = spawn('node', [RAG_SCRIPT, 'index', absPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (e) {
    log.warn(`RAG index trigger failed: ${e.message}`);
  }
}

/**
 * Read content from CLI arg or stdin.
 * @param {string|null} cliContent - Content from CLI argument
 * @param {boolean} useStdin - Whether to read from stdin
 * @returns {Promise<string>} Content string
 */
async function readContent(cliContent, useStdin = false) {
  if (useStdin) {
    return new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', chunk => { data += chunk; });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
      // If stdin is a TTY (interactive), fall back to CLI arg
      if (process.stdin.isTTY) {
        resolve(cliContent || '');
      }
    });
  }
  return (cliContent || '').replace(/\\n/g, '\n');
}

/**
 * Format a chat-friendly diff for edit preview.
 * No ANSI codes — designed for Telegram/chat display.
 * @param {string} original - Original file content
 * @param {string} modified - Modified file content
 * @param {number} [contextLines=2] - Lines of context around changes
 * @returns {string} Formatted diff string
 */
function formatDiff(original, modified, contextLines = 2) {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');

  // Find first differing line
  let firstDiff = -1;
  const maxLen = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (origLines[i] !== modLines[i]) {
      firstDiff = i;
      break;
    }
  }
  if (firstDiff === -1) return '(no changes)';

  // Find last differing line
  let lastDiff = firstDiff;
  for (let i = maxLen - 1; i > firstDiff; i--) {
    if (origLines[i] !== modLines[i]) {
      lastDiff = i;
      break;
    }
  }

  const startCtx = Math.max(0, firstDiff - contextLines);
  const endCtx = Math.min(maxLen - 1, lastDiff + contextLines);

  const lines = [];
  for (let i = startCtx; i <= endCtx; i++) {
    const lineNum = i + 1;
    const orig = origLines[i];
    const mod = modLines[i];

    if (orig === mod) {
      lines.push(`  ${lineNum} | ${orig || ''}`);
    } else {
      if (orig !== undefined) lines.push(`- ${lineNum} | ${orig}`);
      if (mod !== undefined) lines.push(`+ ${lineNum} | ${mod}    ← changed`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  ensureDir,
  createBackup,
  runLint,
  triggerRagIndex,
  readContent,
  formatDiff,
  VAULT_ROOT,
  resolveVaultPath,
  log,
  normalizeTags,
};
