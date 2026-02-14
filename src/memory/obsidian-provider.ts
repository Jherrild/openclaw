import type { DatabaseSync } from "node:sqlite";
import * as crypto from "node:crypto";
/**
 * obsidian-provider.ts — ObsidianMemoryProvider
 *
 * Native Obsidian vault memory provider for OpenClaw.
 * Implements MemorySearchManager interface with:
 * - Background indexing (FTS5 instant, vectors async)
 * - Hybrid search via RRF (sqlite-vec KNN + FTS5 BM25)
 * - PARA-aware metadata extraction
 * - Fallback to FTS5-only while vectors are building
 */
import * as path from "node:path";
import type { EmbeddingProvider } from "./embeddings.js";
import type {
  MemorySearchManager,
  MemorySearchResult,
  MemoryProviderStatus,
  MemoryEmbeddingProbeResult,
  MemorySyncProgressUpdate,
} from "./types.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { ensureObsidianSchema } from "./obsidian-schema.js";
import {
  hybridSearch,
  entityShortcut,
  keywordSearch,
  type ObsidianSearchOptions,
} from "./obsidian-search.js";
import { syncVaultFiles, chunkMarkdown, type VaultFileEntry } from "./obsidian-sync.js";
import { requireNodeSqlite } from "./sqlite.js";

const log = createSubsystemLogger("memory/obsidian");

const VECTOR_TABLE = "obsidian_vec";
const FTS_TABLE = "obsidian_fts";

export interface ObsidianProviderConfig {
  vaultPath: string;
  dbPath: string;
  excludeFolders: string[];
  chunking: { tokens: number; overlap: number };
  search: ObsidianSearchOptions;
  preserveLocal: boolean;
}

interface IndexingState {
  phase: "idle" | "fts" | "embedding" | "complete";
  total: number;
  completed: number;
  startedAt?: number;
}

export class ObsidianMemoryProvider implements MemorySearchManager {
  private db: DatabaseSync;
  private provider: EmbeddingProvider;
  private config: ObsidianProviderConfig;
  private ftsAvailable = false;
  private vecAvailable = false;
  private indexing: IndexingState = { phase: "idle", total: 0, completed: 0 };
  private dirty = true;
  private embeddingDims: number | null = null;

  constructor(params: { config: ObsidianProviderConfig; provider: EmbeddingProvider }) {
    this.config = params.config;
    this.provider = params.provider;

    // Open database
    const { DatabaseSync } = requireNodeSqlite();
    const dir = path.dirname(this.config.dbPath);
    require("node:fs").mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(this.config.dbPath, { allowExtension: true });

    log.info("Obsidian provider initialized", {
      vaultPath: this.config.vaultPath,
      dbPath: this.config.dbPath,
    });
  }

  /**
   * Initialize schema and start background indexing.
   */
  async initialize(): Promise<void> {
    // Probe embedding dimensions
    try {
      const probe = await this.provider.embedQuery("test");
      this.embeddingDims = probe.length;
    } catch (err) {
      log.warn(`Embedding probe failed: ${err instanceof Error ? err.message : String(err)}`);
      this.embeddingDims = 768; // Fallback
    }

    // Create schema
    const schemaResult = ensureObsidianSchema({
      db: this.db,
      embeddingDims: this.embeddingDims,
      vectorTable: VECTOR_TABLE,
      ftsTable: FTS_TABLE,
    });
    this.ftsAvailable = schemaResult.ftsAvailable;
    this.vecAvailable = schemaResult.vecAvailable;

    if (schemaResult.ftsError) {
      log.warn(`FTS5 unavailable: ${schemaResult.ftsError}`);
    }
    if (schemaResult.vecError) {
      log.warn(`sqlite-vec unavailable: ${schemaResult.vecError}`);
    }

    // Start background sync
    void this.sync({ reason: "initialize" });
  }

  /**
   * Search the vault using hybrid RRF (or FTS5-only if still indexing).
   */
  async search(
    query: string,
    opts?: { maxResults?: number; minScore?: number; sessionKey?: string },
  ): Promise<MemorySearchResult[]> {
    const cleaned = query.trim();
    if (!cleaned) {
      return [];
    }

    // Entity shortcut — exact filename/alias match
    const entityMatch = entityShortcut(this.db, cleaned);

    // If still embedding, use FTS5-only search
    if (this.indexing.phase === "embedding" || !this.vecAvailable) {
      return this.ftsOnlySearch(cleaned, opts?.maxResults || 6, entityMatch);
    }

    // Full hybrid search
    try {
      const queryEmbedding = await this.provider.embedQuery(cleaned);
      const embedding = new Float32Array(queryEmbedding);

      const results = hybridSearch({
        db: this.db,
        queryEmbedding: embedding,
        queryText: cleaned,
        vectorTable: VECTOR_TABLE,
        ftsTable: FTS_TABLE,
        options: {
          maxResults: opts?.maxResults || this.config.search.maxResults || 8,
          minScore: opts?.minScore || this.config.search.minScore || 0,
          ...this.config.search,
        },
      });

      // Convert to MemorySearchResult format
      const memResults: MemorySearchResult[] = results.map((r) => ({
        path: path.relative(this.config.vaultPath, r.path),
        startLine: r.bestChunk?.startLine || 0,
        endLine: r.bestChunk?.endLine || 0,
        score: r.rrfScore,
        snippet: r.bestChunk?.text?.slice(0, 500) || "",
        source: "memory" as const,
      }));

      // If entity match found, ensure it's in results at top
      if (entityMatch) {
        const relPath = path.relative(this.config.vaultPath, entityMatch);
        const alreadyPresent = memResults.some((r) => r.path === relPath);
        if (!alreadyPresent) {
          memResults.unshift({
            path: relPath,
            startLine: 0,
            endLine: 0,
            score: 1.0,
            snippet: `[Entity match: ${path.basename(entityMatch)}]`,
            source: "memory",
          });
        }
      }

      return memResults;
    } catch (err) {
      log.warn(
        `Hybrid search failed, falling back to FTS5: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.ftsOnlySearch(cleaned, opts?.maxResults || 6, entityMatch);
    }
  }

  /**
   * FTS5-only search (used during embedding phase or as fallback).
   */
  private ftsOnlySearch(
    query: string,
    maxResults: number,
    entityMatch: string | null,
  ): MemorySearchResult[] {
    if (!this.ftsAvailable) {
      return [];
    }

    const ftsResults = keywordSearch(this.db, query, FTS_TABLE, maxResults);
    const results: MemorySearchResult[] = ftsResults.map((r, i) => ({
      path: path.relative(this.config.vaultPath, r.path),
      startLine: 0,
      endLine: 0,
      score: 1 / (1 + i), // Rank-based score
      snippet: `[Keyword match — vector search still indexing]`,
      source: "memory" as const,
    }));

    if (entityMatch) {
      const relPath = path.relative(this.config.vaultPath, entityMatch);
      if (!results.some((r) => r.path === relPath)) {
        results.unshift({
          path: relPath,
          startLine: 0,
          endLine: 0,
          score: 1.0,
          snippet: `[Entity match: ${path.basename(entityMatch)}]`,
          source: "memory",
        });
      }
    }

    return results.slice(0, maxResults);
  }

  /**
   * Read a file from the vault.
   */
  async readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
  }): Promise<{ text: string; path: string }> {
    const absPath = path.join(this.config.vaultPath, params.relPath);
    const fs = require("node:fs");

    if (!fs.existsSync(absPath)) {
      return { text: `File not found: ${params.relPath}`, path: params.relPath };
    }

    const content = fs.readFileSync(absPath, "utf-8");
    const allLines = content.split("\n");

    if (params.from !== undefined || params.lines !== undefined) {
      const from = Math.max(0, (params.from || 1) - 1);
      const count = params.lines || 20;
      const slice = allLines.slice(from, from + count);
      return { text: slice.join("\n"), path: params.relPath };
    }

    return { text: content, path: params.relPath };
  }

  /**
   * Sync vault files and build embeddings.
   */
  async sync(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void> {
    if (this.indexing.phase === "embedding" && !params?.force) {
      return; // Already indexing
    }

    const reason = params?.reason || "sync";
    log.info(`Starting vault sync (reason: ${reason})`);

    // Phase 1: File scan + FTS5 (instant)
    this.indexing = { phase: "fts", total: 0, completed: 0, startedAt: Date.now() };

    const syncResult = await syncVaultFiles({
      vaultPath: this.config.vaultPath,
      excludeFolders: this.config.excludeFolders,
      db: this.db,
      ftsTable: FTS_TABLE,
      ftsAvailable: this.ftsAvailable,
    });

    log.info(
      `Vault scan complete: ${syncResult.total} files, ${syncResult.newOrModified} new/modified, ${syncResult.deleted} deleted`,
    );

    if (syncResult.newOrModified === 0 && !params?.force) {
      this.indexing = { phase: "complete", total: syncResult.total, completed: syncResult.total };
      this.dirty = false;
      return;
    }

    // Phase 2: Background embedding
    if (this.vecAvailable && syncResult.entries.length > 0) {
      this.indexing = {
        phase: "embedding",
        total: syncResult.entries.length,
        completed: 0,
        startedAt: Date.now(),
      };

      try {
        await this.embedFiles(syncResult.entries, params?.progress);
      } catch (err) {
        log.warn(`Embedding phase failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Phase 3: Complete
    this.indexing = {
      phase: "complete",
      total: syncResult.total,
      completed: syncResult.total,
    };
    this.dirty = false;

    log.info(`Vault indexing complete (${Date.now() - (this.indexing.startedAt || Date.now())}ms)`);
  }

  /**
   * Embed new/modified files and insert into vector table.
   */
  private async embedFiles(
    entries: VaultFileEntry[],
    progress?: (update: MemorySyncProgressUpdate) => void,
  ): Promise<void> {
    const fs = require("node:fs");
    const chunking = this.config.chunking;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      try {
        const content = fs.readFileSync(entry.path, "utf-8");
        const { body } = this.parseFrontmatterLight(content);

        // Create metadata prefix for embedding enrichment
        const prefix = this.createMetadataPrefix(entry);
        const chunks = chunkMarkdown(body, chunking.tokens, chunking.overlap);

        for (const chunk of chunks) {
          const chunkId = crypto
            .createHash("md5")
            .update(entry.path + ":" + chunk.startLine)
            .digest("hex")
            .slice(0, 12);
          const enrichedText = prefix + chunk.text;

          // Check embedding cache
          const cached = this.getEmbeddingFromCache(chunk.hash);
          let embedding: number[];

          if (cached) {
            embedding = cached;
          } else {
            embedding = await this.provider.embedQuery(enrichedText);
            this.cacheEmbedding(chunk.hash, embedding);
          }

          // Insert chunk
          this.db
            .prepare(
              `INSERT OR REPLACE INTO chunks (id, path, start_line, end_line, hash, model, text, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              chunkId,
              entry.path,
              chunk.startLine,
              chunk.endLine,
              chunk.hash,
              this.provider.model,
              chunk.text,
              Date.now(),
            );

          // Insert vector
          try {
            this.db
              .prepare(`INSERT OR REPLACE INTO ${VECTOR_TABLE} (id, embedding) VALUES (?, ?)`)
              .run(chunkId, Buffer.from(new Float32Array(embedding).buffer));
          } catch {
            // sqlite-vec insert failure — non-fatal
          }
        }
      } catch (err) {
        log.warn(
          `Failed to embed ${entry.relativePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      this.indexing.completed = i + 1;
      progress?.({
        completed: i + 1,
        total: entries.length,
        label: `Embedding vault files: ${i + 1}/${entries.length}`,
      });
    }
  }

  private createMetadataPrefix(entry: VaultFileEntry): string {
    const parts: string[] = [];
    if (entry.title) {
      parts.push(`[Title: ${entry.title}]`);
    }
    if (entry.paraArea) {
      parts.push(`[Area: ${entry.paraArea}]`);
    }
    if (entry.tags.length > 0) {
      parts.push(`[Tags: ${entry.tags.join(", ")}]`);
    }
    if (entry.aliases.length > 0) {
      parts.push(`[Aliases: ${entry.aliases.join(", ")}]`);
    }
    return parts.length > 0 ? parts.join(" ") + " " : "";
  }

  private getEmbeddingFromCache(hash: string): number[] | null {
    try {
      const row = this.db
        .prepare("SELECT embedding FROM embedding_cache WHERE hash = ? AND model = ?")
        .get(hash, this.provider.model) as { embedding: string } | undefined;
      if (row) {
        return JSON.parse(row.embedding);
      }
    } catch {
      // Cache miss
    }
    return null;
  }

  private cacheEmbedding(hash: string, embedding: number[]): void {
    try {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO embedding_cache (hash, model, embedding, dims, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(hash, this.provider.model, JSON.stringify(embedding), embedding.length, Date.now());
    } catch {
      // Cache write failure — non-fatal
    }
  }

  private parseFrontmatterLight(content: string): { body: string } {
    const match = content.match(/^---\r?\n[\s\S]*?\r?\n---/);
    if (!match) {
      return { body: content };
    }
    return { body: content.slice(match[0].length).trim() };
  }

  status(): MemoryProviderStatus {
    let chunks = 0;
    let files = 0;
    try {
      chunks = (this.db.prepare("SELECT COUNT(*) as c FROM chunks").get() as { c: number }).c;
      files = (this.db.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number }).c;
    } catch {
      // Tables may not exist yet
    }

    return {
      backend: "builtin",
      provider: "obsidian",
      model: this.provider.model,
      files,
      chunks,
      dirty: this.dirty,
      workspaceDir: this.config.vaultPath,
      dbPath: this.config.dbPath,
      fts: { enabled: true, available: this.ftsAvailable },
      vector: {
        enabled: true,
        available: this.vecAvailable,
        dims: this.embeddingDims || undefined,
      },
      custom: {
        indexingPhase: this.indexing.phase,
        indexingProgress: `${this.indexing.completed}/${this.indexing.total}`,
        vaultPath: this.config.vaultPath,
        excludeFolders: this.config.excludeFolders,
      },
    };
  }

  async probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
    try {
      await this.provider.embedQuery("probe");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async probeVectorAvailability(): Promise<boolean> {
    return this.vecAvailable;
  }

  async close(): Promise<void> {
    try {
      this.db.close();
    } catch {
      // Already closed
    }
  }
}
