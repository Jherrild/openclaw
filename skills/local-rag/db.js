/**
 * SQLite database operations for local-rag
 * Phase 1: Hybrid search with FTS5 + sqlite-vec
 */
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const CONFIG = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url)));
const DB_DIR = CONFIG.db_dir.replace('~', os.homedir());
const EMBEDDING_DIM = CONFIG.embedding_dim || 768;

// Ensure DB directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Generate a consistent hash for a directory path
function getDirHash(dirPath) {
  const normalized = path.resolve(dirPath);
  return crypto.createHash('md5').update(normalized).digest('hex').slice(0, 12);
}

// Get database path for a directory
export function getDbPath(dirPath) {
  const hash = getDirHash(dirPath);
  return path.join(DB_DIR, `${hash}.db`);
}

// Check if a table exists in the database
function tableExists(db, tableName) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
  return !!row;
}

// Migrate file_metadata: add new columns if missing
function migrateFileMetadata(db) {
  const cols = db.pragma('table_info(file_metadata)');
  const colNames = new Set(cols.map(c => c.name));
  const migrations = [
    ['mtime', 'REAL'],
    ['para_category', 'TEXT'],
    ['para_area', 'TEXT'],
    ['summary', 'TEXT'],
  ];
  for (const [col, type] of migrations) {
    if (!colNames.has(col)) {
      db.exec(`ALTER TABLE file_metadata ADD COLUMN ${col} ${type}`);
    }
  }
}

// Initialize or open database for a directory
export function openDb(dirPath) {
  const dbPath = getDbPath(dirPath);
  const db = new Database(dbPath);

  // Load sqlite-vec extension
  sqliteVec.load(db);

  // --- Legacy table (kept for backward compatibility during transition) ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_file_path ON documents(file_path);
  `);

  // --- Core metadata tables ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS file_metadata (
      file_path TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      title TEXT,
      tags TEXT,
      aliases TEXT,
      headers TEXT,
      para_category TEXT,
      para_area TEXT,
      summary TEXT,
      mtime REAL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_filename ON file_metadata(filename);
  `);

  // Migrate existing file_metadata tables that lack new columns
  migrateFileMetadata(db);

  // --- FTS5 index for keyword/BM25 search ---
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
      file_path,
      filename,
      title,
      tags,
      aliases,
      para_area,
      headers,
      summary,
      content,
      tokenize='porter unicode61'
    );
  `);

  // --- Vector index (sqlite-vec) for semantic search ---
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
      embedding float[${EMBEDDING_DIM}]
    );
  `);

  // --- Chunk content table (stores text alongside vec_chunks rowid) ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
  `);

  // Store the indexed directory path
  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)')
    .run('source_dir', path.resolve(dirPath));

  return db;
}

// Convert a JS float array to a Buffer for sqlite-vec
function float32Buffer(arr) {
  return Buffer.from(new Float32Array(arr).buffer);
}

// Insert a chunk into the new vec_chunks + chunks tables, and legacy documents table
export function insertChunk(db, filePath, chunkIndex, content, embedding) {
  // Legacy documents table (backward compat)
  const id = `${filePath}:${chunkIndex}`;
  const embeddingJson = JSON.stringify(embedding);
  db.prepare(`
    INSERT OR REPLACE INTO documents (id, file_path, chunk_index, content, embedding)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, filePath, chunkIndex, content, embeddingJson);

  // New vec_chunks + chunks tables
  const vecInsert = db.prepare('INSERT INTO vec_chunks(embedding) VALUES (?)');
  const info = vecInsert.run(float32Buffer(embedding));
  const rowid = info.lastInsertRowid;

  db.prepare(`
    INSERT OR REPLACE INTO chunks (id, file_path, chunk_index, content)
    VALUES (?, ?, ?, ?)
  `).run(rowid, filePath, chunkIndex, content);
}

// Delete all chunks for a file (for re-indexing) — cleans all tables
export function deleteFile(db, filePath) {
  // Legacy
  db.prepare('DELETE FROM documents WHERE file_path = ?').run(filePath);

  // New: get chunk rowids first, then delete from vec_chunks and chunks
  const rows = db.prepare('SELECT id FROM chunks WHERE file_path = ?').all(filePath);
  if (rows.length > 0) {
    const ids = rows.map(r => r.id);
    for (const cid of ids) {
      db.prepare('DELETE FROM vec_chunks WHERE rowid = ?').run(cid);
    }
    db.prepare('DELETE FROM chunks WHERE file_path = ?').run(filePath);
  }

  // FTS5: remove file's entry
  db.prepare('DELETE FROM search_fts WHERE file_path = ?').run(filePath);
}

// Get all documents for similarity search (legacy — used by old cmdSearch)
export function getAllDocuments(db) {
  return db.prepare('SELECT id, file_path, chunk_index, content, embedding FROM documents').all()
    .map(row => ({
      ...row,
      embedding: JSON.parse(row.embedding)
    }));
}

// Get document count (from new chunks table, falls back to legacy)
export function getDocCount(db) {
  const newCount = db.prepare('SELECT COUNT(*) as count FROM chunks').get().count;
  if (newCount > 0) return newCount;
  return db.prepare('SELECT COUNT(*) as count FROM documents').get().count;
}

// Clear all documents from all tables
export function clearAll(db) {
  db.prepare('DELETE FROM documents').run();
  db.prepare('DELETE FROM chunks').run();
  db.prepare('DELETE FROM vec_chunks WHERE rowid IN (SELECT rowid FROM vec_chunks)').run();
  db.prepare('DELETE FROM search_fts').run();
  db.prepare('DELETE FROM file_metadata').run();
}

// Insert file metadata + FTS5 entry
export function insertFileMetadata(db, filePath, filename, title, tags, aliases, headers, paraCategory, paraArea, summary, fullContent) {
  db.prepare(`
    INSERT OR REPLACE INTO file_metadata (file_path, filename, title, tags, aliases, headers, para_category, para_area, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    filePath, filename, title,
    JSON.stringify(tags), JSON.stringify(aliases), JSON.stringify(headers),
    paraCategory || null, paraArea || null, summary || null
  );

  // Upsert FTS5: delete then re-insert (FTS5 doesn't support REPLACE)
  db.prepare('DELETE FROM search_fts WHERE file_path = ?').run(filePath);

  const tagsStr = (tags || []).join(' ');
  const aliasesStr = (aliases || []).join(' ');
  const headersStr = (headers || []).join(' ');
  db.prepare(`
    INSERT INTO search_fts (file_path, filename, title, tags, aliases, para_area, headers, summary, content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    filePath, filename, title || '',
    tagsStr, aliasesStr,
    paraArea || '', headersStr,
    summary || '', fullContent || ''
  );
}

// Get metadata for a specific file
export function getFileMetadata(db, filePath) {
  const row = db.prepare('SELECT * FROM file_metadata WHERE file_path = ?').get(filePath);
  if (!row) return null;
  return {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    aliases: JSON.parse(row.aliases || '[]'),
    headers: JSON.parse(row.headers || '[]')
  };
}

// Get all file metadata for hybrid search
export function getAllFileMetadata(db) {
  return db.prepare('SELECT * FROM file_metadata').all()
    .map(row => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      aliases: JSON.parse(row.aliases || '[]'),
      headers: JSON.parse(row.headers || '[]')
    }));
}

// Get stored mtimes as Map<file_path, mtime>
export function getFileMtimes(db) {
  const rows = db.prepare('SELECT file_path, mtime FROM file_metadata').all();
  const map = new Map();
  for (const row of rows) {
    if (row.mtime != null) map.set(row.file_path, row.mtime);
  }
  return map;
}

// Update mtime for a file
export function updateFileMtime(db, filePath, mtime) {
  db.prepare('UPDATE file_metadata SET mtime = ? WHERE file_path = ?').run(mtime, filePath);
}

// Delete file metadata entry (also cleans FTS5)
export function deleteFileMetadata(db, filePath) {
  db.prepare('DELETE FROM file_metadata WHERE file_path = ?').run(filePath);
  db.prepare('DELETE FROM search_fts WHERE file_path = ?').run(filePath);
}

// --- New Phase 1: Vector search via sqlite-vec ---
export function vectorSearch(db, queryEmbedding, limit) {
  limit = limit || CONFIG.vector_search_limit || 50;
  const rows = db.prepare(`
    SELECT rowid, distance
    FROM vec_chunks
    WHERE embedding MATCH ?
    ORDER BY distance
    LIMIT ?
  `).all(float32Buffer(queryEmbedding), limit);

  // Join with chunks table for file_path and content
  const results = [];
  for (const row of rows) {
    const chunk = db.prepare('SELECT file_path, chunk_index, content FROM chunks WHERE id = ?').get(row.rowid);
    if (chunk) {
      results.push({
        rowid: row.rowid,
        distance: row.distance,
        file_path: chunk.file_path,
        chunk_index: chunk.chunk_index,
        content: chunk.content
      });
    }
  }
  return results;
}

// --- New Phase 1: Keyword search via FTS5 with BM25 ---
export function keywordSearch(db, query, limit) {
  limit = limit || CONFIG.fts_search_limit || 50;
  const w = CONFIG.fts_weights || {};

  // Escape FTS5 special chars and build a simple OR query from terms
  const terms = query.replace(/['"]/g, '').split(/\s+/).filter(t => t.length > 1);
  if (terms.length === 0) return [];

  const ftsQuery = terms.map(t => `"${t}"`).join(' OR ');

  try {
    return db.prepare(`
      SELECT file_path,
             bm25(search_fts,
               0,
               ${w.filename || 10},
               ${w.title || 8},
               ${w.tags || 5},
               ${w.aliases || 8},
               ${w.para_area || 4},
               ${w.headers || 3},
               ${w.summary || 3},
               ${w.content || 1}
             ) AS bm25_score
      FROM search_fts
      WHERE search_fts MATCH ?
      ORDER BY bm25_score
      LIMIT ?
    `).all(ftsQuery, limit);
  } catch {
    // FTS5 query syntax error — return empty
    return [];
  }
}

// --- New Phase 1: Reciprocal Rank Fusion ---
export function reciprocalRankFusion(vecResults, ftsResults, k) {
  k = k || CONFIG.rrf_k || 60;
  const MISSING_RANK = 999;
  const scores = new Map(); // file_path → rrf_score

  // Deduplicate vec results: keep best (lowest distance) per file
  const vecByFile = new Map();
  for (const r of vecResults) {
    const existing = vecByFile.get(r.file_path);
    if (!existing || r.distance < existing.distance) {
      vecByFile.set(r.file_path, r);
    }
  }

  // Assign vector ranks (1-based, ascending distance = better)
  const vecRanked = [...vecByFile.entries()]
    .sort((a, b) => a[1].distance - b[1].distance)
    .map(([fp], i) => ({ file_path: fp, rank: i + 1 }));

  // Assign BM25 ranks (1-based, ascending bm25_score = better, FTS5 returns negative)
  const ftsRanked = ftsResults.map((r, i) => ({ file_path: r.file_path, rank: i + 1 }));

  // Build rank maps
  const vecRankMap = new Map(vecRanked.map(r => [r.file_path, r.rank]));
  const ftsRankMap = new Map(ftsRanked.map(r => [r.file_path, r.rank]));

  // Collect all file paths
  const allFiles = new Set([...vecRankMap.keys(), ...ftsRankMap.keys()]);

  for (const fp of allFiles) {
    const vr = vecRankMap.get(fp) || MISSING_RANK;
    const fr = ftsRankMap.get(fp) || MISSING_RANK;
    const rrfScore = 1 / (k + vr) + 1 / (k + fr);
    scores.set(fp, rrfScore);
  }

  // Sort descending by RRF score
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([file_path, rrf_score]) => ({
      file_path,
      rrf_score,
      vec_rank: vecRankMap.get(file_path) || MISSING_RANK,
      fts_rank: ftsRankMap.get(file_path) || MISSING_RANK,
      // Attach best chunk content from vec results if available
      best_chunk: vecByFile.get(file_path) || null
    }));
}

// --- New Phase 1: Entity shortcut (exact filename/alias match) ---
export function entityShortcut(db, query) {
  const queryLower = query.toLowerCase().trim();

  // Check exact filename match
  const byFilename = db.prepare(
    'SELECT file_path FROM file_metadata WHERE LOWER(filename) = ?'
  ).get(queryLower);
  if (byFilename) return byFilename.file_path;

  // Check alias match (aliases stored as JSON array)
  const allMeta = db.prepare('SELECT file_path, aliases FROM file_metadata WHERE aliases IS NOT NULL').all();
  for (const row of allMeta) {
    try {
      const aliases = JSON.parse(row.aliases || '[]');
      if (aliases.some(a => a.toLowerCase() === queryLower)) {
        return row.file_path;
      }
    } catch { /* skip */ }
  }

  return null;
}

// Find the source directory (vault) for a given file path by scanning existing DBs
export function findSourceDirForFile(filePath) {
  const absFile = path.resolve(filePath);
  if (!fs.existsSync(DB_DIR)) return null;

  const dbFiles = fs.readdirSync(DB_DIR).filter(f => f.endsWith('.db'));
  for (const dbFile of dbFiles) {
    try {
      const db = new Database(path.join(DB_DIR, dbFile));
      const row = db.prepare("SELECT value FROM metadata WHERE key = 'source_dir'").get();
      db.close();
      if (row && absFile.startsWith(row.value + path.sep)) {
        return row.value;
      }
    } catch {
      // Skip unreadable DBs
    }
  }
  return null;
}
