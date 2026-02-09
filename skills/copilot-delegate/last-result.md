# Result: Obsidian Scribe — Auto-update Supernote Sync Mapping

**Status:** ✅ Complete

Created `skills/obsidian-scribe/lib/sync-mapping.js` with helpers to load, query, and update `skills/supernote-sync/sync-mapping.json`. Updated `write.js` to accept an optional `--file-id` flag and auto-update the mapping when saving a note that matches a tracked Supernote file (by ID or filename). Updated `move.js` to auto-update the `localPath` in the mapping when a tracked note is moved. All mapping updates are best-effort — if the mapping file is missing or corrupt, the primary file operation still succeeds with a warning.
