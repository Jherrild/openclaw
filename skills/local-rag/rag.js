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
import { openDb, insertChunk, deleteFile, deleteFileMetadata, getAllDocuments, getDocCount, clearAll, getDbPath, insertFileMetadata, getAllFileMetadata, getFileMtimes, updateFileMtime, findSourceDirForFile } from './db.js';
import { checkOllama, embed, embedBatch, cosineSimilarity, chat } from './embeddings.js';

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
  
  return { filename, title, tags, aliases, headers, body };
}

// Create metadata prefix for chunk embedding enrichment
function createMetadataPrefix(metadata) {
  const parts = [];
  if (metadata.title) parts.push(`[Title: ${metadata.title}]`);
  if (metadata.tags.length > 0) parts.push(`[Tags: ${metadata.tags.join(', ')}]`);
  if (metadata.aliases.length > 0) parts.push(`[Aliases: ${metadata.aliases.join(', ')}]`);
  return parts.length > 0 ? parts.join(' ') + ' ' : '';
}

// Chunk text into overlapping segments
function chunkText(text, size = CONFIG.chunk_size, overlap = CONFIG.chunk_overlap) {
  const chunks = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    start += size - overlap;
    if (end === text.length) break;
  }
  
  return chunks;
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
    insertFileMetadata(db, filePath, metadata.filename, metadata.title, metadata.tags, metadata.aliases, metadata.headers);

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
  
  // Check Ollama
  if (!await checkOllama()) {
    console.error('Ollama is not reachable. Run: ollama serve');
    process.exit(1);
  }
  
  const db = openDb(absDir);
  const docs = getAllDocuments(db);
  const fileMetadata = getAllFileMetadata(db);
  
  // Build metadata lookup by file path
  const metadataByFile = {};
  for (const meta of fileMetadata) {
    metadataByFile[meta.file_path] = meta;
  }
  
  console.log(`Searching ${docs.length} chunks for: "${query}"\n`);
  
  // Embed query
  const queryEmb = await embed(query);
  
  // Normalize query for keyword matching
  const queryLower = query.toLowerCase().trim();
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1);
  
  // Calculate hybrid scores per file
  const fileScores = {};
  
  for (const doc of docs) {
    const vectorScore = cosineSimilarity(queryEmb, doc.embedding);
    const meta = metadataByFile[doc.file_path];
    
    if (!fileScores[doc.file_path]) {
      fileScores[doc.file_path] = {
        file_path: doc.file_path,
        bestChunk: doc,
        vectorScore: vectorScore,
        metadataBoost: 0,
        chunks: []
      };
      
      // Calculate metadata boost (only once per file)
      if (meta) {
        const filenameLower = meta.filename.toLowerCase();
        const titleLower = (meta.title || '').toLowerCase();
        const aliasesLower = (meta.aliases || []).map(a => a.toLowerCase());
        const tagsLower = (meta.tags || []).map(t => t.toLowerCase());
        
        // Exact filename match (highest boost)
        if (filenameLower === queryLower || titleLower === queryLower) {
          fileScores[doc.file_path].metadataBoost += 0.5;
        }
        // Partial filename/title match
        else if (filenameLower.includes(queryLower) || queryLower.includes(filenameLower)) {
          fileScores[doc.file_path].metadataBoost += 0.3;
        }
        else if (titleLower.includes(queryLower) || queryLower.includes(titleLower)) {
          fileScores[doc.file_path].metadataBoost += 0.25;
        }
        
        // Alias exact match (very high boost)
        for (const alias of aliasesLower) {
          if (alias === queryLower) {
            fileScores[doc.file_path].metadataBoost += 0.45;
            break;
          } else if (alias.includes(queryLower) || queryLower.includes(alias)) {
            fileScores[doc.file_path].metadataBoost += 0.2;
          }
        }
        
        // Tag matches
        for (const tag of tagsLower) {
          for (const term of queryTerms) {
            if (tag === term || tag.includes(term)) {
              fileScores[doc.file_path].metadataBoost += 0.1;
            }
          }
        }
        
        // Cap metadata boost at 0.6
        fileScores[doc.file_path].metadataBoost = Math.min(fileScores[doc.file_path].metadataBoost, 0.6);
      }
    }
    
    // Track best vector score for this file
    if (vectorScore > fileScores[doc.file_path].vectorScore) {
      fileScores[doc.file_path].vectorScore = vectorScore;
      fileScores[doc.file_path].bestChunk = doc;
    }
    
    fileScores[doc.file_path].chunks.push({ ...doc, vectorScore });
  }
  
  // Calculate final hybrid scores
  const results = Object.values(fileScores).map(fs => ({
    ...fs.bestChunk,
    vectorScore: fs.vectorScore,
    metadataBoost: fs.metadataBoost,
    hybridScore: fs.vectorScore + fs.metadataBoost,
    allChunks: fs.chunks
  }));
  
  // Sort by hybrid score (highest first)
  results.sort((a, b) => b.hybridScore - a.hybridScore);
  
  // Return top K files
  const topK = results.slice(0, CONFIG.top_k);
  
  console.log('Results:\n');
  for (let i = 0; i < topK.length; i++) {
    const r = topK[i];
    const relPath = path.relative(absDir, r.file_path);
    const preview = r.content.slice(0, 150).replace(/\n/g, ' ').trim();
    
    console.log(`${i + 1}. ${relPath}`);
    console.log(`   Hybrid: ${r.hybridScore.toFixed(4)} (vector: ${r.vectorScore.toFixed(4)}, meta: +${r.metadataBoost.toFixed(2)})`);
    console.log(`   ${preview}...`);
    console.log();
  }
  
  db.close();
  return topK;
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
  node rag.js reset <directory>                    Delete index database for a directory

Examples:
  node rag.js check
  node rag.js index ~/notes
  node rag.js index ~/notes/new-note.md
  node rag.js search "machine learning" ~/notes
  node rag.js query "What are the key points about X?" ~/notes
  node rag.js reset ~/notes

Configuration:
  Edit config.json to change models, chunk size, etc.
`);
}
