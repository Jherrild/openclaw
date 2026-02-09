# Result: Supernote Sync — Absolute Paths & Manifest Parsing Fix

**Status:** ✅ Complete

Refactored `check-and-sync.sh` to ensure all internal paths (SKILL_DIR, MAPPING_FILE, LOG_FILE, BUFFER_DIR, .agent-pending, .new-files-buffer, etc.) are absolute, derived from the script's own location via `readlink -f`. Replaced the `build_manifest_array` bash function (which passed pipe-delimited entries through positional parameters, causing word-splitting on filenames with spaces) with a `build_manifest_from_file` function that uses `jq -R -s` to parse buffer files directly — eliminating bash word-splitting entirely. Also added linuxbrew and npm-global to PATH for systemd compatibility, and fixed a dead reference to `$UPDATED_FILES_BUFFER` in the cleanup section. Verified via `orchestrator.js run supernote-sync`: "Test note for Magnus.note" is detected and correctly manifested as a single entry in `.agent-pending`.
