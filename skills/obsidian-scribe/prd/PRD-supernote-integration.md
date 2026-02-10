# PRD: Obsidian Scribe - Supernote Mapping Integration

> **Status: Superseded.** The original JSON-based `sync-mapping.json` approach described here was replaced in the Stage 1–3 overhaul (see `supernote-sync/PRD-overhaul.md`). The mapping now lives as YAML in `<vault>/metadata/supernote-sync-mapping.md` and is managed by `supernote-sync/mapping-utils.js`. The scribe's `lib/sync-mapping.js` was rewritten to use this YAML mapping. The requirements below are preserved for historical reference.

## Goal
Update the `obsidian-scribe` skill tools to automatically maintain the Supernote sync mapping when new notes are added or moved. This ensures that once a Supernote note is filed into Obsidian, the sync script recognizes it as "known" and doesn't re-download it to the buffer.

## Requirements
1. **Mapping Awareness:** The `scribe_save` and `scribe_move` tools must be aware of the Supernote mapping file at `<vault>/metadata/supernote-sync-mapping.md`.
2. **Auto-Update on Save:** When `scribe_save` is used to create a note that originated from a Supernote (detected via filename or provided File ID), it should add an entry to the mapping.
3. **Auto-Update on Move:** When `scribe_move` moves an existing Supernote note, it must update the `mdPath` and `pdfPath` in the mapping file, and move linked documents.
4. **Robustness:** If the mapping file is missing or corrupted, the tool should log a warning but still complete the primary file operation.
5. **Deduplication:** Prevent duplicate entries in the mapping for the same File ID.

## Success Criteria
- Filing a new note from the Supernote buffer via `scribe_save` updates `sync-mapping.json`.
- Moving a note that is already in `sync-mapping.json` updates its `localPath`.
- Magnus no longer has to manually update the JSON file.
