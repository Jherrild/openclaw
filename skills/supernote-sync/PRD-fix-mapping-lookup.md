# PRD - Fix Supernote Sync ID Lookup

## Problem
The `supernote-sync` script (`check-and-sync.sh`) incorrectly identifies existing files as "new" on every run. 

### Technical Root Cause
The script uses `jq` to look for existing entries inside a `.files[]` array:
```bash
LOCAL_ENTRY=$(jq -r --arg id "$FILE_ID" '.files[] | select(.fileId == $id)' "$MAPPING_FILE" ...)
```
However, the actual `sync-mapping.json` structure stores file IDs as top-level keys rather than objects inside a `files` array:
```json
{
  "files": [],
  "1xyj92mjwGo...": { "localPath": "...", "modifiedTime": "..." }
}
```

## Requirements
1.  Update `check-and-sync.sh` to correctly check for the existence of a file ID as a top-level key in `sync-mapping.json`.
2.  Update the logic that writes to `sync-mapping.json` for new or updated files to maintain this flat key-value structure.
3.  Ensure the `lastModified` check still works correctly with the flat structure.

## Target Files
- `/home/jherrild/.openclaw/workspace/skills/supernote-sync/check-and-sync.sh`
- `/home/jherrild/.openclaw/workspace/skills/supernote-sync/sync-mapping.json` (reference structure)