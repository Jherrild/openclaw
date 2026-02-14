#!/usr/bin/env node
/**
 * Local RAG - Semantic search using SQLite + Ollama
 * 
 * Usage:
 *   node rag.js check                      Check Ollama connectivity
 *   node rag.js index <directory>          Index a directory
 *   node rag.js search <query> <directory> Search indexed content
 *   node rag.js query <question> <directory> RAG synthesis
 */
import fs from 'fs';
import path from 'path';
import { openDb, insertChunk, deleteFile, deleteFileMetadata, getDocCount, clearAll, getDbPath, insertFileMetadata, getFileMetadata, getAllFileMetadata, getFileMtimes, updateFileMtime, findSourceDirForFile, vectorSearch, keywordSearch, reciprocalRankFusion, entityShortcut } from './db.js';
import { checkOllama, embed, embedBatch, chat } from './embeddings.js';
import { predictPara } from './para-predict.js';

const CONFIG = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url)));

// Parse YAML frontmatter from markdown content
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { frontmatter: {}, body: content };
  
  const yamlStr = match[1];
  const body = content.slice(match[0].length).trim();
  const frontmatter = {};
  
  // Simple YAML parser for common fields
  const lines = yamlStr.split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    
    // Parse arrays like [tag1, tag2] or [alias1, alias2]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
    }
    
    frontmatter[key] = value;
  }
  
  return { frontmatter, body };
}

// Extract headers from markdown content
function extractHeaders(content) {
  const headers = [];
  const regex = /^(#{1,6})\s+(.+)$/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    headers.push(match[2].trim());
  }
  return headers;
}

// Extract metadata from a markdown file
function extractMetadata(filePath, content) {
  const filename = path.basename(filePath, '.md');
  const { frontmatter, body } = parseFrontmatter(content);
  
  // Get title from first H1 header or filename
  const h1Match = body.match(/^#\s+(.+)$/m);
  const title = h1Match ? h1Match[1].trim() : filename;
  
  // Get tags (could be array or string)
  let tags = frontmatter.tags || [];
  if (typeof tags === 'string') tags = [tags];
  
  // Get aliases
  let aliases = frontmatter.aliases || [];
  if (typeof aliases === 'string') aliases = [aliases];
  
  // Extract headers
  const headers = extractHeaders(body);

  // Extract summary from frontmatter
  const summary = frontmatter.summary || '';

  // Extract PARA context from file path
  const { paraCategory, paraArea } = extractParaContext(filePath);
  
  return { filename, title, tags, aliases, headers, body, summary, paraCategory, paraArea };
}

// Extract PARA category and area from file path
function extractParaContext(filePath) {
  // Match patterns like /1-Projects/..., /2-Areas/Finance/..., /3-Resources/..., /4-Archive/...
  const paraMatch = filePath.match(/[/\\](([1-4]-[A-Za-z]+)[/\\]([^/\\]+))/);
  if (paraMatch) {
    return {
      paraCategory: paraMatch[2],  // e.g. "2-Areas"
      paraArea: paraMatch[3]       // e.g. "Finance"
    };
  }
  // Try to at least get the category
  const catMatch = filePath.match(/[/\\]([1-4]-[A-Za-z]+)[/\\]/);
  if (catMatch) {
    return { paraCategory: catMatch[1], paraArea: null };
  }
  return { paraCategory: null, paraArea: null };
}

// Create metadata prefix for chunk embedding enrichment
function createMetadataPrefix(metadata) {
  const parts = [];
  if (metadata.title) parts.push(`[Title: ${metadata.title}]`);
  if (metadata.paraArea) parts.push(`[Area: ${metadata.paraArea}]`);
  if (metadata.tags.length > 0) parts.push(`[Tags: ${metadata.tags.join(', ')}]`);
  if (metadata.aliases.length > 0) parts.push(`[Aliases: ${metadata.aliases.join(', ')}]`);
  if (metadata.summary) parts.push(`[Summary: ${metadata.summary}]`);
  return parts.length > 0 ? parts.join(' ') + ' ' : '';
}

// Split text at sentence boundaries (fallback for oversized paragraphs)
function splitAtSentences(text, maxSize) {
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxSize && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// Paragraph-aware chunking with configurable overlap
function chunkText(text, maxChunkSize, overlapSize) {
  maxChunkSize = maxChunkSize || CONFIG.chunk_size || 800;
  overlapSize = overlapSize || CONFIG.chunk_overlap || 0;
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let current = '';
  let prevTail = ''; // overlap carry-over from previous chunk

  for (const para of paragraphs) {
    if (current.length + para.length > maxChunkSize && current.length > 0) {
      chunks.push(current.trim());
      // Carry overlap: keep last N chars from current chunk
      if (overlapSize > 0) {
        prevTail = current.slice(-overlapSize);
      }
      current = prevTail ? prevTail + '\n\n' + para : para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  // Split oversized chunks at sentence boundaries
  return chunks.flatMap(chunk =>
    chunk.length > maxChunkSize * 1.5
      ? splitAtSentences(chunk, maxChunkSize)
      : [chunk]
  );
}

// Walk directory for markdown files
function walkDir(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      walkDir(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

// --- Commands ---

async function cmdCheck() {
  console.log('Checking Ollama connectivity...');
  const ok = await checkOllama();
  
  if (ok) {
    console.log(`✓ Ollama is running at ${CONFIG.ollama_url}`);
    console.log(`  Embedding model: ${CONFIG.embedding_model}`);
    console.log(`  Chat model: ${CONFIG.chat_model}`);
  } else {
    console.log(`✗ Cannot reach Ollama at ${CONFIG.ollama_url}`);
    console.log('\nMake sure Ollama is running:');
    console.log('  ollama serve');
    console.log('\nAnd the embedding model is available:');
    console.log(`  ollama pull ${CONFIG.embedding_model}`);
    process.exit(1);
  }
}

async function cmdIndex(paths) {
  if (!paths || paths.length === 0) {
    console.error('Usage: node rag.js index <directory|file> [file2 ...]');
    process.exit(1);
  }

  const firstPath = path.resolve(paths[0]);
  if (!fs.existsSync(firstPath)) {
    console.error(`Not found: ${firstPath}`);
    process.exit(1);
  }

  // Check Ollama
  if (!await checkOllama()) {
    console.error('Ollama is not reachable. Run: ollama serve');
    process.exit(1);
  }

  const concurrency = CONFIG.concurrency || 5;
  const targetStats = fs.statSync(firstPath);
  let absDir;
  let filesToProcess; // Array of { filePath, mtime }
  let isFullScan = false;

  if (targetStats.isFile()) {
    // Single-file mode: find the vault this file belongs to
    absDir = findSourceDirForFile(firstPath);
    if (!absDir) {
      console.error(`No indexed vault found for: ${firstPath}`);
      console.error('Index the parent directory first: node rag.js index <directory>');
      process.exit(1);
    }
    const files = paths.map(f => path.resolve(f)).filter(f => fs.existsSync(f) && fs.statSync(f).isFile());
    filesToProcess = files.map(f => ({ filePath: f, mtime: fs.statSync(f).mtimeMs }));
  } else {
    // Directory mode
    absDir = firstPath;
    if (paths.length > 1) {
      // Specific files within this directory
      const files = paths.slice(1).map(f => path.resolve(f)).filter(f => fs.existsSync(f));
      filesToProcess = files.map(f => ({ filePath: f, mtime: fs.statSync(f).mtimeMs }));
    } else {
      isFullScan = true;
    }
  }

  console.log(`Indexing: ${absDir}`);
  console.log(`Database: ${getDbPath(absDir)}`);

  const db = openDb(absDir);

  if (isFullScan) {
    // Incremental: compare mtimes
    const allFiles = walkDir(absDir);
    const storedMtimes = getFileMtimes(db);
    const currentPaths = new Set();

    filesToProcess = [];
    for (const filePath of allFiles) {
      currentPaths.add(filePath);
      const currentMtime = fs.statSync(filePath).mtimeMs;
      const storedMtime = storedMtimes.get(filePath);
      if (storedMtime === undefined || currentMtime > storedMtime) {
        filesToProcess.push({ filePath, mtime: currentMtime });
      }
    }

    // Remove deleted files from index
    const deleted = [];
    for (const storedPath of storedMtimes.keys()) {
      if (!currentPaths.has(storedPath)) deleted.push(storedPath);
    }
    if (deleted.length > 0) {
      console.log(`Removing ${deleted.length} deleted file(s) from index`);
      for (const dp of deleted) {
        deleteFile(db, dp);
        deleteFileMetadata(db, dp);
      }
    }

    if (filesToProcess.length === 0) {
      console.log(`\n✓ Index is up to date (${allFiles.length} files, 0 changed)`);
      db.close();
      return;
    }

    console.log(`Found ${allFiles.length} files, ${filesToProcess.length} new/modified, ${deleted.length} deleted\n`);
  } else {
    console.log(`Indexing ${filesToProcess.length} specific file(s)\n`);
  }

  // Process files
  let totalChunks = 0;

  for (let i = 0; i < filesToProcess.length; i++) {
    const { filePath, mtime } = filesToProcess[i];
    const relPath = path.relative(absDir, filePath);
    const content = fs.readFileSync(filePath, 'utf-8');

    // Skip binary-looking files
    if (/[a-zA-Z0-9+/]{100,}/.test(content) && content.includes('AooooA')) {
      console.log(` - Skipping ${relPath} (appears to be binary/base64)`);
      continue;
    }
    if (!content.trim()) continue;

    // Remove old data for this file before re-indexing
    deleteFile(db, filePath);

    const metadata = extractMetadata(filePath, content);
    insertFileMetadata(db, filePath, metadata.filename, metadata.title, metadata.tags, metadata.aliases, metadata.headers, metadata.paraCategory, metadata.paraArea, metadata.summary, metadata.body);

    const metadataPrefix = createMetadataPrefix(metadata);
    const chunks = chunkText(metadata.body);
    const enrichedChunks = chunks.map(chunk => metadataPrefix + chunk);

    process.stdout.write(`[${i + 1}/${filesToProcess.length}] ${relPath} (${chunks.length} chunks)...`);

    const embeddings = await embedBatch(enrichedChunks, null, false, concurrency);

    for (let j = 0; j < chunks.length; j++) {
      insertChunk(db, filePath, j, chunks[j], embeddings[j]);
    }

    updateFileMtime(db, filePath, mtime);
    totalChunks += chunks.length;
    console.log(' ✓');
  }

  db.close();
  console.log(`\n✓ Indexed ${totalChunks} chunks from ${filesToProcess.length} files`);
}

async function cmdSearch(query, dirPath) {
  if (!query || !dirPath) {
    console.error('Usage: node rag.js search <query> <directory>');
    process.exit(1);
  }
  
  const absDir = path.resolve(dirPath);
  const dbPath = getDbPath(absDir);
  
  if (!fs.existsSync(dbPath)) {
    console.error(`No index found for: ${absDir}`);
    console.error('Run: node rag.js index <directory>');
    process.exit(1);
  }
  
  const db = openDb(absDir);
  const docCount = getDocCount(db);
  
  console.log(`Searching ${docCount} chunks for: "${query}"\n`);

  // 1. Entity shortcut — exact filename/alias match returns immediately
  const entityMatch = entityShortcut(db, query);
  if (entityMatch) {
    const meta = getFileMetadata(db, entityMatch);
    const relPath = path.relative(absDir, entityMatch);
    console.log(`⚡ Entity match: ${relPath}`);
    if (meta) {
      console.log(`   Title: ${meta.title || meta.filename}`);
      console.log(`   Tags: ${meta.tags || '[]'}`);
    }
    console.log();
    // Still run full search below to find related context
  }

  // 2. Check Ollama for embedding
  if (!await checkOllama()) {
    console.error('Ollama is not reachable. Run: ollama serve');
    process.exit(1);
  }
  
  // 3. Embed query
  const queryEmb = await embed(query);

  // 4. Parallel: sqlite-vec KNN + FTS5 BM25
  const vecResults = vectorSearch(db, queryEmb);
  const ftsResults = keywordSearch(db, query);

  // 5. Reciprocal Rank Fusion
  const fused = reciprocalRankFusion(vecResults, ftsResults);

  // 6. Apply minScore filter and limit
  const minScore = CONFIG.min_score || 0;
  const topK = fused
    .filter(r => r.rrf_score >= minScore)
    .slice(0, CONFIG.top_k || 20);

  // 7. Enrich results with metadata and best chunk content
  const enriched = topK.map(r => {
    const meta = getFileMetadata(db, r.file_path);
    const relPath = path.relative(absDir, r.file_path);
    return {
      file_path: r.file_path,
      relPath,
      rrf_score: r.rrf_score,
      vec_rank: r.vec_rank,
      fts_rank: r.fts_rank,
      content: r.best_chunk ? r.best_chunk.content : '',
      title: meta?.title || meta?.filename || relPath,
      tags: meta?.tags || '[]',
      para_area: meta?.para_area || null,
    };
  });
  
  // 8. Display results
  console.log('Results:\n');
  for (let i = 0; i < enriched.length; i++) {
    const r = enriched[i];
    const preview = r.content.slice(0, 150).replace(/\n/g, ' ').trim();
    
    console.log(`${i + 1}. ${r.relPath}`);
    console.log(`   RRF: ${r.rrf_score.toFixed(5)} (vec_rank: ${r.vec_rank}, fts_rank: ${r.fts_rank})`);
    if (preview) console.log(`   ${preview}...`);
    console.log();
  }
  
  db.close();
  return enriched;
}

async function cmdQuery(question, dirPath) {
  if (!question || !dirPath) {
    console.error('Usage: node rag.js query <question> <directory>');
    process.exit(1);
  }
  
  // Get search results
  const results = await cmdSearch(question, dirPath);
  
  // Build context from results
  const context = results.map((r, i) => {
    const relPath = path.relative(path.resolve(dirPath), r.file_path);
    return `[${i + 1}] From ${relPath}:\n${r.content}`;
  }).join('\n\n');
  
  console.log('---\nGenerating answer...\n');
  
  const systemPrompt = `You are a helpful assistant. Answer the user's question based ONLY on the provided context. If the context doesn't contain relevant information, say so.`;
  
  const userPrompt = `Context:\n${context}\n\nQuestion: ${question}`;
  
  const answer = await chat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]);
  
  console.log('Answer:');
  console.log(answer);
}

async function cmdPredict(dirPath, textOrFile) {
  if (!dirPath) {
    console.error('Usage: node rag.js predict <directory> "<text>" | --file <path>');
    process.exit(1);
  }

  const absDir = path.resolve(dirPath);
  const dbPath = getDbPath(absDir);

  if (!fs.existsSync(dbPath)) {
    console.error(`No index found for: ${absDir}`);
    console.error('Run: node rag.js index <directory>');
    process.exit(1);
  }

  if (!await checkOllama()) {
    console.error('Ollama is not reachable. Run: ollama serve');
    process.exit(1);
  }

  // Resolve text input
  let text = textOrFile;
  if (textOrFile === '--file') {
    const filePath = path.resolve(process.argv[5] || '');
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    text = fs.readFileSync(filePath, 'utf-8');
  }

  if (!text || !text.trim()) {
    console.error('Error: No text provided.');
    process.exit(1);
  }

  const db = openDb(absDir);
  try {
    const result = await predictPara(db, text, { k: 10 });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    db.close();
  }
}

function cmdReset(dirPath) {
  if (!dirPath) {
    console.error('Usage: node rag.js reset <directory>');
    process.exit(1);
  }

  const absDir = path.resolve(dirPath);
  const dbPath = getDbPath(absDir);

  if (!fs.existsSync(dbPath)) {
    console.log(`No index found for: ${absDir}`);
    console.log('Nothing to reset.');
    return;
  }

  fs.unlinkSync(dbPath);
  console.log(`Deleted index database: ${dbPath}`);
  console.log(`Index for ${absDir} has been reset.`);
}

// --- CLI ---

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'check':
    cmdCheck().catch(console.error);
    break;
  case 'index':
    cmdIndex(args.slice(1)).catch(console.error);
    break;
  case 'search':
    cmdSearch(args[1], args[2]).catch(console.error);
    break;
  case 'query':
    cmdQuery(args[1], args[2]).catch(console.error);
    break;
  case 'predict':
    cmdPredict(args[1], args[2]).catch(console.error);
    break;
  case 'reset':
    cmdReset(args[1]);
    break;
  default:
    console.log(`
Local RAG - Semantic Search with SQLite + Ollama

Usage:
  node rag.js check                                Check Ollama connectivity
  node rag.js index <directory>                    Incremental index of a directory
  node rag.js index <directory> <file1> [file2...] Index specific files in a vault
  node rag.js index <file>                         Index a single file (vault must exist)
  node rag.js search "<query>" <directory>         Search indexed content
  node rag.js query "<question>" <directory>       RAG answer synthesis
  node rag.js predict <directory> "<text>"         Predict PARA destination for text
  node rag.js predict <directory> --file <path>    Predict PARA destination for a file
  node rag.js reset <directory>                    Delete index database for a directory

Examples:
  node rag.js check
  node rag.js index ~/notes
  node rag.js index ~/notes/new-note.md
  node rag.js search "machine learning" ~/notes
  node rag.js query "What are the key points about X?" ~/notes
  node rag.js predict ~/notes "My document about financial planning and budgets"
  node rag.js predict ~/notes --file ~/Desktop/new-note.md
  node rag.js reset ~/notes

Configuration:
  Edit config.json to change models, chunk size, etc.
`);
}
