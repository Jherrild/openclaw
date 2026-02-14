/**
 * lib/para-detect.js — PARA location detection from file paths
 * 
 * Detects Projects/Areas/Resources/Archive structure from Obsidian vault paths.
 * Used by: scribe, local-rag FTS5 indexing, memory provider.
 */
const path = require('path');
const fs = require('fs');

const PARA_CATEGORIES = {
  '1-Projects': { label: 'Projects', weight: 'active' },
  '1-projects': { label: 'Projects', weight: 'active' },
  'Projects':   { label: 'Projects', weight: 'active' },
  '2-Areas':    { label: 'Areas', weight: 'active' },
  '2-areas':    { label: 'Areas', weight: 'active' },
  'Areas':      { label: 'Areas', weight: 'active' },
  '3-Resources': { label: 'Resources', weight: 'reference' },
  '3-resources': { label: 'Resources', weight: 'reference' },
  'Resources':   { label: 'Resources', weight: 'reference' },
  '4-Archive':   { label: 'Archive', weight: 'archived' },
  '4-archive':   { label: 'Archive', weight: 'archived' },
  'Archive':     { label: 'Archive', weight: 'archived' },
};

/**
 * Detect PARA category and area from a file path.
 * @param {string} filePath - Absolute or vault-relative path
 * @param {string} [vaultRoot] - Vault root for making path relative
 * @returns {{ category: string|null, area: string|null, label: string|null, weight: string|null }}
 */
function detectParaLocation(filePath, vaultRoot) {
  let rel = filePath;
  if (vaultRoot && path.isAbsolute(filePath)) {
    rel = path.relative(vaultRoot, filePath);
  }

  const parts = rel.split(path.sep).filter(Boolean);
  if (parts.length === 0) return { category: null, area: null, label: null, weight: null };

  const topFolder = parts[0];
  const paraInfo = PARA_CATEGORIES[topFolder];

  if (!paraInfo) return { category: null, area: null, label: null, weight: null };

  return {
    category: topFolder,
    area: parts.length > 1 ? parts[1] : null,
    label: paraInfo.label,
    weight: paraInfo.weight,
  };
}

/**
 * Detect whether a vault uses PARA structure.
 * Checks for 2+ recognized PARA top-level folders.
 * @param {string} vaultPath - Absolute path to vault root
 * @returns {boolean}
 */
function isParaStructured(vaultPath) {
  try {
    const entries = fs.readdirSync(vaultPath, { withFileTypes: true });
    const paraFolders = entries.filter(e => e.isDirectory() && PARA_CATEGORIES[e.name]);
    return paraFolders.length >= 2;
  } catch {
    return false;
  }
}

module.exports = {
  PARA_CATEGORIES,
  detectParaLocation,
  isParaStructured,
};
