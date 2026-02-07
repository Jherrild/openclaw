# PRD: Fix local-rag ChromaDB Integration

## Problem
The current `local-rag` skill fails because the `chromadb` Node.js bindings require `GLIBC_2.39`, which is not available in the current WSL environment.

## Goal
Refactor the `local-rag` skill to be more robust.

## Requirements
1.  **Server Management:** Instead of relying on `npx chroma run` (which has binary compatibility issues), provide a way to check if a ChromaDB server is reachable.
2.  **Architecture Change:** Switch from using the heavy `chromadb` Node.js client (which includes native bindings) to a lightweight HTTP-based interaction if possible, or ensure the environment can support the client.
3.  **Docker Option:** Since this is WSL, we should probably run ChromaDB in a Docker container to avoid GLIBC issues.
4.  **Update `rag.js`:**
    *   Add better error handling for connection issues.
    *   Verify `Ollama` connectivity for embeddings.
    *   Ensure it uses the correct `COLLECTION_NAME` and `VAULT_PATH`.

## Success Criteria
- `node skills/local-rag/rag.js search "test"` executes without GLIBC errors.
- Resulting search returns relevant snippets from the Obsidian vault.
