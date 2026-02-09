const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { resolveVaultPath, parseArgs, log, normalizeTags } = require('./lib/utils');

/**
 * scribe_append - Append content to an existing Obsidian note
 * Usage: node append.js <path> <content_to_append> [--tags "tag1,tag2"]
 */

const args = parseArgs(process.argv, {
    string: ['tags'],
    alias: { t: 'tags' },
});

const rawPath = args._[0];
const rawContent = args._[1];

const targetPath = resolveVaultPath(rawPath);
const content = (rawContent || '').replace(/\\n/g, '\n');

if (!targetPath || !content) {
    log.error('Usage: node append.js <path> <content_to_append> [--tags "tag1,tag2"]');
    process.exit(1);
}

// 1. Read or Initialize
let originalContent = '';
try {
    if (fs.existsSync(targetPath)) {
        originalContent = fs.readFileSync(targetPath, 'utf8');
    }
} catch (e) {
    log.error(`Failed to read existing file: ${e.message}`);
    process.exit(1);
}

// 2. Append (smartly)
let newContent = originalContent;
if (newContent && !newContent.endsWith('\n')) {
    newContent += '\n';
}
if (newContent && !newContent.endsWith('\n\n')) {
    newContent += '\n';
}
newContent += content;

// 3. Write
try {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(targetPath, newContent);
    log.success(`Appended to: ${targetPath}`);
} catch (e) {
    log.error(`Failed to write file: ${e.message}`);
    process.exit(1);
}

// 4. Run the linter with tags
try {
    const lintScript = path.join(__dirname, 'lint.js');
    const tags = normalizeTags(args.tags);
    const tagsArg = tags.length > 0 ? ` --tags "${tags.join(',')}"` : '';
    execSync(`node "${lintScript}" "${targetPath}"${tagsArg}`, { stdio: 'inherit' });
} catch (e) {
    log.warn(`Linting failed: ${e.message}`);
}

// 5. Fire-and-forget: update local-rag index
try {
    const ragScript = path.join(__dirname, '..', 'local-rag', 'rag.js');
    const child = spawn('node', [ragScript, 'index', targetPath], { detached: true, stdio: 'ignore' });
    child.unref();
} catch (e) {
    log.warn(`RAG index trigger failed: ${e.message}`);
}
