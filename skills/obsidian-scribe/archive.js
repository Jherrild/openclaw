const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { VAULT_ROOT, resolveVaultPath, parseArgs, log } = require('./lib/utils');

/**
 * scribe_archive - Move a note to the 4-Archive folder
 * Usage: node archive.js <path_to_note>
 */

const args = parseArgs(process.argv);
const rawPath = args._[0];
const targetPath = resolveVaultPath(rawPath);

if (!targetPath) {
    log.error('Usage: node archive.js <path_to_note>');
    process.exit(1);
}

const ARCHIVE_DIR = path.join(VAULT_ROOT, '4-Archive');

// 1. Verify Source
if (!fs.existsSync(targetPath)) {
    log.error(`Source file not found at ${targetPath}`);
    process.exit(1);
}

// 2. Determine Destination
const relativePath = path.relative(VAULT_ROOT, targetPath);
const pathParts = relativePath.split(path.sep);

// Logic: Preserve subdirectory structure. 
// ONLY strip the top-level folder if it is a standard PARA folder (1-Projects, 2-Areas, 3-Resources).
const paraRegex = /^[1-4]-/;
const firstPart = pathParts[0];

let archiveRelPath;
if (pathParts.length > 1 && paraRegex.test(firstPart)) {
    archiveRelPath = path.join(...pathParts.slice(1));
} else {
    archiveRelPath = relativePath;
}

let destPath = path.join(ARCHIVE_DIR, archiveRelPath);
const destDir = path.dirname(destPath);
const filename = path.basename(destPath);

// Handle collisions (e.g., Note.md -> Note-1.md)
if (fs.existsSync(destPath)) {
    const ext = path.extname(filename);
    const name = path.basename(filename, ext);
    let counter = 1;
    while (fs.existsSync(destPath)) {
        destPath = path.join(destDir, `${name}-${counter}${ext}`);
        counter++;
    }
}

// 3. Move
try {
    const targetDir = path.dirname(destPath);
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.renameSync(targetPath, destPath);
    log.success(`Archived: ${targetPath} -> ${destPath}`);
} catch (e) {
    log.error(`Failed to archive file: ${e.message}`);
    process.exit(1);
}

// 4. Run Linter (ONLY for Markdown files)
if (path.extname(destPath).toLowerCase() === '.md') {
    try {
        const lintScript = path.join(__dirname, 'lint.js');
        execSync(`node "${lintScript}" "${destPath}"`, { stdio: 'inherit' });
    } catch (e) {
        log.warn(`Linting failed: ${e.message}`);
    }
} else {
    log.info('Skipping linter for non-markdown file.');
}

// 5. Fire-and-forget: update local-rag index for archived location
try {
    const ragScript = path.join(__dirname, '..', 'local-rag', 'rag.js');
    const child = spawn('node', [ragScript, 'index', destPath], { detached: true, stdio: 'ignore' });
    child.unref();
} catch (e) {
    log.warn(`RAG index trigger failed: ${e.message}`);
}
