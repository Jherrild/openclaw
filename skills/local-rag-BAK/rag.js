/**
 * Local RAG - Obsidian Vault Search using ChromaDB + Ollama
 * 
 * This version uses pure HTTP calls to ChromaDB to avoid GLIBC compatibility issues.
 * 
 * SETUP:
 * 1. Run ChromaDB in Docker:
 *    docker run -d --name chromadb -p 8000:8000 chromadb/chroma
 * 
 * 2. Ensure Ollama is running with the embedding model:
 *    ollama pull nomic-embed-text
 *    ollama serve  (if not already running)
 * 
 * USAGE:
 *    node rag.js check           # Check connectivity to ChromaDB and Ollama
 *    node rag.js index           # Index the Obsidian vault
 *    node rag.js search "query"  # Search the vault
 */

const fs = require('fs');
const path = require('path');

// Configuration
const VAULT_PATH = '/mnt/c/Users/Jherr/Documents/remote-personal';
const COLLECTION_NAME = 'obsidian_vault';
const CHROMA_URL = process.env.CHROMA_URL || 'http://localhost:8000';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = 'nomic-embed-text';

// --- HTTP Helpers ---

async function httpRequest(url, options = {}) {
  const { default: fetch } = await import('node-fetch');
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

// --- Ollama Embeddings ---

async function getEmbeddings(texts) {
  const embeddings = [];
  for (const text of texts) {
    const result = await httpRequest(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
    });
    embeddings.push(result.embedding);
  }
  return embeddings;
}

// --- ChromaDB HTTP Client ---

async function checkChromaHealth() {
  try {
    await httpRequest(`${CHROMA_URL}/api/v1/heartbeat`);
    return true;
  } catch {
    return false;
  }
}

async function checkOllamaHealth() {
  try {
    const { default: fetch } = await import('node-fetch');
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

async function getOrCreateCollection(name) {
  try {
    // Try to get existing collection
    const collections = await httpRequest(`${CHROMA_URL}/api/v1/collections`);
    const existing = collections.find(c => c.name === name);
    if (existing) return existing.id;
  } catch {
    // Collections endpoint might not exist in older versions
  }
  
  // Create collection
  const result = await httpRequest(`${CHROMA_URL}/api/v1/collections`, {
    method: 'POST',
    body: JSON.stringify({ name, get_or_create: true }),
  });
  return result.id;
}

async function addToCollection(collectionId, ids, embeddings, documents, metadatas) {
  await httpRequest(`${CHROMA_URL}/api/v1/collections/${collectionId}/add`, {
    method: 'POST',
    body: JSON.stringify({ ids, embeddings, documents, metadatas }),
  });
}

async function queryCollection(collectionId, queryEmbeddings, nResults = 5) {
  return await httpRequest(`${CHROMA_URL}/api/v1/collections/${collectionId}/query`, {
    method: 'POST',
    body: JSON.stringify({
      query_embeddings: queryEmbeddings,
      n_results: nResults,
      include: ['documents', 'metadatas', 'distances'],
    }),
  });
}

// --- File Walking ---

function walk(dir) {
  let files = [];
  if (!fs.existsSync(dir)) return files;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      files = files.concat(walk(fullPath));
    } else if (file.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

// --- Main Functions ---

async function checkConnectivity() {
  console.log('Checking connectivity...\n');
  
  const chromaOk = await checkChromaHealth();
  console.log(`ChromaDB (${CHROMA_URL}): ${chromaOk ? '✓ Connected' : '✗ Not reachable'}`);
  
  const ollamaOk = await checkOllamaHealth();
  console.log(`Ollama (${OLLAMA_URL}): ${ollamaOk ? '✓ Connected' : '✗ Not reachable'}`);
  
  if (!chromaOk) {
    console.log(`
To start ChromaDB with Docker:
  docker run -d --name chromadb -p 8000:8000 chromadb/chroma

Or with persistent storage:
  docker run -d --name chromadb -p 8000:8000 -v chromadb_data:/chroma/chroma chromadb/chroma
`);
  }
  
  if (!ollamaOk) {
    console.log(`
To start Ollama:
  ollama serve

Ensure the embedding model is available:
  ollama pull nomic-embed-text
`);
  }
  
  return chromaOk && ollamaOk;
}

async function indexVault() {
  console.log('Checking services...');
  if (!await checkChromaHealth()) {
    console.error('ChromaDB is not reachable. Run: docker run -d --name chromadb -p 8000:8000 chromadb/chroma');
    process.exit(1);
  }
  if (!await checkOllamaHealth()) {
    console.error('Ollama is not reachable. Run: ollama serve');
    process.exit(1);
  }
  
  console.log(`\nIndexing vault: ${VAULT_PATH}`);
  const collectionId = await getOrCreateCollection(COLLECTION_NAME);
  console.log(`Collection ID: ${collectionId}`);
  
  const files = walk(VAULT_PATH);
  console.log(`Found ${files.length} markdown files\n`);
  
  // Process in batches to avoid overwhelming Ollama
  const BATCH_SIZE = 10;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const ids = [];
    const documents = [];
    const metadatas = [];
    
    for (const filePath of batch) {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.trim()) continue;
      
      const id = path.relative(VAULT_PATH, filePath).replace(/\\/g, '/');
      ids.push(id);
      documents.push(content.slice(0, 8000)); // Truncate very long docs
      metadatas.push({ path: filePath, name: path.basename(filePath) });
    }
    
    if (ids.length === 0) continue;
    
    console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: Embedding ${ids.length} documents...`);
    const embeddings = await getEmbeddings(documents);
    
    console.log(`  Adding to ChromaDB...`);
    await addToCollection(collectionId, ids, embeddings, documents, metadatas);
  }
  
  console.log('\n✓ Indexing complete.');
}

async function searchVault(query) {
  if (!query) {
    console.error('Please provide a search query.');
    process.exit(1);
  }
  
  console.log('Checking services...');
  if (!await checkChromaHealth()) {
    console.error('ChromaDB is not reachable. Run: docker run -d --name chromadb -p 8000:8000 chromadb/chroma');
    process.exit(1);
  }
  if (!await checkOllamaHealth()) {
    console.error('Ollama is not reachable. Run: ollama serve');
    process.exit(1);
  }
  
  const collectionId = await getOrCreateCollection(COLLECTION_NAME);
  
  console.log(`\nSearching for: "${query}"\n`);
  const queryEmbedding = await getEmbeddings([query]);
  const results = await queryCollection(collectionId, queryEmbedding, 5);
  
  if (!results.ids || results.ids[0].length === 0) {
    console.log('No results found. Have you run "node rag.js index" yet?');
    return;
  }
  
  console.log('Results:\n');
  for (let i = 0; i < results.ids[0].length; i++) {
    const id = results.ids[0][i];
    const distance = results.distances?.[0]?.[i];
    const doc = results.documents?.[0]?.[i];
    const meta = results.metadatas?.[0]?.[i];
    
    console.log(`${i + 1}. ${id}`);
    if (distance !== undefined) console.log(`   Distance: ${distance.toFixed(4)}`);
    if (doc) {
      const preview = doc.slice(0, 200).replace(/\n/g, ' ').trim();
      console.log(`   Preview: ${preview}...`);
    }
    console.log();
  }
}

// --- CLI ---

const args = process.argv.slice(2);
const command = args[0];

if (command === 'check') {
  checkConnectivity().catch(console.error);
} else if (command === 'index') {
  indexVault().catch(console.error);
} else if (command === 'search') {
  searchVault(args[1]).catch(console.error);
} else {
  console.log(`
Local RAG - Obsidian Vault Search

Usage:
  node rag.js check           Check ChromaDB and Ollama connectivity
  node rag.js index           Index the Obsidian vault
  node rag.js search "query"  Search the vault

Environment variables:
  CHROMA_URL   ChromaDB server URL (default: http://localhost:8000)
  OLLAMA_URL   Ollama server URL (default: http://localhost:11434)
`);
}
