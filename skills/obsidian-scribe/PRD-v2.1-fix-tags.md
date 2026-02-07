# PRD: Obsidian Scribe v2.1 (Bug Fix: Tags Propagation)

## 1. Problem
The v2.0 refactor introduced `minimist` for argument parsing, allowing a `--tags` flag in `write.js` and `append.js`. However, these scripts invoke `lint.js` via `child_process.execSync` without forwarding the captured tags.

**Result:** Tags passed via CLI are dropped and never applied to the file's frontmatter.

## 2. Requirements

### 2.1 Update `write.js` and `append.js`
- **Capture:** Retrieve the `tags` argument from the parsed args (already using `minimist`).
- **Forward:** When constructing the command string to execute `lint.js`, append `--tags "..."` if tags were present.
- **Safety:** Ensure proper quoting of the tags string to prevent shell injection or breaking on spaces.

### 2.2 Verify `lint.js`
- Ensure `lint.js` accepts `--tags` (it was updated in v2.0, but verify it works as expected when receiving them).

## 3. Scope
- Modify `write.js`.
- Modify `append.js`.
- No changes needed to `lib/utils.js` or others unless necessary for quoting logic.
