# PRD: Local-RAG OpenClaw Skill

## Overview
A fast, efficient, local semantic search and RAG utility for OpenClaw. It indexes directories of files (primarily Markdown) using Ollama embeddings and provides a CLI for searching those files.

## Core Requirements
- **Framework:** Must be structured as an OpenClaw "skill" (contained in its own directory with a `SKILL.md`).
- **Engine:** Use `nomic-embed-text` via Ollama for vector generation.
- **Storage:** Use **SQLite** (with `sqlite-vss` or a similar vector extension if possible, or flat vector storage) to store embeddings.
- **Performance:** Must be "hot" or fast enough to feel stateless. If a daemon is needed, it should auto-start on the first request.
- **Multi-Tenant:** Support indexing multiple distinct directories, each with its own SQLite store.
- **Configurable:** A `config.json` should specify the embedding model and the chat model (default: `gemma-2b`) for optional RAG synthesis.
- **Environment:** Runs on Linux (WSL2), 3080 10GB VRAM, Ollama daemon already running at `localhost:11434`.

## Functional Requirements
1. **Index Command:** Scans a directory, chunks files, generates embeddings, and saves to a specific SQLite database.
2. **Search Command:** Embeds a query and returns the top N most relevant file paths and snippets.
3. **Query/RAG Command:** (Optional) Feeds the search results into a local chat model (Gemma-2b) to answer a question.

## Deployment for Copilot
1. **Stage 1: Design & Validation.** 
   - Update this PRD with specific Implementation Stages and Expected Outcomes.
   - If this work is redundant (i.e., a simple, configurable OpenClaw/Node-based solution already exists for this exact stack), document that and stop.
2. **Stage 2: Implementation.**
   - Generate all necessary scripts (e.g., `index.js`, `search.js`, `db.js`, `config.json`).
   - Create a `SKILL.md` explaining how the Main Agent should use this skill.
3. **Stage 3: Documentation.**
   - Document any required dependencies (npm installs, etc.).

## Constraints for Copilot
- **No Questions:** Only attempt the implementation if you have 100% clarity. If you have questions, document them in this PRD under a "Pending Questions" section and notify the user that more information is needed.
- **Lean:** Avoid heavy frameworks like LangChain or Dockerized databases (ChromaDB). Stick to SQLite and pure Node.js.

---

## Implementation Stages (Added by Copilot)

### Stage 1: Design & Validation ✓
- **Redundancy Check:** Found `local-rag-BAK/` which uses ChromaDB + Docker. The current PRD explicitly requires SQLite to avoid Docker/GLIBC issues. This is a new implementation, not redundant.
- **Technical Approach:** 
  - Use `better-sqlite3` for SQLite (fast, synchronous, no native GLIBC issues)
  - Store embeddings as JSON-serialized arrays (SQLite doesn't have native vector support without extensions)
  - Implement cosine similarity in JS for search (fast enough for <100k docs)
  - One SQLite file per indexed directory (multi-tenant)

### Stage 2: Implementation
Files to create:
1. `config.json` - Default configuration
2. `db.js` - SQLite database operations
3. `embeddings.js` - Ollama embedding generation
4. `rag.js` - Main CLI with index/search/query commands
5. `package.json` - Dependencies
6. `SKILL.md` - Usage documentation for agents

### Stage 3: Expected Outcomes
- `node rag.js index /path/to/dir` - Indexes directory, creates `~/.local-rag/<hash>.db`
- `node rag.js search "query" /path/to/dir` - Returns top 5 relevant snippets
- `node rag.js query "question" /path/to/dir` - (Optional) RAG synthesis with Gemma-2b
- Sub-100ms search latency for indexed content
