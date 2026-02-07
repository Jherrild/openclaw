# SKILL.md - Local RAG (Obsidian Semantic Search)

## Description
Perform hybrid semantic + keyword searches across the Obsidian vault using a local SQLite vector database and Ollama embeddings.

## Usage
The tool is located at `/home/jherrild/.openclaw/workspace/skills/local-rag/rag.js`.

### Commands
- **Index:** `node rag.js index <directory>` (Crawl, chunk, and embed files)
- **Search:** `node rag.js search "<query>" <directory>` (Semantic + Keyword hybrid search)
- **Query:** `node rag.js query "<question>" <directory>` (RAG synthesis - search + LLM answer)
- **Check:** `node rag.js check` (Verify Ollama connectivity)

## Best Practices
- **Always Use for Research:** Use `search` or `query` alongside `grep` when researching concepts in the vault.
- **De-duplication:** Run a search before creating new notes to determine if you should update an existing note instead.
- **Hybrid Scoring:** Note that the tool uses hybrid scoring (vector + metadata boosts for filenames/frontmatter).

## Configuration
Model settings and chunk sizes are managed in `skills/local-rag/config.json`.
