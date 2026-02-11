#!/usr/bin/env node
/**
 * PARA Predictor — predicts the best PARA destination for a document
 * using hybrid search (sqlite-vec KNN + FTS5 BM25 + RRF) against an indexed vault.
 *
 * Usage:
 *   node para-predict.js <vault_dir> "<document text>"
 *   echo "document text" | node para-predict.js <vault_dir> --stdin
 *   node para-predict.js <vault_dir> --file /path/to/doc.md
 *
 * Output: JSON with predicted path, confidence, and neighbor details.
 */
import fs from 'fs';
import path from 'path';
import {
  openDb, getDbPath, getFileMetadata,
  vectorSearch, keywordSearch, reciprocalRankFusion
} from './db.js';
import { checkOllama, embed } from './embeddings.js';

const CONFIG = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url)));
const DEFAULT_K = 10;

// ---- Core prediction logic (importable) ----

/**
 * Predict the best PARA destination for a piece of text.
 * @param {object} db - opened SQLite db handle
 * @param {string} text - the document content to classify
 * @param {object} [opts] - options
 * @param {number} [opts.k=10] - number of neighbors to consider
 * @returns {Promise<{prediction: string, confidence: number, neighbors: object[]}>}
 */
export async function predictPara(db, text, opts = {}) {
  const k = opts.k || DEFAULT_K;

  // 1. Embed the input text (as a query)
  const queryEmbedding = await embed(text, true);

  // 2. Vector search — top N nearest chunks
  const vecResults = vectorSearch(db, queryEmbedding, k * 5);

  // 3. Keyword search — BM25 over FTS5
  // Build a keyword query from the first ~300 chars (captures key terms)
  const keyTerms = text.slice(0, 500).replace(/[^\w\s]/g, ' ').trim();
  const ftsResults = keywordSearch(db, keyTerms, k * 5);

  // 4. Reciprocal Rank Fusion to merge both result sets
  const fused = reciprocalRankFusion(vecResults, ftsResults);

  // 5. Take top-k unique files and look up their PARA metadata
  const seen = new Set();
  const neighbors = [];
  for (const result of fused) {
    if (seen.has(result.file_path)) continue;
    seen.add(result.file_path);

    const meta = getFileMetadata(db, result.file_path);
    neighbors.push({
      file_path: result.file_path,
      rrf_score: result.rrf_score,
      vec_rank: result.vec_rank,
      fts_rank: result.fts_rank,
      para_category: meta?.para_category || null,
      para_area: meta?.para_area || null,
      tags: meta?.tags || [],
      title: meta?.title || path.basename(result.file_path, '.md'),
    });

    if (neighbors.length >= k) break;
  }

  // 6. Tally votes — weighted by 1/rank position among the k neighbors
  const votes = new Map(); // "para_category/para_area" → weighted score
  const tagVotes = new Map();

  for (let i = 0; i < neighbors.length; i++) {
    const n = neighbors[i];
    const weight = 1 / (i + 1); // rank-based weight: 1st neighbor = 1.0, 2nd = 0.5, ...

    if (n.para_category) {
      const dest = n.para_area
        ? `${n.para_category}/${n.para_area}`
        : n.para_category;
      votes.set(dest, (votes.get(dest) || 0) + weight);
    }

    // Also tally tags for supplementary info
    for (const tag of n.tags) {
      tagVotes.set(tag, (tagVotes.get(tag) || 0) + weight);
    }
  }

  // 7. Pick the winner
  let bestDest = null;
  let bestScore = 0;
  let totalWeight = 0;

  for (const [dest, score] of votes) {
    totalWeight += score;
    if (score > bestScore) {
      bestScore = score;
      bestDest = dest;
    }
  }

  // Confidence: winner's share of total weighted votes
  // Ranges from 0 (no PARA metadata at all) to 1 (all neighbors agree)
  const confidence = totalWeight > 0 ? bestScore / totalWeight : 0;

  // Sort tags by vote weight
  const topTags = [...tagVotes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  // Build suggested path
  const predictedPath = bestDest ? `${bestDest}/` : null;

  return {
    prediction: predictedPath,
    confidence: Math.round(confidence * 1000) / 1000,
    suggested_tags: topTags,
    neighbor_count: neighbors.length,
    neighbors_with_para: neighbors.filter(n => n.para_category).length,
    vote_breakdown: Object.fromEntries(
      [...votes.entries()].sort((a, b) => b[1] - a[1])
    ),
    neighbors,
  };
}

// ---- CLI interface ----

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
PARA Predictor — Predict the best PARA destination for a document

Usage:
  node para-predict.js <vault_dir> "<document text>"
  echo "text" | node para-predict.js <vault_dir> --stdin
  node para-predict.js <vault_dir> --file /path/to/doc.md
  node para-predict.js <vault_dir> --file /path/to/doc.md --k 5

Options:
  --stdin       Read document text from stdin
  --file <path> Read document text from a file
  --k <number>  Number of neighbors (default: 10)
  --compact     Compact JSON output (no neighbors detail)
`);
    process.exit(0);
  }

  const vaultDir = path.resolve(args[0]);

  // Parse flags
  let text = null;
  let kVal = DEFAULT_K;
  let compact = false;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--stdin') {
      text = fs.readFileSync(0, 'utf-8'); // read from stdin fd
    } else if (args[i] === '--file' && args[i + 1]) {
      const filePath = path.resolve(args[++i]);
      if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
      }
      text = fs.readFileSync(filePath, 'utf-8');
    } else if (args[i] === '--k' && args[i + 1]) {
      kVal = parseInt(args[++i], 10);
    } else if (args[i] === '--compact') {
      compact = true;
    } else if (!text) {
      // Positional: treat as inline text
      text = args[i];
    }
  }

  if (!text || !text.trim()) {
    console.error('Error: No document text provided. Use positional arg, --stdin, or --file.');
    process.exit(1);
  }

  // Validate vault index exists
  const dbPath = getDbPath(vaultDir);
  if (!fs.existsSync(dbPath)) {
    console.error(`No index found for vault: ${vaultDir}`);
    console.error('Run: node rag.js index <vault_dir>');
    process.exit(1);
  }

  // Check Ollama
  if (!await checkOllama()) {
    console.error('Ollama is not reachable. Run: ollama serve');
    process.exit(1);
  }

  const db = openDb(vaultDir);

  try {
    const result = await predictPara(db, text, { k: kVal });

    if (compact) {
      // Minimal output for scripting
      const { prediction, confidence, suggested_tags, vote_breakdown } = result;
      console.log(JSON.stringify({ prediction, confidence, suggested_tags, vote_breakdown }, null, 2));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    db.close();
  }
}

// Only run CLI when invoked directly (not when imported)
const isMain = process.argv[1] && (
  process.argv[1].endsWith('para-predict.js') ||
  process.argv[1].endsWith('para-predict')
);

if (isMain) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
