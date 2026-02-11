# PRD: Local RAG Refactor v2 — Hybrid Search Overhaul

> **Status:** Proposed (v2 rewrite — Feb 2026)  
> **Supersedes:** Original hybrid search PRD  
> **Author:** Magnus (AI research pass) + Jesten (review)

---

## 1. Executive Summary

The current `local-rag` implementation has three critical weaknesses:

1. **Brute-force search:** Every query deserializes and compares against *every* embedding in the DB. At ~700 files × N chunks, this is O(N) cosine similarity in JavaScript — slow and unscalable.
2. **No real keyword/BM25 layer:** Metadata boosting is done with hand-tuned additive constants (`+0.3`, `+0.5`) on top of cosine scores. This works for exact filename hits but fails for semantic-adjacent keyword queries (e.g., "tax documents" should find `IRS-Letter-Whidbey-Island-Poodles-LLC-2024-Penalty-Removal.md` but doesn't because the word "tax" only appears in frontmatter tags).
3. **Embedding storage as JSON text:** Each 768-dim float32 vector is stored as a JSON string (~6KB per chunk). Parsing these on every search is a massive bottleneck.

### Vision
Replace the current JS-cosine-similarity-over-JSON approach with a **proper hybrid search pipeline**:
- **Vector search** via `sqlite-vec` (native SIMD-accelerated KNN in SQLite)
- **Keyword search** via SQLite FTS5 with BM25 ranking
- **Score fusion** via Reciprocal Rank Fusion (RRF)
- **PARA-aware indexing** that enriches chunks with vault structure context

The result: a search that "just works" — whether you type `"April Jane"`, `"tax documents"`, or `"people who do design"`.

---

## 2. Current Architecture Critique

### What Works
- Incremental mtime-based indexing (PRD-optimization.md) — keep this.
- Metadata prefix enrichment (`[Title: X] [Tags: Y] content...`) — good idea, needs refinement.
- Single-file re-index support — keep this.
- `better-sqlite3` as the DB driver — keep this.

### What's Broken

| Problem | Impact | Root Cause |
|---------|--------|------------|
| `getAllDocuments()` loads entire DB into JS memory | OOM risk, 5-10s search latency | No native vector index |
| JSON-serialized embeddings | ~6KB per chunk parsed in JS | No binary vector storage |
| Metadata boost is additive constants on cosine | Fragile, doesn't handle multi-term queries | No proper keyword index |
| `"tax documents"` misses IRS letter | Tags are embedded in prefix but not keyword-searchable | No FTS5 index on metadata |
| Chunk text is character-based, not semantic | Splits mid-sentence, mid-paragraph | No paragraph/section-aware chunking |
| PARA path context is lost | `2-Areas/Finance/` context not used in ranking | Path not indexed |

### Existing PRD Assessment
- **PRD.md (original):** Correct in choosing SQLite + Ollama. The "no heavy frameworks" constraint remains valid. ✓
- **PRD-optimization.md:** Incremental indexing, mtime tracking, concurrency — all implemented and working. ✓
- **Original hybrid search PRD (this file, v1):** Identified the right problem (metadata weighting) but proposed a half-measure (additive boosts). The implementation delivered on that design, but it's insufficient for real-world queries. Needs the full overhaul proposed below.

---

## 3. Data Model: Obsidian PARA Vault

### 3.1. Vault Structure
```
remote-personal/
├── 1-Projects/     # Active projects with deadlines
├── 2-Areas/        # Ongoing areas of responsibility
│   ├── Finance/
│   │   ├── Taxes/
│   │   ├── Documents/
│   │   └── IRS-Letter-Whidbey-Island-Poodles-LLC-2024-Penalty-Removal.md
│   ├── People/
│   │   ├── April Jane.md
│   │   └── Beth Herrild.md
│   └── Health/
├── 3-Resources/    # Reference material
└── 4-Archive/      # Inactive items
```

### 3.2. Note Anatomy (IRS Letter Example)
```markdown
---
tags: [finance, taxes, irs, whidbey-island-poodles-llc]
date: 2026-02-10
summary: IRS approval of penalty removal for Whidbey Island Poodles LLC...
---
# IRS Letter: Penalty Removal - Whidbey Island Poodles LLC (2024)

## Header Information
IRS Department of the Treasury...
```

### 3.3. Key Components to Index

| Component | Source | Weight | Used In |
|-----------|--------|--------|---------|
| **Filename** | File path | Critical | FTS5 + metadata boost |
| **PARA path** | Directory hierarchy | High | FTS5 field, e.g. `area:Finance` |
| **Tags** | YAML frontmatter | High | FTS5 + vector prefix |
| **Aliases** | YAML frontmatter | Critical | FTS5 (exact match) |
| **Title** | H1 header or filename | High | FTS5 + vector prefix |
| **Summary** | YAML `summary` field | High | FTS5 + vector prefix |
| **Headers** | H2-H6 | Medium | FTS5 |
| **Body content** | Markdown body | Standard | FTS5 + vector embeddings |

---

## 4. Proposed Architecture

### 4.1. Technology Stack

| Component | Current | Proposed | Why |
|-----------|---------|----------|-----|
| Vector storage | JSON text in SQLite | `sqlite-vec` extension | Native KNN, SIMD-accelerated, binary blobs, 50-100x faster search |
| Keyword search | None (metadata boost heuristics) | SQLite FTS5 with BM25 | Built into SQLite, zero dependencies, proper TF-IDF ranking |
| Score fusion | Additive constants | Reciprocal Rank Fusion (RRF) | Standard, proven technique; no tuning needed |
| Embedding model | `nomic-embed-text` (768d) | Keep `nomic-embed-text` | Good balance of speed/quality; 8192 token context. Re-evaluate `snowflake-arctic-embed-m` if accuracy is insufficient |
| Chunking | Character-based (1000 chars, 200 overlap) | Paragraph-aware with header context | Preserves semantic coherence |
| DB driver | `better-sqlite3` | Keep, add `sqlite-vec` npm extension | `db.loadExtension()` supported natively |

### 4.2. New Dependencies
```json
{
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "sqlite-vec": "^0.1.0"
  }
}
```
No new runtime services. No Docker. No Python. Just an npm package that provides the `.so`/`.dll`.

### 4.3. Database Schema (Revised)

```sql
-- Load extension on open
-- db.loadExtension(require('sqlite-vec').getLoadablePath());

-- Existing metadata table (keep)
CREATE TABLE IF NOT EXISTS file_metadata (
  file_path TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  title TEXT,
  tags TEXT,        -- JSON array
  aliases TEXT,     -- JSON array
  headers TEXT,     -- JSON array
  para_category TEXT,  -- NEW: '1-Projects', '2-Areas', etc.
  para_area TEXT,      -- NEW: 'Finance', 'People', 'Health', etc.
  summary TEXT,        -- NEW: from frontmatter
  mtime REAL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- FTS5 index for keyword/BM25 search (NEW)
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  file_path,       -- for joining back
  filename,        -- high weight via rank
  title,
  tags,            -- space-separated for tokenization
  aliases,         -- space-separated
  para_area,       -- e.g., "Finance"
  headers,         -- space-separated
  summary,
  content,         -- full body text
  tokenize='porter unicode61'
);

-- Vector index for semantic search (NEW — replaces documents table)
CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
  embedding float[768]  -- nomic-embed-text dimension
);

-- Chunk content table (stores text alongside vec_chunks rowid)
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,  -- matches vec_chunks rowid
  file_path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_path);
```

### 4.4. Indexing Pipeline (Revised)

```
For each markdown file:
  1. Parse frontmatter (tags, aliases, summary, date)
  2. Extract PARA context from file path:
     - "2-Areas/Finance/Taxes/..." → para_category="2-Areas", para_area="Finance"
  3. Extract title (H1 or filename)
  4. Extract headers (H2-H6)
  5. Chunk body using paragraph-aware strategy:
     a. Split on double newlines (paragraphs)
     b. Merge small paragraphs until ~800 chars
     c. Prepend metadata context to each chunk:
        "[Title: IRS Letter: Penalty Removal] [Area: Finance] [Tags: finance, taxes, irs] ..."
  6. Generate embeddings via Ollama (batch, concurrent)
  7. INSERT into:
     - file_metadata (upsert)
     - search_fts (delete + re-insert per file)
     - vec_chunks + chunks (delete + re-insert per file)
  8. Update mtime
```

### 4.5. Search Pipeline (Revised)

```
Given query Q:

  STEP 1: Vector Search (semantic)
    - Embed Q via Ollama
    - SELECT rowid, distance FROM vec_chunks
      WHERE embedding MATCH <query_vector>
      ORDER BY distance LIMIT 50
    - Map rowid → file_path via chunks table
    - Deduplicate: keep best score per file
    - Rank files 1..N by vector distance (ascending = better)

  STEP 2: Keyword Search (BM25)
    - SELECT file_path, bm25(search_fts, 10, 8, 5, 8, 4, 3, 3, 1) AS bm25_score
      FROM search_fts
      WHERE search_fts MATCH <tokenized_query>
      ORDER BY bm25_score LIMIT 50
    - Column weights (in order): filename=10, title=8, tags=5, aliases=8,
      para_area=4, headers=3, summary=3, content=1
    - Rank files 1..N by BM25 score (ascending = better, FTS5 returns negative BM25)

  STEP 3: Reciprocal Rank Fusion
    - For each file appearing in either list:
      rrf_score = 1/(k + vec_rank) + 1/(k + bm25_rank)
      where k = 60 (standard constant)
    - Files in only one list get rank = 999 for the missing list
    - Sort by rrf_score descending
    - Return top_k results

  STEP 4: (Optional) Entity Shortcut
    - Before Steps 1-3, check if Q exactly matches a filename or alias
    - If so, pin that file to position #1 regardless of RRF
    - This handles "April Jane" → April Jane.md instantly
```

---

## 5. Concrete Examples

### 5.1. Query: `"tax documents"`

**Current behavior (broken):** The IRS letter has `tags: [finance, taxes, irs]` in frontmatter, which gets prepended as `[Tags: finance, taxes, irs]` to chunk embeddings. But the metadata boost only fires on exact filename/alias matches. "tax documents" doesn't match the filename, so it relies purely on vector similarity — which is weak because the body text is about "penalty removal" and "Whidbey Island Poodles LLC", not "tax documents" explicitly.

**New behavior (with FTS5 + RRF):**
- **FTS5 hit:** The `tags` column contains `finance taxes irs`. The `para_area` column contains `Finance`. The `filename` contains `IRS`. BM25 scores this file highly for the query `tax documents` because:
  - `taxes` matches the tag (weight 5)
  - `Finance` matches the para_area (weight 4)
  - The content mentions "Tax periods" and "penalty" (weight 1)
- **Vector hit:** Moderate similarity — "tax documents" is semantically related to penalty removal letters.
- **RRF fusion:** High BM25 rank + moderate vector rank = strong combined score. File surfaces in top 3-5.

### 5.2. Query: `"April Jane"`

**FTS5:** Exact match on `filename` (weight 10) and `title` (weight 8). BM25 rank = #1.
**Vector:** Good semantic match because metadata prefix includes `[Title: April Jane]`.
**RRF:** Both rank #1 → strong RRF score. Result: position #1.
**Entity shortcut:** Also catches this as an exact filename match → pinned to #1.

### 5.3. Query: `"AJ"`

**FTS5:** Exact match on `aliases` (weight 8). BM25 rank near top.
**Entity shortcut:** "AJ" matches alias → pinned to #1.

### 5.4. Query: `"people who do design"`

**FTS5:** `people` matches tag. Weak match overall.
**Vector:** Strong semantic match — the embedding of "people who do design" is close to the enriched chunk `[Title: April Jane] [Tags: people, AprilJane] Relation: Wife. Used to crochet...`.
**RRF:** Moderate BM25 + strong vector = good combined score. Surfaces in top results.

### 5.5. Query: `"IRS penalty"`

**FTS5:** `IRS` matches tag and filename; `penalty` matches content ("penalty removal"). High BM25.
**Vector:** Good semantic match to IRS letter content.
**RRF:** Both rank highly → #1 or #2.

---

## 6. Paragraph-Aware Chunking Strategy

### Current (Character-based)
```
chunk_size: 1000 chars, overlap: 200 chars
→ Splits mid-sentence, mid-paragraph
→ Fragments destroy semantic coherence
```

### Proposed (Paragraph-aware)
```javascript
function chunkByParagraphs(body, maxChunkSize = 800) {
  const paragraphs = body.split(/\n\n+/);
  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length > maxChunkSize && current.length > 0) {
      chunks.push(current.trim());
      current = '';
    }
    current += (current ? '\n\n' : '') + para;
  }
  if (current.trim()) chunks.push(current.trim());

  // Split oversized chunks at sentence boundaries
  return chunks.flatMap(chunk =>
    chunk.length > maxChunkSize * 1.5
      ? splitAtSentences(chunk, maxChunkSize)
      : [chunk]
  );
}
```

This preserves the semantic coherence of paragraphs (e.g., keeping the full "Dear Taxpayer" paragraph together in the IRS letter) while respecting the embedding model's context window.

---

## 7. Implementation Plan

### Phase 1: sqlite-vec Integration (Core)
**Files:** `db.js`, `package.json`
1. `npm install sqlite-vec`
2. Update `openDb()` to call `db.loadExtension(require('sqlite-vec').getLoadablePath())`
3. Create `vec_chunks` virtual table and `chunks` table
4. Create `search_fts` virtual table
5. Migrate `insertChunk()` to write binary vectors to `vec_chunks` + text to `chunks`
6. Migrate `deleteFile()` to clean up all three tables
7. Keep old `documents` table temporarily for migration path
8. **Test:** Verify `sqlite-vec` loads and KNN query works

### Phase 2: FTS5 Indexing
**Files:** `rag.js`, `db.js`
1. Add PARA path extraction logic
2. Update `insertFileMetadata()` to populate `search_fts`
3. On file delete: remove from `search_fts` too
4. Update `cmdIndex()` to populate FTS5 during indexing
5. **Test:** Verify `SELECT * FROM search_fts WHERE search_fts MATCH 'tax'` returns IRS letter

### Phase 3: Hybrid Search with RRF
**Files:** `rag.js`, `db.js`
1. New function: `vectorSearch(db, queryEmbedding, limit)` — uses `vec_chunks` MATCH
2. New function: `keywordSearch(db, query, limit)` — uses `search_fts` with BM25
3. New function: `reciprocalRankFusion(vecResults, ftsResults, k=60)`
4. New function: `entityShortcut(db, query)` — exact filename/alias check
5. Rewrite `cmdSearch()` to orchestrate: entity check → parallel vector+keyword → RRF → format output
6. **Remove:** `getAllDocuments()` (no longer needed — vector search is native)
7. **Test:** Run all 5 example queries from Section 5

### Phase 4: Paragraph-Aware Chunking
**Files:** `rag.js`
1. Replace `chunkText()` with `chunkByParagraphs()`
2. Keep metadata prefix enrichment (it's working well)
3. **Test:** Verify chunk boundaries align with paragraph breaks
4. **Note:** Requires full re-index after deployment

### Phase 5: Migration & Cleanup
1. Add migration logic: detect old `documents` table → prompt re-index
2. Remove old `documents` table after successful migration
3. Update `SKILL.md` with new capabilities
4. Update `config.json` with new defaults if needed

---

## 8. Configuration Changes

```json
{
  "embedding_model": "nomic-embed-text",
  "embedding_dim": 768,
  "chat_model": "gemma:2b",
  "ollama_url": "http://localhost:11434",
  "chunk_size": 800,
  "chunk_overlap": 0,
  "top_k": 20,
  "db_dir": "~/.local-rag",
  "concurrency": 5,
  "rrf_k": 60,
  "vector_search_limit": 50,
  "fts_search_limit": 50,
  "fts_weights": {
    "filename": 10,
    "title": 8,
    "tags": 5,
    "aliases": 8,
    "para_area": 4,
    "headers": 3,
    "summary": 3,
    "content": 1
  }
}
```

---

## 9. Success Metrics

| Query | Expected #1 Result | Tests |
|-------|-------------------|-------|
| `"April Jane"` | `2-Areas/People/April Jane.md` | Exact filename match + entity shortcut |
| `"AJ"` | `2-Areas/People/April Jane.md` | Alias match via FTS5 |
| `"tax documents"` | Any file under `2-Areas/Finance/Taxes/` or IRS letter | FTS5 tag+area match |
| `"IRS penalty"` | `IRS-Letter-Whidbey-Island-Poodles-LLC-2024-Penalty-Removal.md` | FTS5 + vector combined |
| `"people who do design"` | `2-Areas/People/April Jane.md` | Vector semantic match |
| `"home projects"` | Files under `1-Projects/` or `2-Areas/Home/` | FTS5 para_area + vector |
| Search latency (700 files) | < 200ms | `sqlite-vec` native KNN vs current 5-10s |

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `sqlite-vec` npm binary doesn't work on WSL2 | Blocker | Test early in Phase 1; fallback: compile from source or use LanceDB |
| FTS5 tokenizer splits hyphenated terms poorly | Missed matches for `whidbey-island-poodles-llc` | Use `tokenize='porter unicode61'` which handles hyphens; also store tags space-separated |
| Full re-index required after migration | 90s downtime | Acceptable; incremental afterward |
| `nomic-embed-text` quality insufficient for nuanced queries | Poor vector ranking | Evaluate `snowflake-arctic-embed-m` as drop-in replacement (same API) |

---

## 11. Future Considerations (Out of Scope)

- **Query expansion:** Use an LLM to expand "tax documents" → "IRS, taxes, 1099, W-2, returns, deductions" before searching. High impact but adds latency.
- **Auto-tagging:** Use an LLM to suggest tags for untagged notes during indexing.
- **Cross-reference search:** Follow `[[wikilinks]]` to boost related notes.
- **Quantized embeddings:** Store `int8` vectors instead of `float32` for 4x storage reduction (sqlite-vec supports this).
- **Watch mode:** Use `fs.watch` or `inotify` to auto-reindex on file changes instead of manual `index` command.
