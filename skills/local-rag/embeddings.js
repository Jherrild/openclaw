/**
 * Ollama embedding generation
 */
import fs from 'fs';

const CONFIG = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url)));
const OLLAMA_URL = CONFIG.ollama_url;
const EMBEDDING_MODEL = CONFIG.embedding_model;

// Check Ollama connectivity
export async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

// Generate embedding for a single text
export async function embed(text, isQuery = true) {
  const prefix = isQuery ? 'search_query: ' : 'search_document: ';
  const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: prefix + text })
  });
  
  if (!res.ok) {
    throw new Error(`Ollama embedding failed: ${res.status}`);
  }
  
  const data = await res.json();
  return data.embedding;
}

// Generate embeddings for multiple texts with parallel batching
export async function embedBatch(texts, onProgress, isQuery = false, concurrency = 5) {
  const embeddings = new Array(texts.length);
  let completed = 0;

  for (let i = 0; i < texts.length; i += concurrency) {
    const batch = texts.slice(i, Math.min(i + concurrency, texts.length));
    const results = await Promise.all(
      batch.map((text, j) =>
        embed(text, isQuery).then(emb => {
          completed++;
          if (onProgress) onProgress(completed, texts.length);
          return { index: i + j, embedding: emb };
        })
      )
    );
    for (const { index, embedding } of results) {
      embeddings[index] = embedding;
    }
  }

  return embeddings;
}

// Cosine similarity between two vectors
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) throw new Error('Vector length mismatch');
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Chat completion for RAG synthesis
export async function chat(messages, model = CONFIG.chat_model) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false })
  });
  
  if (!res.ok) {
    throw new Error(`Ollama chat failed: ${res.status}`);
  }
  
  const data = await res.json();
  return data.message.content;
}
