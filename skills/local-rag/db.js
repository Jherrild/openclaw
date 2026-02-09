/**
 * SQLite database operations for local-rag
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const CONFIG = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url)));
const DB_DIR = CONFIG.db_dir.replace('~', os.homedir());

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

// Initialize or open database for a directory
export function openDb(dirPath) {
  const dbPath = getDbPath(dirPath);
  const db = new Database(dbPath);
  
  // Create tables if they don't exist
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
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_filename ON file_metadata(filename);
  `);

  // Migration: add mtime column to file_metadata if missing
  const cols = db.pragma('table_info(file_metadata)');
  if (!cols.find(c => c.name === 'mtime')) {
    db.exec('ALTER TABLE file_metadata ADD COLUMN mtime REAL');
  }
  
  // Store the indexed directory path
  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)')
    .run('source_dir', path.resolve(dirPath));
  
  return db;
}

// Insert a document chunk with its embedding
export function insertChunk(db, filePath, chunkIndex, content, embedding) {
  const id = `${filePath}:${chunkIndex}`;
  const embeddingJson = JSON.stringify(embedding);
  
  db.prepare(`
    INSERT OR REPLACE INTO documents (id, file_path, chunk_index, content, embedding)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, filePath, chunkIndex, content, embeddingJson);
}

// Delete all chunks for a file (for re-indexing)
export function deleteFile(db, filePath) {
  db.prepare('DELETE FROM documents WHERE file_path = ?').run(filePath);
}

// Get all documents for similarity search
export function getAllDocuments(db) {
  return db.prepare('SELECT id, file_path, chunk_index, content, embedding FROM documents').all()
    .map(row => ({
      ...row,
      embedding: JSON.parse(row.embedding)
    }));
}

// Get document count
export function getDocCount(db) {
  return db.prepare('SELECT COUNT(*) as count FROM documents').get().count;
}

// Clear all documents
export function clearAll(db) {
  db.prepare('DELETE FROM documents').run();
  db.prepare('DELETE FROM file_metadata').run();
}

// Insert file metadata for hybrid search
export function insertFileMetadata(db, filePath, filename, title, tags, aliases, headers) {
  db.prepare(`
    INSERT OR REPLACE INTO file_metadata (file_path, filename, title, tags, aliases, headers)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(filePath, filename, title, JSON.stringify(tags), JSON.stringify(aliases), JSON.stringify(headers));
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

// Delete file metadata entry
export function deleteFileMetadata(db, filePath) {
  db.prepare('DELETE FROM file_metadata WHERE file_path = ?').run(filePath);
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
