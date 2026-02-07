/**
 * Shared utilities for obsidian-scribe
 */
const path = require('path');
const minimist = require('minimist');

// VAULT ROOT CONFIGURATION
const VAULT_ROOT = '/mnt/c/Users/Jherr/Documents/remote-personal/';

/**
 * Resolve a path relative to the vault root if not absolute
 * @param {string} inputPath - The path to resolve
 * @returns {string|null} - The resolved absolute path or null
 */
function resolveVaultPath(inputPath) {
    if (!inputPath) return null;
    if (path.isAbsolute(inputPath)) return inputPath;
    return path.join(VAULT_ROOT, inputPath);
}

/**
 * Parse CLI arguments using minimist
 * @param {string[]} argv - process.argv
 * @param {object} opts - minimist options (alias, boolean, string, default)
 * @returns {object} - parsed arguments
 */
function parseArgs(argv, opts = {}) {
    return minimist(argv.slice(2), opts);
}

/**
 * Simple logger with prefixes
 */
const log = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${msg}`),
    success: (msg) => console.log(`[OK] ${msg}`),
};

/**
 * Normalize tags from various inputs (string, array, comma-separated)
 * @param {string|string[]} input - Tag input
 * @returns {string[]} - Array of clean tag names (without #)
 */
function normalizeTags(input) {
    if (!input) return [];
    
    let tags = [];
    if (Array.isArray(input)) {
        tags = input;
    } else if (typeof input === 'string') {
        // Handle comma or space separated tags
        tags = input.split(/[\s,]+/).filter(Boolean);
    }
    
    // Clean: remove # prefix, trim, filter empty
    return tags.map(t => t.replace(/^#/, '').trim()).filter(t => t.length > 0);
}

module.exports = {
    VAULT_ROOT,
    resolveVaultPath,
    parseArgs,
    log,
    normalizeTags,
};
