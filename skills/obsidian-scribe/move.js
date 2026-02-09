const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { resolveVaultPath, parseArgs, log } = require('./lib/utils');
const { updateMapping } = require('./lib/sync-mapping');

/**
 * scribe_move - Move a note to a new location
 * Usage: node move.js <source_path> <target_path>
 */

const args = parseArgs(process.argv);
const rawSource = args._[0];
const rawTarget = args._[1];

const sourcePath = resolveVaultPath(rawSource);
const targetPath = resolveVaultPath(rawTarget);

if (!sourcePath || !targetPath) {
    log.error('Usage: node move.js <source_path> <target_path>');
    process.exit(1);
}

// 1. Verify Source
if (!fs.existsSync(sourcePath)) {
    log.error(`Source file not found at ${sourcePath}`);
    process.exit(1);
}

// 2. Prepare Destination
const targetDir = path.dirname(targetPath);
const filename = path.basename(targetPath);

// Handle collisions (e.g. if moving to a folder where the file already exists)
let finalDestPath = targetPath;
if (fs.existsSync(finalDestPath)) {
    const ext = path.extname(filename);
    const name = path.basename(filename, ext);
    let counter = 1;
    while (fs.existsSync(finalDestPath)) {
        finalDestPath = path.join(targetDir, `${name}-${counter}${ext}`);
        counter++;
    }
}

// 3. Move
try {
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.renameSync(sourcePath, finalDestPath);
    log.success(`Moved: ${sourcePath} -> ${finalDestPath}`);
} catch (e) {
    log.error(`Failed to move file: ${e.message}`);
    process.exit(1);
}

// 4. Update Supernote sync mapping (best-effort)
try {
    updateMapping({ fileId: null, localPath: finalDestPath, oldPath: sourcePath });
} catch (e) {
    log.warn(`Sync mapping update failed: ${e.message}`);
}

// 5. Run Linter (ONLY for Markdown files)
if (path.extname(finalDestPath).toLowerCase() === '.md') {
    try {
        const lintScript = path.join(__dirname, 'lint.js');
        execSync(`node "${lintScript}" "${finalDestPath}"`, { stdio: 'inherit' });
    } catch (e) {
        log.warn(`Linting failed: ${e.message}`);
    }
} else {
    log.info('Skipping linter for non-markdown file.');
}
