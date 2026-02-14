#!/usr/bin/env node
/**
 * scribe.js — Unified CLI for obsidian-scribe
 * 
 * Usage: node scribe.js <command> [args...] [--flags]
 * 
 * Commands:
 *   create  <path> [content]                    Create new note
 *   insert  <path> [content] [--at target]      Insert/append content
 *   edit    <path> --find <text> --replace <text>  Propose edit (preview by default)
 *   move    <source> <target>                   Move note + attachments
 *   archive <path>                              Move to 4-Archive/
 *   lint    <path> [--tags t1,t2]               Lint frontmatter
 *   read    <path>                              Extract text (PDF/MD)
 * 
 * Universal flags:
 *   --stdin     Read content from stdin
 *   --dry-run   Show what would happen without writing
 *   --json      Output result as JSON
 *   --tags      Add tags (comma-separated)
 */
const { parseArgs, log, normalizeTags } = require('./lib/utils');
const { readContent } = require('./lib/operations');
const api = require('./lib/api');

const args = parseArgs(process.argv, {
  string: ['tags', 'at', 'find', 'replace', 'file-id'],
  boolean: ['stdin', 'dry-run', 'json', 'apply', 'check'],
  alias: { t: 'tags', s: 'stdin' },
  default: { at: 'end' },
});

const command = args._[0];
const jsonOutput = args.json;

function output(result) {
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  }
}

function fail(msg) {
  if (jsonOutput) {
    console.log(JSON.stringify({ error: msg }));
  } else {
    log.error(msg);
  }
  process.exit(1);
}

async function main() {
  const tags = normalizeTags(args.tags);

  try {
    switch (command) {
      case 'create': {
        const relPath = args._[1];
        if (!relPath) fail('Usage: scribe.js create <path> [content] [--tags] [--stdin]');
        const content = await readContent(args._[2], args.stdin);
        if (!content) fail('No content provided. Use --stdin or pass as argument.');
        const result = api.create(relPath, content, { tags, fileId: args['file-id'] });
        output(result);
        break;
      }

      case 'insert': {
        const targetPath = args._[1];
        if (!targetPath) fail('Usage: scribe.js insert <path> [content] [--at end|"## Heading"|line:N] [--stdin]');
        const content = await readContent(args._[2], args.stdin);
        if (!content) fail('No content provided. Use --stdin or pass as argument.');
        const result = api.insert(targetPath, content, { at: args.at, tags });
        output(result);
        break;
      }

      case 'edit': {
        const targetPath = args._[1];
        const find = args.find;
        const replace = args.replace;
        if (!targetPath || !find || replace === undefined) {
          fail('Usage: scribe.js edit <path> --find "old text" --replace "new text" [--apply]');
        }
        const shouldApply = args.apply === true;
        const result = api.edit(targetPath, find, replace, {
          apply: shouldApply,
          context: 2,
          tags,
        });
        if (!jsonOutput) {
          if (!shouldApply) {
            console.log(`\n📝 Proposed edit to: ${result.path}\n`);
            console.log(result.diff);
            console.log('\nRun with --apply to write changes.\n');
          }
        }
        output(result);
        break;
      }

      case 'move': {
        const source = args._[1];
        const target = args._[2];
        if (!source || !target) fail('Usage: scribe.js move <source> <target>');
        const result = api.move(source, target);
        output(result);
        break;
      }

      case 'archive': {
        const targetPath = args._[1];
        if (!targetPath) fail('Usage: scribe.js archive <path>');
        const result = api.archive(targetPath);
        output(result);
        break;
      }

      case 'lint': {
        const targetPath = args._[1];
        if (!targetPath) fail('Usage: scribe.js lint <path> [--tags] [--check]');
        const { resolveVaultPath } = require('./lib/utils');
        const absPath = resolveVaultPath(targetPath) || targetPath;
        const { runLint } = require('./lib/operations');
        runLint(absPath, { tags, check: args.check });
        output({ path: absPath, linted: true });
        break;
      }

      case 'read': {
        const targetPath = args._[1];
        if (!targetPath) fail('Usage: scribe.js read <path>');
        const result = api.read(targetPath);
        if (!jsonOutput) {
          console.log(result.content);
        }
        output(result);
        break;
      }

      default:
        fail(`Unknown command: ${command || '(none)'}. Commands: create, insert, edit, move, archive, lint, read`);
    }
  } catch (e) {
    fail(e.message);
  }
}

main();
