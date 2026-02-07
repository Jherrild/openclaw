# PRD: Local RAG Refactor - Hybrid Search & Metadata Weighting

## 1. Executive Summary
The current `local-rag` tool relies entirely on raw semantic embeddings (vector search). While good for concepts, it fails on specific entity lookups (e.g., searching for "April Jane" failed to retrieve `April Jane.md`). 

We need to refactor the **indexing** and **searching** logic to produce a robust, "Hybrid" search system that balances **Semantic Meaning** with **Exact Keyword/Metadata Matching**.

The goal is a tool that allows for quick, accurate retrieval of Obsidian notes, whether the user queries a vague concept ("home projects") or a specific entity ("April Jane").

## 2. Data Structure (Obsidian Notes)
The system must understand the anatomy of a user's Obsidian note to index it correctly.

### Example Note (`2-Areas/People/April Jane.md`)
```markdown
---
tags: [people, friend, design]
aliases: [AJ, April]
date: 2024-05-20
---
# April Jane

## Contact
- Phone: 555-0199
- Email: april@example.com

## Notes
Met at the design conference. She specializes in brutalist web design.
```

### Key Components to Index
1.  **Filename:** `April Jane.md` (High weight).
2.  **Frontmatter:** YAML block at the top.
    *   `tags`: `#people`, `#friend` (High weight).
    *   `aliases`: `AJ`, `April` (Critical for entity resolution).
3.  **Headers:** `# April Jane`, `## Contact` (Medium weight).
4.  **Content:** The body text (Standard weight).

## 3. Core Goals

### 3.1. Smarter Indexing (`index`)
The `index` command must do more than just chunk text. It needs to "understand" the note structure.
*   **Metadata Extraction:** Parse YAML frontmatter.
*   **Weighted Chunks:** When creating embeddings or search indices, ensure that **Titles**, **Aliases**, and **Tags** are either:
    *   Embedded separately with higher importance.
    *   Prepend to *every* chunk from that file (e.g., `[Title: April Jane] [Tags: people] ... chunk content ...`).
    *   Stored in a parallel Keyword/BM25 index (if the architect deems necessary).
*   **Optimization:** The LLM (Claude) should decide the best technical approach (e.g., prefixes, hybrid BM25+Vector, or metadata filtering), but the *outcome* must be that "April Jane" hits the file `April Jane.md` instantly.

### 3.2. Accurate Searching (`search`)
The `search` command must retrieve the right files based on the improved index.
*   **Entity Resolution:** If the query matches a filename or alias exactly, that result should skyrocket to the top.
*   **Concept Search:** Queries like "design friends" should still work via semantic vectors.
*   **Output:** Return clear, relevant snippets.

## 4. Technical Constraints & Implementation Guide
*   **Language:** Node.js.
*   **Storage:** SQLite (existing `db.js`). Schema updates are permitted.
*   **Models:** Continue using Ollama (`nomic-embed-text` or similar) for vectors.
*   **Algorithm:** The implementation detail is up to the engineer (Claude), but it must solve the "Specific Name" problem without breaking the "Vague Concept" search.
*   **Self-Contained:** All logic for weighting/prefixing must happen inside `rag.js` and `embeddings.js`. The user just runs `node rag.js index`.

## 5. Success Metrics
1.  **Exact Match:** Query "April Jane" -> Returns `April Jane.md` as #1.
2.  **Alias Match:** Query "AJ" -> Returns `April Jane.md`.
3.  **Concept Match:** Query "people who do design" -> Returns `April Jane.md` (due to content/tags).
