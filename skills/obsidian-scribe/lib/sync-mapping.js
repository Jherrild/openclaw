/**
 * Helpers for reading/writing the Supernote sync mapping (YAML-based).
 * Delegates to supernote-sync/mapping-utils.js which manages the vault YAML file.
 */
const path = require('path');
const { log } = require('./utils');

let mappingUtils;
try {
    mappingUtils = require('../../supernote-sync/mapping-utils');
} catch (e) {
    // Graceful degradation if supernote-sync is not installed
    mappingUtils = null;
}

function getVaultRoot() {
    if (!mappingUtils) return null;
    try {
        return mappingUtils.getConfig().vault_root;
    } catch {
        return null;
    }
}

/**
 * Convert an absolute path to vault-relative.
 */
function toVaultRelative(absPath, vaultRoot) {
    if (!vaultRoot || !absPath) return absPath;
    if (absPath.startsWith(vaultRoot)) {
        return absPath.slice(vaultRoot.length).replace(/^\//, '');
    }
    return absPath;
}

/**
 * Find a mapping entry by vault-relative path (checks localPath, mdPath, pdfPath).
 */
function findEntryByPath(relPath) {
    if (!mappingUtils) return null;
    const vaultRoot = getVaultRoot();
    if (!vaultRoot) return null;
    const entries = mappingUtils.readMapping(vaultRoot);
    return mappingUtils.findByPath(entries, relPath);
}

/**
 * Update sync mapping when a file is moved.
 * Handles both the old localPath schema and the new mdPath/pdfPath schema.
 *
 * @param {object} opts
 * @param {string|null} opts.fileId - Supernote file ID (if known)
 * @param {string} opts.localPath - New absolute path of the moved .md file
 * @param {string|null} opts.oldPath - Previous absolute path
 * @param {string|null} opts.newPdfPath - New absolute path of the PDF (if moved)
 * @param {string|null} opts.oldPdfPath - Previous absolute path of the PDF
 */
function updateMapping({ fileId, localPath, oldPath, newPdfPath, oldPdfPath }) {
    if (!mappingUtils) return;

    const vaultRoot = getVaultRoot();
    if (!vaultRoot) return;

    const entries = mappingUtils.readMapping(vaultRoot);
    const relOld = toVaultRelative(oldPath, vaultRoot);
    const relNew = toVaultRelative(localPath, vaultRoot);

    // Find the entry: by fileId, by old path, or by filename
    let entry = null;
    if (fileId) {
        entry = mappingUtils.findByFileId(entries, fileId);
    }
    if (!entry && relOld) {
        entry = mappingUtils.findByPath(entries, relOld);
    }
    if (!entry) {
        // Try matching by filename across all path fields
        const filename = path.basename(localPath);
        entry = entries.find(e => {
            const checkPath = e.mdPath || e.localPath || '';
            return path.basename(checkPath) === filename;
        });
    }

    if (!entry) return; // Not a supernote-tracked file

    // Build updated fields
    const updates = {};
    if (entry.mdPath !== undefined || entry.localPath !== undefined) {
        // Prefer mdPath for new schema, keep localPath updated for compat
        updates.mdPath = relNew;
        updates.localPath = relNew;
    }
    if (newPdfPath) {
        updates.pdfPath = toVaultRelative(newPdfPath, vaultRoot);
    } else if (entry.pdfPath && oldPath) {
        // Infer new PDF path from the .md move
        const oldDir = path.dirname(relOld);
        const newDir = path.dirname(relNew);
        if (entry.pdfPath.startsWith(oldDir + '/documents/')) {
            updates.pdfPath = entry.pdfPath.replace(oldDir + '/documents/', newDir + '/documents/');
        }
    }

    mappingUtils.upsertEntry(entries, entry.fileId, updates);
    mappingUtils.writeMapping(entries, vaultRoot);
    log.success(`Sync mapping updated for ${entry.fileId} (${path.basename(relNew)})`);
}

module.exports = { findEntryByPath, updateMapping, toVaultRelative, getVaultRoot };
