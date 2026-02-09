# Result: Add reset command to local-rag

Added a `reset` command to `skills/local-rag/rag.js` that locates the SQLite database for a given directory via `getDbPath()`, deletes it with `fs.unlinkSync`, and logs the deletion. The command handles the case where no index exists gracefully, and the help text was updated to document the new `reset` subcommand. Syntax check passed with no issues.
