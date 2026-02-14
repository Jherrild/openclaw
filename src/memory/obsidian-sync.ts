import type { DatabaseSync } from "node:sqlite";
import * as crypto from "node:crypto";
/**
 * obsidian-sync.ts — Vault file sync for the Obsidian memory provider
 *
 * Handles incremental indexing of an Obsidian vault:
 * - File discovery with configurable exclusions
 * - Frontmatter parsing for metadata extraction
 * - PARA location detection from file paths
 * - mtime + hash based change detection
 * - FTS5 indexing (instant) + chunk preparation for embedding
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface VaultSyncConfig {
  vaultPath: string;
  excludeFolders: string[];
  db: DatabaseSync;
  ftsTable: string;
  ftsAvailable: boolean;
}

export interface VaultFileEntry {
  path: string;
  relativePath: string;
  filename: string;
  hash: string;
  mtime: number;
  size: number;
  title: string | null;
  tags: string[];
  aliases: string[];
  headers: string[];
  paraCategory: string | null;
  paraArea: string | null;
  summary: string | null;
}

export interface SyncResult {
  total: number;
  newOrModified: number;
  deleted: number;
  entries: VaultFileEntry[];
}

const PARA_FOLDERS = new Set([
  "1-projects",
  "1-Projects",
  "2-areas",
  "2-Areas",
  "3-resources",
  "3-Resources",
  "4-archive",
  "4-Archive",
  "Projects",
  "Areas",
  "Resources",
  "Archive",
]);

const DEFAULT_EXCLUDE = [".obsidian", ".trash", ".git", "node_modules"];

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * Parse YAML frontmatter from markdown content.
 * Lightweight parser — no external deps.
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yamlStr = match[1];
  const body = content.slice(match[0].length).trim();
  const frontmatter: Record<string, unknown> = {};

  // Simple YAML parser for common fields
  const lines = yamlStr.split("\n");
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    // Parse arrays like [tag1, tag2]
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s: string) => s.trim().replace(/^["']|["']$/g, ""));
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/**
 * Extract headers from markdown content.
 */
function extractHeaders(content: string): string[] {
  const headers: string[] = [];
  const regex = /^(#{1,6})\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    headers.push(match[2].trim());
  }
  return headers;
}

/**
 * Detect PARA category and area from file path.
 */
function detectPara(relativePath: string): { category: string | null; area: string | null } {
  const parts = relativePath.split(path.sep).filter(Boolean);
  if (parts.length === 0) {
    return { category: null, area: null };
  }

  const topFolder = parts[0];
  if (!PARA_FOLDERS.has(topFolder)) {
    return { category: null, area: null };
  }

  return {
    category: topFolder,
    area: parts.length > 1 ? parts[1] : null,
  };
}

/**
 * Walk a directory recursively, respecting exclusions.
 */
async function walkVault(
  dir: string,
  _vaultRoot: string,
  excludeFolders: Set<string>,
): Promise<string[]> {
  const files: string[] = [];

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && excludeFolders.has(entry.name)) {
      continue;
    }
    if (excludeFolders.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    try {
      const stat = await fs.lstat(fullPath);
      if (stat.isSymbolicLink()) {
        continue;
      }

      if (stat.isDirectory()) {
        const subFiles = await walkVault(fullPath, vaultRoot, excludeFolders);
        files.push(...subFiles);
      } else if (stat.isFile() && entry.name.endsWith(".md")) {
        files.push(fullPath);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return files;
}

/**
 * Build a VaultFileEntry from a file path.
 */
async function buildFileEntry(filePath: string, vaultRoot: string): Promise<VaultFileEntry> {
  const content = await fs.readFile(filePath, "utf-8");
  const stat = await fs.stat(filePath);
  const relativePath = path.relative(vaultRoot, filePath);
  const filename = path.basename(filePath, ".md");
  const hash = hashText(content);

  const { frontmatter, body } = parseFrontmatter(content);
  const headers = extractHeaders(body);
  const { category, area } = detectPara(relativePath);

  // Extract tags (array or string)
  let tags: string[] = [];
  if (Array.isArray(frontmatter.tags)) {
    tags = frontmatter.tags.map(String);
  } else if (typeof frontmatter.tags === "string") {
    tags = frontmatter.tags.split(/[\s,]+/).filter(Boolean);
  }

  // Extract aliases
  let aliases: string[] = [];
  if (Array.isArray(frontmatter.aliases)) {
    aliases = frontmatter.aliases.map(String);
  } else if (typeof frontmatter.aliases === "string" && frontmatter.aliases) {
    aliases = frontmatter.aliases.split(/[\s,]+/).filter(Boolean);
  }

  const title = (typeof frontmatter.title === "string" ? frontmatter.title : null) || filename;
  const summary = typeof frontmatter.summary === "string" ? frontmatter.summary : null;

  return {
    path: filePath,
    relativePath,
    filename,
    hash,
    mtime: stat.mtimeMs,
    size: stat.size,
    title,
    tags,
    aliases,
    headers,
    paraCategory: category,
    paraArea: area,
    summary,
  };
}

/**
 * Sync vault files — detect new, modified, and deleted files.
 * Updates the `files` table and FTS5 index immediately (no embedding needed).
 */
export async function syncVaultFiles(config: VaultSyncConfig): Promise<SyncResult> {
  const excludeSet = new Set([...DEFAULT_EXCLUDE, ...config.excludeFolders]);

  const allPaths = await walkVault(config.vaultPath, config.vaultPath, excludeSet);

  // Get stored file hashes
  const storedFiles = new Map<string, { hash: string; mtime: number }>();
  try {
    const rows = config.db.prepare("SELECT path, hash, mtime FROM files").all() as Array<{
      path: string;
      hash: string;
      mtime: number;
    }>;
    for (const row of rows) {
      storedFiles.set(row.path, { hash: row.hash, mtime: row.mtime });
    }
  } catch {
    // Table may not exist yet on first run
  }

  const currentPaths = new Set(allPaths);
  const newOrModified: VaultFileEntry[] = [];

  // Detect new and modified files
  for (const filePath of allPaths) {
    const stored = storedFiles.get(filePath);
    const stat = await fs.stat(filePath);

    if (!stored || stat.mtimeMs > stored.mtime) {
      const entry = await buildFileEntry(filePath, config.vaultPath);

      // Skip if hash unchanged (mtime updated but content same)
      if (stored && stored.hash === entry.hash) {
        // Update mtime only
        config.db.prepare("UPDATE files SET mtime = ? WHERE path = ?").run(entry.mtime, filePath);
        continue;
      }

      newOrModified.push(entry);
    }
  }

  // Detect deleted files
  const deleted: string[] = [];
  for (const storedPath of storedFiles.keys()) {
    if (!currentPaths.has(storedPath)) {
      deleted.push(storedPath);
    }
  }

  // Apply changes: upsert files + FTS5
  const upsertFile = config.db.prepare(`
    INSERT OR REPLACE INTO files (path, hash, mtime, size, title, filename, tags, aliases, headers, para_category, para_area, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const deleteChunks = config.db.prepare("DELETE FROM chunks WHERE path = ?");
  const deleteFile = config.db.prepare("DELETE FROM files WHERE path = ?");

  // FTS5 operations (if available)
  let deleteFts: ReturnType<DatabaseSync["prepare"]> | null = null;
  let insertFts: ReturnType<DatabaseSync["prepare"]> | null = null;
  if (config.ftsAvailable) {
    try {
      deleteFts = config.db.prepare(`DELETE FROM ${config.ftsTable} WHERE path = ?`);
      insertFts = config.db.prepare(
        `INSERT INTO ${config.ftsTable} (path, filename, title, tags, aliases, para_area, headers, summary, text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
    } catch {
      // FTS5 not actually available despite flag
    }
  }

  // Process new/modified
  for (const entry of newOrModified) {
    upsertFile.run(
      entry.path,
      entry.hash,
      entry.mtime,
      entry.size,
      entry.title,
      entry.filename,
      JSON.stringify(entry.tags),
      JSON.stringify(entry.aliases),
      JSON.stringify(entry.headers),
      entry.paraCategory,
      entry.paraArea,
      entry.summary,
    );

    // Clear old chunks and FTS entries
    deleteChunks.run(entry.path);
    deleteFts?.run(entry.path);

    // Insert FTS5 entry (file-level, not chunk-level — richer metadata)
    if (insertFts) {
      const { body } = parseFrontmatter(await fs.readFile(entry.path, "utf-8"));
      insertFts.run(
        entry.path,
        entry.filename,
        entry.title,
        entry.tags.join(" "),
        entry.aliases.join(" "),
        entry.paraArea || "",
        entry.headers.join(" "),
        entry.summary || "",
        body.slice(0, 10000), // Cap text for FTS to prevent huge entries
      );
    }
  }

  // Process deleted
  for (const dp of deleted) {
    deleteChunks.run(dp);
    deleteFile.run(dp);
    deleteFts?.run(dp);
  }

  return {
    total: allPaths.length,
    newOrModified: newOrModified.length,
    deleted: deleted.length,
    entries: newOrModified,
  };
}

/**
 * Paragraph-aware chunking with overlap.
 * Ported from local-rag with improvements.
 */
export function chunkMarkdown(
  content: string,
  chunkSize: number = 600,
  overlap: number = 80,
): Array<{ text: string; startLine: number; endLine: number; hash: string }> {
  const lines = content.split("\n");
  if (lines.length === 0 || (lines.length === 1 && !lines[0].trim())) {
    return [];
  }

  const maxChars = Math.max(32, chunkSize * 4); // ~4 chars per token
  const overlapChars = Math.max(0, overlap * 4);
  const chunks: Array<{
    text: string;
    startLine: number;
    endLine: number;
    hash: string;
  }> = [];

  let current: Array<{ line: string; lineNo: number }> = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    const text = current.map((e) => e.line).join("\n");
    const startLine = current[0].lineNo;
    const endLine = current[current.length - 1].lineNo;
    chunks.push({ text, startLine, endLine, hash: hashText(text) });
  };

  const carryOverlap = () => {
    if (overlapChars <= 0 || current.length === 0) {
      current = [];
      currentChars = 0;
      return;
    }
    let acc = 0;
    const kept: Array<{ line: string; lineNo: number }> = [];
    for (let i = current.length - 1; i >= 0; i--) {
      acc += current[i].line.length + 1;
      kept.unshift(current[i]);
      if (acc >= overlapChars) {
        break;
      }
    }
    current = kept;
    currentChars = kept.reduce((sum, e) => sum + e.line.length + 1, 0);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineChars = line.length + 1;

    if (currentChars + lineChars > maxChars && current.length > 0) {
      flush();
      carryOverlap();
    }

    current.push({ line, lineNo: i + 1 });
    currentChars += lineChars;
  }

  flush();
  return chunks;
}
