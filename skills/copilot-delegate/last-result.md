# Phase 2: obsidian-scribe auto-index hooks

Added fire-and-forget `local-rag` index hooks to all four obsidian-scribe tools (`write.js`, `append.js`, `move.js`, `archive.js`). Each file now imports `spawn` from `child_process` and spawns a detached background process (`node rag.js index <filepath>`) after successful file operations, ensuring the RAG index stays current without blocking the main process. All four files parse and execute correctly with no syntax errors.
