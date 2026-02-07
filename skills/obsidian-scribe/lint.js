const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const fm = require('front-matter');
const { VAULT_ROOT, resolveVaultPath, parseArgs, log, normalizeTags } = require('./lib/utils');

/**
 * Obsidian Scribe Linter v2.0
 * Uses js-yaml and front-matter for robust YAML handling.
 */

const LINTER_CONFIG_PATH = path.join(VAULT_ROOT, '.obsidian/plugins/obsidian-linter/data.json');

function getLinterConfig() {
    try {
        const data = fs.readFileSync(LINTER_CONFIG_PATH, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return { ruleConfigs: {} };
    }
}

function toTitleCase(str) {
    const minorWords = /^(a|an|and|as|at|but|by|en|for|if|in|of|on|or|the|to|v\.?|via)$/i;
    return str.split(' ').map((word, index, words) => {
        if (index > 0 && index < words.length - 1 && minorWords.test(word)) {
            return word.toLowerCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
}

function getTimestamp() {
    return new Date().toLocaleString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: 'numeric', 
        minute: 'numeric', 
        second: 'numeric', 
        hour12: true 
    }).replace(',', '');
}

/**
 * Extract inline tags from body content (lines that are just tags)
 * Returns { cleanBody, extractedTags }
 */
function extractInlineTags(body) {
    const lines = body.split('\n');
    const extractedTags = [];
    const cleanLines = [];
    
    for (const line of lines) {
        const trimmed = line.trim();
        // Match lines that are ONLY hashtags (e.g., "#tag1 #tag2" or "tags: #tag1 #tag2")
        const tagLineMatch = trimmed.match(/^(?:tags:\s*)?((#[\w-]+\s*)+)$/);
        if (tagLineMatch && !trimmed.startsWith('##')) {
            // Extract tags from this line
            const tags = trimmed.replace(/^tags:\s*/, '').match(/#[\w-]+/g) || [];
            extractedTags.push(...tags.map(t => t.replace(/^#/, '')));
        } else {
            cleanLines.push(line);
        }
    }
    
    // Trim trailing empty lines that resulted from tag removal
    while (cleanLines.length > 0 && cleanLines[cleanLines.length - 1].trim() === '') {
        cleanLines.pop();
    }
    
    return { cleanBody: cleanLines.join('\n'), extractedTags };
}

/**
 * Main linting function
 * @param {string} content - File content
 * @param {string} filename - Base filename
 * @param {object} config - Linter config
 * @param {string[]} additionalTags - Tags passed via CLI --tags
 */
function applyRules(content, filename, config, additionalTags = []) {
    const rules = config.ruleConfigs || {};
    const timestamp = getTimestamp();
    const titleFromFilename = filename.replace('.md', '');
    
    // Parse existing frontmatter using front-matter library
    let parsed;
    try {
        parsed = fm(content);
    } catch (e) {
        // If parsing fails, treat as no frontmatter
        parsed = { attributes: {}, body: content, frontmatter: '' };
    }
    
    let frontmatter = parsed.attributes || {};
    let body = parsed.body || '';
    
    // Extract inline tags from body
    const { cleanBody, extractedTags } = extractInlineTags(body);
    body = cleanBody;
    
    // Merge all tags: existing frontmatter tags + extracted body tags + CLI tags
    let existingTags = [];
    if (frontmatter.tags) {
        if (Array.isArray(frontmatter.tags)) {
            existingTags = frontmatter.tags;
        } else if (typeof frontmatter.tags === 'string') {
            existingTags = frontmatter.tags.split(/[\s,]+/).filter(Boolean);
        }
    }
    existingTags = existingTags.map(t => String(t).replace(/^#/, ''));
    
    const allTags = [...new Set([...existingTags, ...extractedTags, ...additionalTags])].filter(Boolean);
    
    // Ensure required frontmatter fields
    if (!frontmatter.title) frontmatter.title = titleFromFilename;
    if (!frontmatter['date created']) frontmatter['date created'] = timestamp;
    frontmatter['date modified'] = timestamp;
    if (!frontmatter.aliases) frontmatter.aliases = '';
    frontmatter.tags = allTags.length > 0 ? allTags : [];
    
    // Apply text rules to body
    let lines = body.split('\n');
    
    // 1. Capitalize Headings
    if (rules['capitalize-headings']?.enabled) {
        lines = lines.map(line => {
            const match = line.match(/^(#+\s+)(.*)$/);
            if (match) {
                const level = match[1];
                const text = match[2].trim();
                if (text === '') return line;
                return level + toTitleCase(text);
            }
            return line;
        });
    }
    
    // 2. Trailing Spaces
    if (rules['trailing-spaces']?.enabled) {
        lines = lines.map(line => line.trimEnd());
    }
    
    // 3. Heading Blank Lines
    if (rules['heading-blank-lines']?.enabled) {
        const newLines = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (i > 0 && trimmed.match(/^#+\s+\S+/) && newLines.length > 0 && newLines[newLines.length - 1] !== '') {
                newLines.push('');
            }
            newLines.push(line);
        }
        lines = newLines;
    }
    
    body = lines.join('\n');
    
    // 4. Document End Newline
    if (rules['line-break-at-document-end']?.enabled) {
        if (!body.endsWith('\n')) {
            body += '\n';
        }
    }
    
    // Serialize frontmatter using js-yaml
    // Use custom dump options for clean output
    const yamlStr = yaml.dump(frontmatter, {
        quotingType: '"',
        forceQuotes: false,
        lineWidth: -1, // No line wrapping
        noRefs: true,
    }).trim();
    
    // Reconstruct file: frontmatter + body
    let result = `---\n${yamlStr}\n---\n`;
    if (body.trim()) {
        result += '\n' + body.trimStart();
    }
    
    return result;
}

// CLI execution
const args = parseArgs(process.argv, {
    string: ['tags'],
    alias: { t: 'tags' },
});

const targetFile = args._[0];
if (!targetFile) {
    log.error('Usage: node lint.js <file-path> [--tags "tag1,tag2"]');
    process.exit(1);
}

const resolvedPath = resolveVaultPath(targetFile);
const additionalTags = normalizeTags(args.tags);

try {
    const config = getLinterConfig();
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const linted = applyRules(content, path.basename(resolvedPath), config, additionalTags);
    fs.writeFileSync(resolvedPath, linted);
    log.success(`Linted ${resolvedPath}`);
} catch (e) {
    log.error(`Linting failed: ${e.message}`);
    process.exit(1);
}
