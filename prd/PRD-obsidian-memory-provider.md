# PRD: Native Obsidian Memory Provider for OpenClaw

> **Status:** Phase 1 Complete — 2026-02-15 (Issue #6: factory wiring done on `feat/obsidian-memory-wiring`)
> **Author:** Jesten Herrild (jherrild), with analysis by Copilot
> **Fork:** `~/openclaw-fork/` (Jherrild/openclaw)
> **Upstream issues:** [#8851](https://github.com/openclaw/openclaw/issues/8851) (EMFILE watcher)

### Implementation Status (Issue #6)

All core wiring is complete. The 4 provider modules (`obsidian-provider.ts`, `obsidian-schema.ts`, `obsidian-search.ts`, `obsidian-sync.ts`) were built in a prior session. Issue #6 wired them into the OpenClaw memory factory:

| Stage                | Description                                                                                                        | Status  | Key Files                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------- |
| 1. Config types      | `"obsidian"` added to `MemoryBackend`, `MemoryObsidianConfig` type                                                 | ✅ Done | `types.memory.ts`                           |
| 2. Config resolution | `resolveObsidianBackend()` with defaults for vaultPath, dbPath, excludeFolders, chunking, search                   | ✅ Done | `backend-config.ts`                         |
| 3. Factory wiring    | `getObsidianManager()` routes to `ObsidianMemoryProvider`, wrapped in `FallbackMemoryManager`                      | ✅ Done | `search-manager.ts`                         |
| 4. Lifecycle hooks   | `"memory"` added to `InternalHookEventType`, `triggerInternalHook("memory", "sync-complete")` fires after indexing | ✅ Done | `obsidian-provider.ts`, `internal-hooks.ts` |

**Tests:**

- `backend-config.test.ts` — obsidian resolution with defaults
- `search-manager.test.ts` — factory returns ObsidianMemoryProvider, fallback to builtin on error
- `obsidian-search.test.ts` — RRF fusion, vector/keyword dedup
- `obsidian-sync.test.ts` — chunk overlap, line tracking

---

## 1. Problem Statement

OpenClaw's memory system stores agent context in flat Markdown files (`MEMORY.md`, `memory/YYYY-MM-DD.md`) indexed into a per-agent SQLite database with sqlite-vec. This works, but has significant limitations for power users who already maintain a structured knowledge base:

1. **Memory is siloed.** Agent memory lives in `~/.openclaw/workspace/memory/` — separate from the user's actual knowledge base. The agent can't search years of notes, journal entries, or project documentation unless explicitly told to invoke a skill.
2. **Memory is not human-friendly.** The `memory/YYYY-MM-DD.md` files are append-only logs with no structure, frontmatter, tagging, or filing. They're not useful outside of OpenClaw.
3. **Memory is not backed up natively.** SQLite databases and flat memory files depend on the user's backup strategy. Users with Obsidian Sync (or similar) already have encrypted, versioned, cloud-synced note storage.
4. **Semantic search is fragmented.** Users like Jesten have built custom RAG skills (`local-rag`) that duplicate much of what the built-in memory system already does, but over a different corpus (Obsidian vault). The agent has to decide which to search — and often doesn't search the vault at all unless prompted.

### The Vision

A user sets `provider: "obsidian"` in their `memorySearch` config, points it at their vault, and:

- **Every agent turn** automatically semantic-searches the entire vault (not just `memory/`)
- **Memory flushes** write properly structured Obsidian notes with frontmatter, tags, and PARA filing
- **The SQLite index** is maintained as a search accelerator, but the vault is the source of truth
- **Existing Obsidian Sync/backup** provides "free" encrypted cloud memory

---

## 2. Architecture Overview

### Current OpenClaw Memory Pipeline

```
Agent turn → memorySearch.enabled? → MemoryIndexManager.search(query)
  → syncMemoryFiles() [indexes MEMORY.md + memory/*.md + extraPaths]
  → Embed query via provider (openai/gemini/voyage/local/auto)
  → Hybrid search: sqlite-vec (vector) + FTS5 (keyword)
  → mergeHybridResults() → top-K results injected into context
```

### Proposed Obsidian Provider Pipeline

```
Agent turn → memorySearch.provider === "obsidian"?
  → ObsidianMemoryProvider.search(query)
    → syncVaultFiles() [indexes ENTIRE vault, respecting .gitignore/.obsidianignore]
    → Embed query via configured embedding provider
    → Hybrid search: sqlite-vec (vector) + FTS5 (keyword, with PARA-aware weighting)
    → mergeHybridResults() → top-K results injected into context

Memory flush → obsidian-scribe integration
  → Proper frontmatter, tags, PARA filing
  → Fallback: also write to memory/YYYY-MM-DD.md if preserveLocal=true
```

### Config Design

```json
{
  "agents": {
    "defaults": {
      "memorySearch": {
        "enabled": true,
        "provider": "obsidian",
        "obsidian": {
          "vaultPath": "/path/to/obsidian/vault",
          "preserveLocal": true,
          "targetFolder": "2-Areas/AgentName",
          "excludeFolders": [".obsidian", ".trash", "4-Archive"],
          "flushTags": ["agent/memory", "auto-generated"],
          "embedding": {
            "provider": "ollama",
            "model": "nomic-embed-text",
            "dimensions": 768
          }
        }
      }
    }
  }
}
```

The `embedding` sub-key allows the Obsidian provider to use a different embedding model than the default memory system (e.g., a local model for privacy, vs. OpenAI for quality).

---

## 3. Technical Comparison: OpenClaw Native vs. local-rag

### 3.1 Embedding Systems

| Aspect               | OpenClaw Native                               | local-rag (Custom)                         |
| -------------------- | --------------------------------------------- | ------------------------------------------ |
| **Provider**         | openai/gemini/voyage/local/auto               | Ollama only                                |
| **Default model**    | `text-embedding-3-small` (OpenAI)             | `nomic-embed-text` (Ollama)                |
| **Dimensions**       | Dynamic (provider-dependent)                  | 768 (fixed)                                |
| **Query prefix**     | None (raw text)                               | `"search_query: "` / `"search_document: "` |
| **Batch processing** | File-upload batching (OpenAI/Voyage)          | Concurrent HTTP requests (5 parallel)      |
| **Caching**          | `embedding_cache` table (provider+model+hash) | None (re-embeds on index)                  |
| **Fallback chain**   | Auto → OpenAI → Gemini → local → none         | Ollama or bust                             |
| **Cost**             | $$$ (API calls for cloud providers)           | Free (local Ollama)                        |
| **Privacy**          | Data sent to cloud APIs                       | Fully local                                |

**Analysis:**

- OpenClaw's embedding cache is a genuine improvement — prevents re-embedding unchanged chunks. local-rag re-embeds everything on full reindex.
- nomic-embed-text with query/document prefixes is specifically designed for asymmetric retrieval and performs well at 768d. OpenClaw's `text-embedding-3-small` is 1536d and slightly higher quality, but requires API calls.
- **Recommendation for Obsidian provider:** Support both. Default to local Ollama (nomic-embed-text) for privacy, with option to use OpenClaw's provider resolution for higher quality. **Port the embedding cache from OpenClaw's native system** — it's strictly better than re-embedding.

### 3.2 Chunking Strategy

| Aspect                | OpenClaw Native                 | local-rag                            |
| --------------------- | ------------------------------- | ------------------------------------ |
| **Chunk size**        | 400 tokens (1600 chars)         | 800 tokens (configurable)            |
| **Overlap**           | 80 tokens (320 chars)           | 0 (no overlap)                       |
| **Method**            | Line-by-line accumulation       | Paragraph-aware (`\n\n+` split)      |
| **Heading awareness** | Via line counting               | Via metadata prefix injection        |
| **Overflow handling** | Carry-over overlap lines        | Sentence-boundary fallback           |
| **Hash tracking**     | Per-chunk hash (skip unchanged) | Per-file mtime (reindex entire file) |

**Analysis:**

- OpenClaw's 80-token overlap prevents context loss at chunk boundaries — this is important for retrieval quality. local-rag's 0 overlap means a relevant passage split across two paragraphs might not match either chunk well.
- local-rag's paragraph-aware splitting is semantically cleaner — paragraphs are natural thought units. OpenClaw's line-by-line accumulation can split mid-paragraph.
- local-rag's metadata prefix injection (prepending title/tags/aliases to each chunk before embedding) is a **significant advantage** for retrieval — it biases the embedding toward the document's identity, not just the chunk content.
- OpenClaw's per-chunk hash tracking is more efficient for incremental updates.
- **Recommendation:** Combine both approaches:
  - Use paragraph-aware splitting (from local-rag) with configurable overlap (from OpenClaw)
  - Keep metadata prefix injection (local-rag's advantage)
  - Use per-chunk hash tracking (OpenClaw's advantage)
  - Default: 600 tokens, 60 token overlap (compromise between the two)

### 3.3 Search Algorithm

| Aspect                   | OpenClaw Native                     | local-rag                                      |
| ------------------------ | ----------------------------------- | ---------------------------------------------- |
| **Fusion method**        | Weighted linear combination         | Reciprocal Rank Fusion (RRF)                   |
| **Formula**              | `score = 0.7*vec + 0.3*text`        | `score = 1/(k+rank_vec) + 1/(k+rank_fts)`      |
| **Vector weight**        | 0.70                                | N/A (rank-based, not score-based)              |
| **Keyword weight**       | 0.30                                | N/A                                            |
| **RRF k parameter**      | N/A                                 | 60                                             |
| **Min score threshold**  | 0.35                                | None (returns top-K)                           |
| **Max results**          | 6                                   | 20 (top_k)                                     |
| **Candidate multiplier** | 4× (fetch 24 candidates → return 6) | 50 per source                                  |
| **FTS5 weights**         | Uniform (text only)                 | Per-field (filename:10, title:8, tags:5, etc.) |
| **Entity shortcut**      | No                                  | Yes (exact filename/alias → direct return)     |
| **Metadata boost**       | No                                  | Yes (filename/alias boost capped at 0.6)       |

**Analysis — This is the most important comparison:**

**Weighted Linear Combination (OpenClaw):**

- Pros: Simple, predictable, tunable weights
- Cons: Requires score normalization across different scales. Vector cosine similarity [0,1] and BM25 scores (negative, unbounded) are not directly comparable without normalization. OpenClaw uses `bm25RankToScore(rank) = 1/(1+rank)` to normalize, which loses BM25's magnitude information.

**Reciprocal Rank Fusion (local-rag):**

- Pros: Rank-based — immune to score scale differences. Well-studied in IR literature. Robust when one ranker fails (missing results get rank 999).
- Cons: Loses absolute score magnitude. A very strong vector match and a weak vector match at the same rank get the same RRF contribution.

**Per-field FTS5 weighting (local-rag only):**
This is a clear win. Boosting filename (10×) and title (8×) matches over raw content (1×) dramatically improves precision for navigational queries ("find my note about solar panels"). OpenClaw's FTS5 table only indexes `text` — no field weighting at all.

**Entity shortcut (local-rag only):**
Another clear win. When a user asks "what's in my Broadcom note?", exact filename/alias matching returns instantly without embedding computation.

**Recommendation:**

- Use RRF (from local-rag) as the default fusion method — it's more robust
- Port per-field FTS5 weighting — this is a genuine improvement
- Port entity shortcut — reduces latency for navigational queries
- Add OpenClaw's min-score threshold (0.35) and candidate multiplier (4×) as configurable guardrails
- Keep max results low (6-8) for context window efficiency

### 3.4 SQLite Schema Comparison

| Table        | OpenClaw                                                                         | local-rag                                                                                      |
| ------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **chunks**   | id, path, source, start_line, end_line, hash, model, text, embedding, updated_at | id (rowid), file_path, chunk_index, content                                                    |
| **vectors**  | `chunks_vec` (sqlite-vec virtual table, dynamic dims)                            | `vec_chunks` (sqlite-vec, float[768])                                                          |
| **FTS**      | `chunks_fts` (text only)                                                         | `search_fts` (file_path, filename, title, tags, aliases, para_area, headers, summary, content) |
| **files**    | path, source, hash, mtime, size                                                  | file_path, filename, title, tags, aliases, headers, para_category, para_area, summary, mtime   |
| **metadata** | `meta` (key/value for config tracking)                                           | (none)                                                                                         |
| **cache**    | `embedding_cache` (provider, model, hash → embedding)                            | (none)                                                                                         |

**Analysis:**

- local-rag's rich `file_metadata` + multi-field FTS5 is strictly superior for Obsidian content where files have frontmatter, tags, aliases, and PARA structure.
- OpenClaw's `embedding_cache` and `meta` tables are infrastructure wins worth porting.
- OpenClaw stores embeddings inline in the `chunks` table AND in `chunks_vec`. This is redundant but allows cache-based skip logic.

**Recommendation for Obsidian provider schema:**

- Merge: Use local-rag's rich FTS5 schema + OpenClaw's embedding cache + meta tracking
- Add `para_category` and `para_area` as first-class FTS5 fields (unique to Obsidian/PARA users)

---

## 4. SQLite Memory Files vs. Obsidian Notes

| Aspect                  | SQLite + memory/\*.md (Current) | Obsidian Vault (Proposed)                      |
| ----------------------- | ------------------------------- | ---------------------------------------------- |
| **Human readable**      | Barely — append-only logs       | Yes — structured notes with frontmatter        |
| **Searchable by human** | grep only                       | Obsidian search, graph view, backlinks         |
| **Backed up**           | User's responsibility           | Obsidian Sync (encrypted, versioned, cloud)    |
| **Encrypted at rest**   | No (plain SQLite + MD)          | Yes (Obsidian Sync uses E2EE)                  |
| **Version history**     | None                            | Obsidian Sync keeps file history               |
| **Cross-device**        | No                              | Yes (Obsidian Sync)                            |
| **Tagging/linking**     | None                            | Full Obsidian tag + wikilink support           |
| **Structure**           | Flat date-based files           | PARA method (Projects/Areas/Resources/Archive) |
| **Agent writes**        | Raw `fs.writeFile`              | Via obsidian-scribe (linted, validated)        |
| **Recovery**            | Hope you have backups           | Pull from any synced device                    |

**The key insight:** Using Obsidian as the memory backend gives you "native, human-readable, agent memory in the cloud" — for free if you already use Obsidian Sync. The agent's memories become part of your knowledge graph, searchable from any device, backed up automatically, and encrypted at rest.

**Risk mitigation:**

- `preserveLocal: true` ensures memory/YYYY-MM-DD.md is still written as a fallback
- SQLite index is ephemeral — it can be rebuilt from the vault at any time
- The vault is the source of truth; the index is an accelerator

---

## 5. Implementation Plan

### Phase 1: Obsidian Memory Provider (Core) — ✅ COMPLETE

**Files created/modified in `~/openclaw-fork/src/memory/`:**

1. **`obsidian-provider.ts`** ✅ — ObsidianMemoryProvider class
   - Implements `MemorySearchManager` interface
   - Vault path discovery and validation
   - Background indexing (FTS5 instant, vectors async)
   - `triggerInternalHook("memory", "sync-complete")` fires after indexing with stats

2. **`obsidian-schema.ts`** ✅ — Extended SQLite schema
   - Rich FTS5 table with per-field weighting (filename:10, title:8, tags:5, content:1)
   - Embedding cache table (reusable by content hash)
   - File metadata table with PARA fields (para_category, para_area)
   - Graceful degradation if sqlite-vec unavailable

3. **`obsidian-sync.ts`** ✅ — Vault sync logic
   - Incremental indexing via mtime + hash
   - Exclude `.obsidian/`, `.trash/`, configurable folders
   - Frontmatter parsing for tags, aliases, PARA category
   - Paragraph-aware chunking with configurable overlap

4. **`obsidian-search.ts`** ✅ — Hybrid search with RRF
   - Reciprocal Rank Fusion (k=60)
   - Per-field FTS5 weighting
   - Entity shortcut (exact filename/alias match)
   - FTS5-only fallback during background embedding

5. **`obsidian-flush.ts`** — NOT YET IMPLEMENTED
   - Memory flush to vault via obsidian-scribe integration
   - Proper frontmatter generation, PARA filing
   - _Deferred: not required for read-only search provider (issue #6 scope)_

6. **Config & factory wiring** ✅
   - `MemoryBackend = "builtin" | "qmd" | "obsidian"` in `types.memory.ts`
   - `MemoryObsidianConfig` type with vaultPath, dbPath, excludeFolders, chunking, search
   - `resolveObsidianBackend()` in `backend-config.ts` with defaults
   - `getObsidianManager()` in `search-manager.ts` with `FallbackMemoryManager` wrapping
   - `"memory"` added to `InternalHookEventType` in `internal-hooks.ts`

---

### Future Work (Separate Issues)

#### Skills Improvements

**`skills/obsidian-scribe`:**

- Extract frontmatter parsing into a shared library (used by both the skill and the provider)
- Add a `lint --check` mode that validates without writing (for provider's import validation)
- Ensure `append.js` supports receiving content via stdin (not just CLI args) for large flushes

**`skills/local-rag`:**

- Extract the RRF algorithm, FTS5 schema, and entity shortcut into a shared `search-utils.js` module
- The Obsidian provider can import these directly or port them to TypeScript
- Consider deprecating local-rag's standalone index in favor of the native provider's index

#### Watcher Fix (Upstream PR)

**`src/agents/skills/refresh.ts`:**

- The source already has `DEFAULT_SKILLS_WATCH_IGNORED` with `node_modules` — investigate why EMFILE still occurs on v2026.2.9
- Likely cause: chokidar glob expansion before filtering, or version-specific bug
- Test fix: add `usePolling: false, depth: 2` to chokidar options to limit recursion
- Submit as upstream PR to openclaw/openclaw

---

## 6. Embedding Provider Decision Matrix

**Key decision:** The Obsidian provider MUST use OpenClaw's native `node-llama-cpp` embedding infrastructure, NOT Ollama. OpenClaw already ships `node-llama-cpp` with a default GGUF model (`embeddinggemma-300m-qat-q8_0`, 300M params, auto-downloaded from HuggingFace). This runs natively on Apple Silicon (Metal), CUDA, and CPU with zero external dependencies.

Our `local-rag` uses Ollama + `nomic-embed-text` (768d) — this requires a separate Ollama install and model pull, which is a non-starter for a provider that ships inside OpenClaw. Users expect `npm i -g openclaw` to just work.

| Criterion          | node-llama-cpp (Ship with OpenClaw) | Ollama/nomic-embed-text (local-rag)     | OpenAI/text-embedding-3-small |
| ------------------ | ----------------------------------- | --------------------------------------- | ----------------------------- |
| **Setup**          | ✅ Zero — auto-downloads model      | ❌ Requires Ollama install + model pull | ❌ Requires API key           |
| **Privacy**        | ✅ Fully local                      | ✅ Fully local                          | ❌ Data sent to cloud         |
| **Cost**           | ✅ Free                             | ✅ Free                                 | ❌ ~$0.02/1M tokens           |
| **Mac M2-M4**      | ✅ Metal acceleration               | ✅ Metal via Ollama                     | N/A                           |
| **Quality**        | Good (300M model)                   | Better (768d nomic)                     | Best (1536d)                  |
| **Query prefixes** | ❌ Symmetric                        | ✅ Asymmetric retrieval                 | ❌ Symmetric                  |
| **Override**       | Users can set custom GGUF path      | N/A                                     | Via provider config           |

**Default:** `node-llama-cpp` with `embeddinggemma-300m-qat`. Users wanting higher quality can point `memorySearch.obsidian.embedding.model` to a GGUF path (e.g., `nomic-embed-text` GGUF) or use the OpenClaw provider fallback chain (local → OpenAI → Gemini).

---

## 7. Open Questions

1. ~~**Vault size limits?**~~ Answered: See §7.4. Fine up to 10k files, needs chunked indexing for 50k+.
2. **Multi-vault support?** Some users have work + personal vaults. Should the provider accept an array of vault paths?
3. **Obsidian plugin integration?** Could we ship a companion Obsidian plugin that exposes a local API for file operations, avoiding direct filesystem access?
4. **Conflict resolution:** If the agent writes to the vault AND the user edits the same note, how do we handle? (Obsidian Sync handles this with file-level merge, but we should be aware.)
5. ~~**PARA detection:**~~ Auto-detect via `lib/para-detect.js` (see scribe code-overhaul PRD §7.2).

---

## 8. Dynamic Context Injection (Future Work — Separate Issue)

> **Scope note:** This section describes a future enhancement that modifies the agent turn pipeline. It is NOT part of issue #6 (factory wiring). File as a separate issue when ready to implement.

### 8.1 The Current Problem

OpenClaw injects `MEMORY.md` (~800-3000 tokens) into the system prompt on **every single API call**, whether relevant or not. Users stuff everything into MEMORY.md because the `memory_search` tool is perceived as unreliable (slow cold-start, limited to `memory/*.md`). This creates a vicious cycle:

```
MEMORY.md grows → context window fills faster → compaction triggers sooner
  → agent loses conversation history → user adds more to MEMORY.md
```

Meanwhile, the actual `memory_search` tool already supports chunk-level retrieval with `memory_get` (fetch specific line ranges). The infrastructure for granular injection exists — it's just not connected to the vault.

### 8.2 Proposed Architecture: Semantic Context Injection

Replace static MEMORY.md injection with **dynamic, query-aware context injection**:

```
User sends message
  → Extract query intent from message (lightweight, no LLM call — use keywords + last N messages)
  → Obsidian provider: search(query, { maxResults: 4, maxInjectedChars: 4000 })
  → Returns ranked chunks with path, line range, snippet
  → Inject as a <memory_context> block in the system prompt (replaces static MEMORY.md)

Agent sees:
  <memory_context source="obsidian" query="budget groceries">
    [2-Areas/Finance/Budget.md:15-22] Monthly grocery budget: $500...
    [2-Areas/Magnus/2026-02-14-session-memory.md:3-8] Discussed budget optimization...
    [MEMORY.md:12-15] User prefers Costco for bulk purchases...
  </memory_context>
```

**Key properties:**

- **Query-aware:** Only injects context relevant to the current conversation, not everything
- **Chunk-level:** Individual sections/paragraphs, not entire files. A 5000-word project note contributes only the 400-token chunk that matches.
- **Bounded:** `maxInjectedChars: 4000` (configurable) caps the context cost at ~1000 tokens, vs. MEMORY.md's unbounded growth
- **Source-attributed:** Agent sees where each snippet came from, can `memory_get` for more context if needed
- **Fallback:** If no vault results, injects a minimal "core identity" block (name, location, preferences — ~200 tokens) extracted from MEMORY.md's most stable entries

### 8.3 Query Intent Extraction (Zero-LLM)

Extracting query intent without an LLM call is critical for latency. Approach:

1. **Keyword extraction:** Take the user's last message, strip stop words, extract nouns/entities
2. **Conversation momentum:** Weight recent topics from the last 3-5 messages (simple TF-IDF over message history)
3. **Skill-aware boosting:** If the agent is about to invoke a skill (e.g., `obsidian-scribe`), inject context related to that skill's domain
4. **Explicit trigger:** Agent can call `memory_search` for deeper lookup, as it does now

This means the automatic injection is "good enough" context (keyword-based, fast), while the agent retains `memory_search` for precise semantic lookup when it needs it.

### 8.4 MEMORY.md Becomes a Pinned Context File

Instead of removing MEMORY.md entirely, redefine its role:

- **Before:** Dump of everything the agent might need to know (~3000+ tokens, growing)
- **After:** Small, curated "agent identity card" (~200-500 tokens, stable):

  ```markdown
  # Core Memory

  - User: Jesten, software engineer at GitHub, Whidbey Island WA
  - Timezone: America/Los_Angeles
  - Communication: Efficient, concise, token-frugal
  - Vault structure: PARA method
  - Key preferences: Conventional commits, systemd, interrupt-driven architecture
  ```

Everything else (project context, recent decisions, historical facts) comes from vault search. This shrinks static injection from ~800 tokens to ~150 tokens per turn.

### 8.5 Impact on Token Economics

| Metric                      | Current (static MEMORY.md)    | Proposed (dynamic injection)   |
| --------------------------- | ----------------------------- | ------------------------------ |
| Static context per turn     | ~800 tokens (growing)         | ~150 tokens (stable)           |
| Relevant context per turn   | ~200 tokens (if lucky)        | ~1000 tokens (query-matched)   |
| Irrelevant context per turn | ~600 tokens (waste)           | ~0 tokens                      |
| Compaction frequency        | Higher (context fills faster) | Lower (smaller base footprint) |
| Search latency              | N/A (pre-injected)            | ~30ms (FTS5 + vector)          |

**Net effect:** More relevant context, less waste, fewer compactions, longer conversations.

### 8.6 Semantic Context Pruning (Topic-Change Detection)

The same relevance scoring used for memory injection can detect when a conversation shifts topics — and prune stale context.

**How it works:**

OpenClaw's existing `contextPruning` (mode: `cache-ttl`) prunes by age — old tool results get trimmed or replaced with placeholders. This is blunt: it can drop recent relevant context while keeping old irrelevant context.

Semantic pruning adds a relevance dimension:

```
Each turn:
  1. Extract current topic vector from last 2-3 messages (same keyword extraction as §8.3)
  2. Score each injected <memory_context> chunk against current topic
  3. Score each conversation message against current topic (lightweight: reuse message text, no embedding needed — cosine against cached query vector)

  If topic drift detected (cosine similarity between current query and previous query < 0.3):
    → Drop stale memory_context chunks (they were relevant to the OLD topic)
    → Inject fresh chunks matching the NEW topic
    → Mark old tool results as prunable (existing hard-clear mechanism)
    → Log topic change: "Topic shift: budget → vacation planning"
```

**Integration with existing pruning:**

The current pruner works in stages:

1. **Soft trim:** Truncate large tool results (keep first/last N chars)
2. **Hard clear:** Replace tool results with `[pruned]` placeholder when ratio exceeds threshold

Semantic pruning adds a **Stage 0:**

- Before soft/hard trim, score all conversation messages against current topic
- Messages with low relevance to current topic get their pruning priority raised
- The existing ratio-based pruner then clears them first

**What this means practically:**

```
User: "What's my grocery budget?"
  → Agent searches vault, finds budget notes, discusses for 5 turns
  → Context: budget chunks + 5 turns of budget discussion

User: "Actually, help me plan my vacation to Japan"
  → Topic drift detected (budget ↔ vacation cosine < 0.3)
  → Budget memory chunks dropped from <memory_context>
  → Japan/travel chunks injected instead
  → Old budget tool results marked as high-priority prune targets
  → Agent has fresh, relevant context without manual /compact
```

**No LLM call needed** — topic detection uses the same embedding infrastructure that's already running for memory search. The query vector from the last search is cached; comparing it to the new query vector is a single cosine computation (~0.01ms).

**Config:**

```json
{
  "contextPruning": {
    "mode": "semantic",
    "topicDriftThreshold": 0.3,
    "keepRecentTurns": 3,
    "maxStaleChunks": 0
  }
}
```

### 8.7 Local-RAG Tuning Requirements

For dynamic injection to work well, the search quality must be high. Current local-rag needs:

1. **Chunk overlap** — Currently 0. Add 60-80 token overlap to prevent boundary-split relevance loss. (OpenClaw native uses 80.)
2. **Metadata prefix injection** — Already present (title/tags prepended to chunks before embedding). Verify this works well with the new embedding model (embeddinggemma vs nomic-embed-text).
3. **Result quality scoring** — Add a confidence signal to search results so the injector can skip low-quality matches rather than padding with noise.
4. **Index freshness** — Ensure the chokidar watcher re-indexes changed files within 2-3 seconds, so context from a note the user just edited appears on the next turn.
5. **Benchmark** — Run a test suite of 50 real queries against the vault, compare RRF results vs. linear combination, measure precision@3 and recall@5. Tune k parameter and field weights based on results.

---

## 9. Indexing Lifecycle & Agent Awareness — ✅ IMPLEMENTED

### 9.1 Background Indexing with Fallback

The Obsidian provider uses a progressive indexing strategy. This is now implemented in `obsidian-provider.ts`:

```
Gateway starts / provider configured
  → Phase 1: File scan + FTS5 indexing (instant, ~2s for 725 files)
    → Keyword search available immediately

  → Phase 2: Background embedding (async, ~36s for 725 chunks)
    → Provider state: indexing=true
    → search() returns: FTS5 keyword results only (graceful degradation)

  → Phase 3: Embedding complete
    → triggerInternalHook("memory", "sync-complete", sessionKey, {
        provider: "obsidian", vaultPath, files, modified, deleted, durationMs
      })
    → Provider state: indexing=false
    → search() returns: full hybrid (RRF vector + FTS5)
```

**Fallback:** If `ObsidianMemoryProvider` fails to initialize (missing vault, sqlite error, etc.), `FallbackMemoryManager` in `search-manager.ts` transparently falls back to the builtin `MemoryIndexManager`.

### 9.2 Agent Awareness (Future Work)

> **Not yet implemented.** These are enhancement ideas for after the core provider ships.

The agent could know its memory state via:

1. **System prompt annotation:** `<memory_status provider="obsidian" state="indexing" progress="150/725" />`
2. **Hook event on completion:** Fires `memory:sync-complete` → hook can push a message to the agent's session _(hook fires; delivery hook not yet written)_
3. **Interrupt-service integration:** POST to `localhost:7600` with the completion event, enabling proactive notification to the user

### 9.3 Explicit Index Command (Future Work)

For first-time setup or manual re-index:

```bash
openclaw memory index --provider obsidian
# Shows progress bar, blocks until complete
# Useful after initial vault connection or major reorganization
```

---

## 10. Follow-up Items

- [ ] Benchmark local-rag RRF vs OpenClaw linear combination on a real query set against the Obsidian vault
- [ ] Profile initial indexing time for a ~2000 note Obsidian vault with nomic-embed-text
- [ ] Test the custom `obsidian-memory` hook (deployed to `~/.openclaw/hooks/`) on next `/new` command
- [ ] Investigate the EMFILE watcher issue in the forked source — reproduce and fix
- [ ] Review OpenClaw's plugin system (`openclaw.extensions` in package.json) as an alternative to forking — could the Obsidian provider be an installable plugin?

---

## 11. References

| Resource              | URL                                                                 |
| --------------------- | ------------------------------------------------------------------- |
| OpenClaw source       | `~/openclaw-fork/` (Jherrild/openclaw)                              |
| Memory system source  | `~/openclaw-fork/src/memory/`                                       |
| Config resolution     | `~/openclaw-fork/src/agents/memory-search.ts`                       |
| local-rag skill       | `~/.openclaw/workspace/skills/local-rag/`                           |
| obsidian-scribe skill | `~/.openclaw/workspace/skills/obsidian-scribe/`                     |
| EMFILE bug            | https://github.com/openclaw/openclaw/issues/8851                    |
| Hook types            | `dist/plugin-sdk/hooks/types.d.ts` + `internal-hooks.d.ts`          |
| Memory docs           | https://docs.openclaw.ai/concepts/memory                            |
| Plugin creation       | https://deepwiki.com/openclaw/openclaw/10.3-creating-custom-plugins |
