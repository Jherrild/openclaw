---
name: local-rag
description: Hybrid semantic + keyword search across Obsidian vault and workspace using local SQLite vector DB and Ollama embeddings.
---

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

## Indexing Behavior
The `index` command **recursively crawls all files** under the specified target directory, including subdirectories at any depth. It does not filter by file type beyond what the chunker supports (primarily `.md` files). This means:
- If pointed at the Obsidian vault, it indexes every markdown file in the vault.
- If pointed at the OpenClaw workspace root (`/home/jherrild/.openclaw/workspace`), it will index skill docs, memory files, PRDs, and anything else under that tree.
- **Symlinks:** If the target directory contains symlinks to other directories, those linked paths will also be traversed and indexed. This can cause files outside the nominal target to appear in search results.

Be aware of what lives under your target directory before indexing — the tool indexes everything it finds.

## Use Cases

### 1. Obsidian Vault Search (Primary)
Point at the vault to search notes, areas, projects, and resources:
```bash
node rag.js index /mnt/c/Users/Jherr/Documents/remote-personal
node rag.js search "quarterly goals" /mnt/c/Users/Jherr/Documents/remote-personal
```

### 2. OpenClaw Workspace Search
Index the workspace root to make all internal documentation searchable — skill docs, memory logs, PRDs, and config files:
```bash
node rag.js index /home/jherrild/.openclaw/workspace
node rag.js search "how does copilot-delegate work" /home/jherrild/.openclaw/workspace
```
This is useful when you need to:
- Find which skill handles a specific capability.
- Search across memory files for past decisions or context.
- Locate PRD details or implementation notes scattered across skill directories.

### 3. Targeted Skill Documentation Search
Index only the `skills/` subtree for focused results on tool usage:
```bash
node rag.js index /home/jherrild/.openclaw/workspace/skills
node rag.js search "voice synthesis" /home/jherrild/.openclaw/workspace/skills
```

### Suggested Workflow: Internal Skill Discovery
1. **Index once** (re-index periodically or after adding new skills):
   ```bash
   node rag.js index /home/jherrild/.openclaw/workspace
   ```
2. **Search by concept** when you need to find the right skill or recall a documented behavior:
   ```bash
   node rag.js search "email sending" /home/jherrild/.openclaw/workspace
   ```
3. **Query for synthesized answers** when you want a direct answer from skill docs:
   ```bash
   node rag.js query "what tools can create Obsidian notes?" /home/jherrild/.openclaw/workspace
   ```
4. **Reset and re-index** if the workspace structure changes significantly:
   ```bash
   node rag.js reset /home/jherrild/.openclaw/workspace
   node rag.js index /home/jherrild/.openclaw/workspace
   ```

## Best Practices
- **Always Use for Research:** Use `search` or `query` alongside `grep` when researching concepts in the vault.
- **De-duplication:** Run a search before creating new notes to determine if you should update an existing note instead.
- **Hybrid Scoring:** Note that the tool uses hybrid scoring (vector + metadata boosts for filenames/frontmatter).
- **Scope Your Index:** Use the narrowest target directory that covers what you need — vault-wide for notes, workspace-wide for skill docs, or a specific subtree for focused results.

## Configuration
Model settings and chunk sizes are managed in `skills/local-rag/config.json`.
