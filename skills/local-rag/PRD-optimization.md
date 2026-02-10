# PRD: Local RAG Optimization (Incremental & Batching)

## Problem
The current `local-rag` skill takes ~90 seconds to index a small vault (678 files), which is too slow for interactive use. It re-embeds every file on every run, wasting GPU resources and time. Additionally, `obsidian-scribe` updates to the vault are not automatically reflected in the index, leading to stale search results.

## Goals
1.  **Speed:** Reduce incremental indexing time to <5 seconds for typical updates.
2.  **Efficiency:** Only re-embed files that have changed since the last index.
3.  **Throughput:** Use batch processing to saturate the GPU (RTX 3080) during full re-indexes.
4.  **Integration:** Automatically trigger a targeted re-index after `obsidian-scribe` modifies files.

## Technical Requirements

### 1. Incremental Indexing
- **Mechanism:** Store a persistent map of `filepath -> mtime` (e.g., in SQLite or a JSON file).
- **Logic:**
    - On `index <dir>`:
        1.  Scan all files in `<dir>`.
        2.  Compare current `mtime` vs stored `mtime`.
        3.  Filter list to only:
            -   **New** files (not in DB).
            -   **Modified** files (`current_mtime > stored_mtime`).
            -   **Deleted** files (in DB but not on disk -> remove from DB).
        4.  Process only the filtered list.

### 2. Batch Processing
- **Current:** Serial execution (Read -> Embed -> Write -> Repeat).
- **New:** Parallel execution with concurrency limit.
    -   Read files in parallel.
    -   Send embedding requests to Ollama in parallel batches (e.g., concurrency=5).
    -   Write to SQLite in a single transaction at the end of the batch.
-   **Config:** Add `concurrency` setting to `config.json` (default: 5).

### 3. Integration with `obsidian-scribe`
- **Trigger:** Modify `obsidian-scribe` tools (`scribe_save`, `scribe_append`, `scribe_move`) to call `rag.js index <file>` after successful file operations.
-   **Targeted:** The index command should accept a specific file path argument to index *just that file* immediately, without scanning the whole vault.

## Implementation Plan

### Phase 1: `local-rag` Optimization
1.  Modify `rag.js` to implement `mtime` tracking in the SQLite database (add `mtime` column to `files` table if needed, or create a new table).
2.  Implement the "diff" logic (New/Modified/Deleted).
3.  Refactor the embedding loop to use `Promise.all` with a concurrency limit (e.g., `p-limit` or simple chunking).
4.  Add support for `node rag.js index <specific_file>` to skip the full scan.

### Phase 2: `obsidian-scribe` Hooks
1.  Update `skills/obsidian-scribe/write.js`, `append.js`, `move.js`, and `archive.js`.
2.  After file system operations complete, spawn `node skills/local-rag/rag.js index <filepath>` in the background (detached process) or await it if fast enough (<1s).

## Verification
-   **Full Index:** Run `index` on full vault -> measure time (Expect <20s).
-   **No-Op Index:** Run `index` again immediately -> measure time (Expect <1s).
-   **Modify File:** Edit a file, run `index` -> verify only that file is processed.
-   **Scribe Integration:** Use `scribe_save` to create a note, then immediately `rag.js search` for it -> verify it appears in results.
