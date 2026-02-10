const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { resolveVaultPath, parseArgs, log } = require('./lib/utils');
const { updateMapping } = require('./lib/sync-mapping');

/**
 * scribe_move - Move a note to a new location.
 * If the note has linked documents (e.g. PDFs in a sibling documents/ folder),
 * those are moved too and the supernote sync mapping is updated.
 *
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

// 3. Move the primary file
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

// 4. Move linked documents (e.g. PDFs in documents/ subfolder)
let movedPdfPath = null;
if (path.extname(finalDestPath).toLowerCase() === '.md') {
    try {
        const content = fs.readFileSync(finalDestPath, 'utf8');
        const docLinks = [];
        const linkRegex = /!\[\[documents\/([^\]]+)\]\]/g;
        let match;
        while ((match = linkRegex.exec(content)) !== null) {
            docLinks.push(match[1]);
        }

        if (docLinks.length > 0) {
            const sourceDocsDir = path.join(path.dirname(sourcePath), 'documents');
            const targetDocsDir = path.join(path.dirname(finalDestPath), 'documents');

            for (const docName of docLinks) {
                const docSource = path.join(sourceDocsDir, docName);
                const docTarget = path.join(targetDocsDir, docName);

                if (fs.existsSync(docSource)) {
                    if (!fs.existsSync(targetDocsDir)) {
                        fs.mkdirSync(targetDocsDir, { recursive: true });
                    }
                    fs.renameSync(docSource, docTarget);
                    log.success(`Moved document: ${docSource} -> ${docTarget}`);
                    if (docName.endsWith('.pdf')) {
                        movedPdfPath = docTarget;
                    }
                }
            }

            // Clean up empty source documents/ directory
            if (fs.existsSync(sourceDocsDir)) {
                try {
                    const remaining = fs.readdirSync(sourceDocsDir);
                    if (remaining.length === 0) {
                        fs.rmdirSync(sourceDocsDir);
                        log.info(`Removed empty directory: ${sourceDocsDir}`);
                    }
                } catch (e) {
                    // non-critical
                }
            }
        }
    } catch (e) {
        log.warn(`Document move scan failed: ${e.message}`);
    }
}

// 5. Update Supernote sync mapping (best-effort)
try {
    updateMapping({
        fileId: null,
        localPath: finalDestPath,
        oldPath: sourcePath,
        newPdfPath: movedPdfPath,
        oldPdfPath: null,
    });
} catch (e) {
    log.warn(`Sync mapping update failed: ${e.message}`);
}

// 6. Run Linter (ONLY for Markdown files)
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

// 7. Fire-and-forget: update local-rag index for new location
try {
    const ragScript = path.join(__dirname, '..', 'local-rag', 'rag.js');
    const child = spawn('node', [ragScript, 'index', finalDestPath], { detached: true, stdio: 'ignore' });
    child.unref();
} catch (e) {
    log.warn(`RAG index trigger failed: ${e.message}`);
}
