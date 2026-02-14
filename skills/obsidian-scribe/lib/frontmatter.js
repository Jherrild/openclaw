/**
 * lib/frontmatter.js — Canonical frontmatter parser for obsidian-scribe
 * 
 * Single source of truth for parsing and generating Obsidian frontmatter.
 * Used by: scribe commands, local-rag, memory provider.
 */
const yaml = require('js-yaml');
const fm = require('front-matter');

/**
 * Get a human-readable timestamp matching Obsidian Linter format.
 * @returns {string} e.g. "Saturday February 14, 2026 at 2:09:33 PM"
 */
function getTimestamp() {
  return new Date().toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: true,
  }).replace(',', '');
}

/**
 * Parse frontmatter from markdown content.
 * @param {string} content - Raw markdown with optional YAML frontmatter
 * @returns {{ frontmatter: object, body: string }} Parsed attributes and body text
 */
function parseFrontmatter(content) {
  try {
    const parsed = fm(content);
    return {
      frontmatter: parsed.attributes || {},
      body: parsed.body || '',
    };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

/**
 * Extract inline tags from body content (lines that are only hashtags).
 * Removes those lines from the body and returns extracted tags.
 * @param {string} body - Markdown body (no frontmatter)
 * @returns {{ cleanBody: string, extractedTags: string[] }}
 */
function extractInlineTags(body) {
  const lines = body.split('\n');
  const extractedTags = [];
  const cleanLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const tagLineMatch = trimmed.match(/^(?:tags:\s*)?((#[\w/-]+\s*)+)$/);
    if (tagLineMatch && !trimmed.startsWith('##')) {
      const tags = trimmed.replace(/^tags:\s*/, '').match(/#[\w/-]+/g) || [];
      extractedTags.push(...tags.map(t => t.replace(/^#/, '')));
    } else {
      cleanLines.push(line);
    }
  }

  while (cleanLines.length > 0 && cleanLines[cleanLines.length - 1].trim() === '') {
    cleanLines.pop();
  }

  return { cleanBody: cleanLines.join('\n'), extractedTags };
}

/**
 * Normalize tags from frontmatter (may be array, string, or missing).
 * @param {*} raw - Tags value from frontmatter
 * @returns {string[]}
 */
function normalizeFrontmatterTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(t => String(t).replace(/^#/, ''));
  if (typeof raw === 'string') return raw.split(/[\s,]+/).filter(Boolean).map(t => t.replace(/^#/, ''));
  return [];
}

/**
 * Generate YAML frontmatter string from fields object.
 * Ensures required fields are present. Does not include --- delimiters.
 * @param {object} fields - Frontmatter fields
 * @param {string} [filename] - Filename for title fallback
 * @returns {string} YAML string (without --- delimiters)
 */
function generateFrontmatter(fields, filename) {
  const fm = { ...fields };
  const timestamp = getTimestamp();

  if (!fm.title && filename) fm.title = filename.replace(/\.md$/, '');
  if (!fm['date created']) fm['date created'] = timestamp;
  fm['date modified'] = timestamp;
  if (!fm.aliases && fm.aliases !== '') fm.aliases = '';
  if (!fm.tags) fm.tags = [];

  return yaml.dump(fm, {
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false,
  }).trim();
}

/**
 * Build complete frontmatter block for a file.
 * Merges existing frontmatter, inline tags, and additional tags.
 * @param {string} content - Full file content
 * @param {string} filename - Base filename
 * @param {string[]} [additionalTags=[]] - Extra tags to merge
 * @returns {{ frontmatter: object, body: string, yamlBlock: string }}
 */
function buildFrontmatter(content, filename, additionalTags = []) {
  const { frontmatter, body } = parseFrontmatter(content);
  const { cleanBody, extractedTags } = extractInlineTags(body);

  const existingTags = normalizeFrontmatterTags(frontmatter.tags);
  const allTags = [...new Set([...existingTags, ...extractedTags, ...additionalTags])].filter(Boolean);

  const merged = { ...frontmatter, tags: allTags };
  const yamlBlock = `---\n${generateFrontmatter(merged, filename)}\n---`;

  return { frontmatter: merged, body: cleanBody, yamlBlock };
}

module.exports = {
  getTimestamp,
  parseFrontmatter,
  extractInlineTags,
  normalizeFrontmatterTags,
  generateFrontmatter,
  buildFrontmatter,
};
