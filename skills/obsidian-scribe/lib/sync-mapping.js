/**
 * Helpers for reading/writing the Supernote sync-mapping.json
 */
const fs = require('fs');
const path = require('path');
const { log } = require('./utils');

const SYNC_MAPPING_PATH = path.resolve(__dirname, '../../supernote-sync/sync-mapping.json');

/**
 * Load the sync mapping. Returns null if missing or corrupt.
 */
function loadMapping() {
    try {
        if (!fs.existsSync(SYNC_MAPPING_PATH)) {
            log.warn(`Sync mapping not found at ${SYNC_MAPPING_PATH}`);
            return null;
        }
        return JSON.parse(fs.readFileSync(SYNC_MAPPING_PATH, 'utf-8'));
    } catch (e) {
        log.warn(`Failed to read sync mapping: ${e.message}`);
        return null;
    }
}

/**
 * Save the sync mapping back to disk.
 */
function saveMapping(mapping) {
    try {
        fs.writeFileSync(SYNC_MAPPING_PATH, JSON.stringify(mapping, null, 2) + '\n');
        return true;
    } catch (e) {
        log.warn(`Failed to write sync mapping: ${e.message}`);
        return false;
    }
}

/**
 * Find the mapping key (file ID) for an entry matching a given localPath.
 */
function findKeyByLocalPath(mapping, localPath) {
    for (const [key, val] of Object.entries(mapping)) {
        if (key === 'files') continue;
        if (val && val.localPath === localPath) return key;
    }
    return null;
}

/**
 * Find the mapping key whose localPath basename matches the given filename.
 */
function findKeyByFilename(mapping, filename) {
    for (const [key, val] of Object.entries(mapping)) {
        if (key === 'files') continue;
        if (val && val.localPath && path.basename(val.localPath) === filename) return key;
    }
    return null;
}

/**
 * Update or add a mapping entry.
 * @param {string|null} fileId - Supernote file ID (if known)
 * @param {string} localPath - The new local path for the note
 * @param {string|null} oldPath - Previous local path (for move lookups)
 */
function updateMapping({ fileId, localPath, oldPath }) {
    const mapping = loadMapping();
    if (!mapping) return;

    const filename = path.basename(localPath);
    // Determine the key: explicit fileId > lookup by oldPath > lookup by filename
    let key = fileId
        || (oldPath && findKeyByLocalPath(mapping, oldPath))
        || findKeyByFilename(mapping, filename);

    if (!key) return; // not a Supernote-tracked file

    if (!mapping[key]) {
        mapping[key] = {};
    }
    mapping[key].localPath = localPath;
    mapping[key].modifiedTime = new Date().toISOString();

    if (saveMapping(mapping)) {
        log.success(`Sync mapping updated for ${key}`);
    }
}

module.exports = { loadMapping, saveMapping, findKeyByLocalPath, findKeyByFilename, updateMapping, SYNC_MAPPING_PATH };
