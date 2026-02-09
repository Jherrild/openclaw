const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { resolveVaultPath, parseArgs, log, normalizeTags } = require('./lib/utils');
const { updateMapping } = require('./lib/sync-mapping');

/**
 * scribe_save - Create a NEW Obsidian note
 * Usage: node write.js <path> <content> [--tags "tag1,tag2"] [--file-id <supernote_id>]
 */

const args = parseArgs(process.argv, {
    string: ['tags', 'file-id'],
    alias: { t: 'tags' },
});

const rawPath = args._[0];
const rawContent = args._[1];

const targetPath = resolveVaultPath(rawPath);
const content = (rawContent || '').replace(/\\n/g, '\n');

if (!targetPath || !content) {
    log.error('Usage: node write.js <path> <content> [--tags "tag1,tag2"]');
    process.exit(1);
}

// 1. Write the file
try {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // SAFETY GUARD: Do not overwrite existing files
    if (fs.existsSync(targetPath)) {
        log.error(`File already exists at ${targetPath}. Use 'scribe_append' to update, or archive first.`);
        process.exit(1);
    }

    fs.writeFileSync(targetPath, content);
    log.success(`File written to: ${targetPath}`);
} catch (e) {
    log.error(`Failed to write file: ${e.message}`);
    process.exit(1);
}

// 2. Update Supernote sync mapping (best-effort)
try {
    updateMapping({ fileId: args['file-id'] || null, localPath: targetPath });
} catch (e) {
    log.warn(`Sync mapping update failed: ${e.message}`);
}

// 3. Run the linter with tags
try {
    const lintScript = path.join(__dirname, 'lint.js');
    const tags = normalizeTags(args.tags);
    const tagsArg = tags.length > 0 ? ` --tags "${tags.join(',')}"` : '';
    execSync(`node "${lintScript}" "${targetPath}"${tagsArg}`, { stdio: 'inherit' });
} catch (e) {
    log.warn(`Linting failed: ${e.message}`);
}
