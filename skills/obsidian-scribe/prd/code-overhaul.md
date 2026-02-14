# PRD: Obsidian Scribe — Code Interface Overhaul

> **Status:** Draft — 2026-02-14
> **Skill:** `skills/obsidian-scribe/`
> **Related:** `prd/PRD-obsidian-memory-provider.md` (in openclaw-fork), `prd/efficiency.md` (SKILL.md trimming)

---

## 1. Problem Statement

The current interface is a collection of independent scripts with inconsistent arg patterns:

```
node write.js <path> <content> [--tags]       # create
node append.js <path> <content> [--tags]      # append
node move.js <source> <target>                # move
node archive.js <path>                        # archive (→ 4-Archive/)
node lint.js <path> [--tags]                  # lint
node read_pdf.js <path>                       # extract text
```

**Issues:**
1. **Duplicated code** — content validation, linter invocation, dir creation, and error handling are copy-pasted across 4 scripts.
2. **No unified entry point** — Magnus must remember 6 different script names and arg patterns. The SKILL.md burns ~1.5k tokens documenting each one separately.
3. **No stdin support** — content must be passed via CLI arg, which is fragile for large/multiline content and breaks on shell special characters.
4. **No edit/insert capability** — Magnus can only create or append, not modify existing content.
5. **No approval workflow for edits** — editing someone's notes is destructive. Magnus should propose changes, not apply them silently.

## 2. Proposed Architecture

### 2.1 Unified CLI Entry Point

Replace 6 separate scripts with a single `scribe.js` dispatcher:

```
node scribe.js <command> [args...] [--flags]
```

**Commands:**

| Command | Args | Description |
|---------|------|-------------|
| `create` | `<path> [content]` | Create new note (was `write.js`) |
| `insert` | `<path> [content] [--at end\|--at "## Section"\|--at line:N]` | Insert content (subsumes `append.js`) |
| `edit` | `<path> --find <text> --replace <text>` | Propose edit with diff preview |
| `move` | `<source> <target>` | Move note + linked attachments |
| `archive` | `<path>` | Move to 4-Archive/ |
| `lint` | `<path> [--tags]` | Lint frontmatter + formatting |
| `read` | `<path>` | Extract text (PDF or MD) |

**Universal flags:**
- `--tags "tag1,tag2"` — add tags (applies to create/insert/edit)
- `--stdin` — read content from stdin instead of CLI arg
- `--dry-run` — show what would happen without writing
- `--json` — output result as JSON (for programmatic use)

### 2.2 Insert Command (DRY with Append)

`insert` replaces `append` and adds positional insertion:

```bash
# Append to end (default, same as old append.js)
node scribe.js insert "2-Areas/Finance/Budget.md" "New line item"

# Insert after a heading
node scribe.js insert "2-Areas/Finance/Budget.md" "New entry" --at "## February"

# Insert at a specific line number
node scribe.js insert "2-Areas/Finance/Budget.md" "New entry" --at line:42

# Append (explicit)
node scribe.js insert "2-Areas/Finance/Budget.md" "New entry" --at end
```

**Implementation:**
- `--at end` (default): Append to file. Same as current `append.js`.
- `--at "## Heading"`: Find the first line matching the heading, insert after it (before the next heading of same or higher level).
- `--at line:N`: Insert at line N (1-indexed).
- All modes run the linter after insertion.

### 2.3 Edit Command with Approval Workflow

This is the key design challenge. Edits to a user's notes should be **proposed, not applied**.

**Workflow:**

```
Magnus wants to update a note
  → node scribe.js edit "path" --find "old text" --replace "new text" --dry-run
  → Script outputs a human-readable diff
  → Magnus presents diff to user in chat
  → User approves (or modifies)
  → Magnus runs again without --dry-run to apply
```

**Diff output format (for chat display):**

```
📝 Proposed edit to: 2-Areas/Finance/Budget.md

  Line 15:
  - Monthly grocery budget: $400
  + Monthly grocery budget: $500

  Context (lines 13-17):
  13 | ## February Expenses
  14 |
  15 | Monthly grocery budget: $500    ← changed
  16 | Utilities: $150
  17 | Subscriptions: $85
```

**Implementation details:**

- `--find` accepts plain text or a regex (prefixed with `/pattern/`)
- `--replace` is the replacement text
- `--dry-run` (default for edit) outputs the diff without writing. Magnus must explicitly pass `--apply` to write.
- `--context N` controls how many surrounding lines to show (default: 2)
- Multi-line find/replace: use `--stdin` with a JSON payload:
  ```json
  {"find": "old text\nspanning lines", "replace": "new text\nspanning lines"}
  ```
- The diff output is designed to be copy-pasteable into Telegram/chat — uses simple `- / +` prefix, no ANSI colors.

**Safety:**
- Edits always require `--apply` flag (default is dry-run/preview)
- If `--find` matches multiple locations, the script reports all matches and refuses to apply. Magnus must narrow the match.
- A `.bak` is created before any edit (consistent with existing backup conventions)

### 2.4 Stdin Support

All content-accepting commands (`create`, `insert`, `edit`) gain `--stdin`:

```bash
echo "Note content here" | node scribe.js create "path" --stdin
cat long_content.md | node scribe.js insert "path" --stdin --at end
```

**Implementation:** If `--stdin` is passed, read content from `process.stdin` instead of `args._[1]`. Falls back to CLI arg if stdin is empty/not piped.

## 3. Internal Refactoring

### 3.1 Shared Module: `lib/operations.js`

Extract duplicated logic into a shared module:

```javascript
// lib/operations.js
export function validatePath(rawPath)        // resolveVaultPath + existence check
export function ensureDir(filePath)           // mkdirSync(dirname, {recursive})
export function writeAndLint(path, content, tags)  // write + lint + RAG index
export function readContent(args)            // CLI arg or stdin reader
export function createBackup(path)           // .bak before mutations
export function formatDiff(original, modified, contextLines)  // chat-friendly diff
```

### 3.2 Backward Compatibility

Keep old entry points as thin wrappers for one release cycle:

```javascript
// write.js (deprecated shim)
import { main } from './scribe.js';
main(['create', ...process.argv.slice(2)]);
```

Update SKILL.md to document only `scribe.js` commands. Old scripts continue working but print a deprecation notice.

### 3.3 SKILL.md Simplification

Current: ~6,500 chars documenting 6 scripts with full paths.
Target: ~3,000 chars with one entry point + command table.

```markdown
## Tool: scribe

Path: `node skills/obsidian-scribe/scribe.js`

Commands:
  create <path> [content] [--tags]           Create new note
  insert <path> [content] [--at target]      Insert/append content
  edit   <path> --find <text> --replace <text>  Propose edit (preview by default)
  move   <source> <target>                   Move note + attachments
  archive <path>                             Move to 4-Archive/
  lint   <path> [--tags]                     Lint frontmatter
  read   <path>                              Extract text (PDF/MD)

Universal flags: --stdin, --dry-run, --json, --tags
```

## 4. Implementation Plan

### Phase 1: Core Refactor
- [ ] Create `lib/operations.js` with shared utilities
- [ ] Create `scribe.js` dispatcher with command routing
- [ ] Port `create` (from write.js) and `insert` (from append.js, with `--at` support)
- [ ] Add stdin support to content-accepting commands
- [ ] Add backward-compatible shims for old scripts

### Phase 2: Edit Command
- [ ] Implement `--find` / `--replace` with single-match enforcement
- [ ] Implement `formatDiff()` for chat-friendly output
- [ ] Implement `--apply` flag (default is dry-run for edits)
- [ ] Implement `.bak` creation before edits
- [ ] Add multi-line support via `--stdin` JSON payload

### Phase 3: Polish
- [ ] Rewrite SKILL.md to document unified interface
- [ ] Add `--json` output mode for programmatic consumers (memory provider, hooks)
- [ ] Add smoke tests for each command
- [ ] Remove deprecated shims after Magnus has adapted

## 5. Edit Command — Design Considerations

**Why default to dry-run?**
Obsidian notes are the user's second brain. Silent edits erode trust. By defaulting to preview, we ensure the user always sees what's changing before it happens. Magnus learns to propose, not impose.

**Why single-match enforcement?**
Ambiguous edits are dangerous. If "Budget: $400" appears in 3 places, blindly replacing the first match is wrong. Requiring a unique match forces Magnus to provide enough context in `--find` to be unambiguous — or to use `--at line:N` for precision.

**Why chat-friendly diff format?**
Magnus communicates via Telegram. Standard unified diff is noisy and hard to read on mobile. The proposed format uses:
- `- / +` prefixes (universally understood)
- Numbered context lines (precise reference)
- `← changed` marker (scannable)
- No ANSI codes, no `@@` headers, no tab characters

**Could we use an interactive approval flow instead?**
Yes — the edit command could output a pending edit ID, and a separate `approve` command applies it. But this adds statefulness (pending edits file) and complexity. The simpler two-step flow (dry-run → apply) keeps the tool stateless. The agent's conversation history is the "pending edits queue."

**What about multi-field edits?**
For now, one find/replace per invocation. Multiple edits = multiple calls. This is intentionally simple. If we find Magnus frequently needs batch edits, we can add a `--patch` mode that accepts a JSON array of operations.

## 6. Dependencies & Risks

- **obsidian-scribe/lib/utils.js** — needs no changes, already shared
- **obsidian-scribe/lint.js** — needs no changes, called by `writeAndLint()`
- **obsidian-scribe/lib/sync-mapping.js** — used by create and move, ported as-is
- **SKILL.md** — major rewrite (Phase 3), but skill remains functional during transition
- **Risk:** Magnus's existing prompts reference `write.js` / `append.js` directly. The shims handle this, but AGENTS.md or cached context may need updating.
- **Risk:** The obsidian-memory hook (`~/.openclaw/hooks/obsidian-memory/handler.js`) references `write.js` and `append.js` directly — update after Phase 1.

## 7. Memory Provider Requirements

These additions are needed to support the native Obsidian memory provider (see `~/openclaw-fork/prd/PRD-obsidian-memory-provider.md`):

### 7.0 Alternatives Considered: Obsidian MCP Server

**Evaluated:** Using an existing Obsidian MCP server (e.g., `cyanheads/obsidian-mcp-server` or `MarkusPfundstein/mcp-obsidian`) as the read/write layer instead of building our own.

**What the MCP does well:** Generic CRUD (create, read, search/replace, global search, atomic frontmatter get/set/delete, tag management, directory listing). More feature-complete for reads than our current scribe.

**What it lacks:** Opinionated linting (our frontmatter schema enforcement), PARA-aware filing, edit approval workflow (dry-run + chat-friendly diff), native OpenClaw memory provider integration, Supernote sync mapping updates.

**Blocker — WSL2 networking:** The Obsidian Local REST API plugin binds to `127.0.0.1` only. WSL2 runs in a separate network namespace, so the API is unreachable from WSL2 even on the same machine. Tested via Tailscale IP (`100.70.167.119:27124`) — TCP port is open but TLS handshake fails because the plugin doesn't accept connections from non-localhost interfaces. The cert SAN is `127.0.0.1` only.

**Potential fix — WSL2 mirrored networking:** Setting `networkingMode=mirrored` in `.wslconfig` would share the Windows host's network stack, making `127.0.0.1:27124` accessible from WSL2. However:
- Global change affecting all WSL2 networking (port conflicts, Docker behavior changes)
- Heavy hammer for a single use case
- Direct filesystem access via `/mnt/c/` already works without Obsidian running, without network dependencies, and without TLS configuration

**Decision (2026-02-14):** Keep obsidian-scribe as the primary interface using direct filesystem access. The MCP adds a fragile network dependency for something that's fundamentally a local filesystem operation. Revisit if more Windows-localhost access needs emerge. Record mirrored networking as an unblocked path for future consideration.

### 7.1 Shared Frontmatter Parser (`lib/frontmatter.js`)

Currently, frontmatter parsing exists in **three separate places**:
- `obsidian-scribe/lint.js` — uses `front-matter` npm package, knows about `date created`, `date modified`, `aliases`, `tags`
- `local-rag/rag.js` — hand-rolled regex parser, knows about `tags`, `aliases`, `summary`
- `local-rag/para-predict.js` — inherits from `local-rag/db.js` metadata

The memory provider needs a **single canonical parser** that extracts all fields:
- `title`, `aliases`, `tags`, `date created`, `date modified`
- `summary` (if present)
- PARA category + area (inferred from path)

**Action:** Extract `lint.js`'s `front-matter` + `js-yaml` based parser into `lib/frontmatter.js`. Export: `parseFrontmatter(content)`, `generateFrontmatter(fields)`. Both the scribe and the memory provider import from here.

### 7.2 PARA Location Detection (`lib/para-detect.js`)

PARA (Projects, Areas, Resources, Archive) is a natural fit for agent memory — it divides knowledge into actionable categories that improve search relevance. The provider should be PARA-aware out of the box.

**Exports:**
- `detectParaLocation(filePath)` — parses vault path to extract `para_category` (1-Projects, 2-Areas, etc.) and `para_area` (subfolder name). Pure path parse, no ML.
- `PARA_CATEGORIES` — enum of recognized top-level folders and their semantic meaning
- `isParaStructured(vaultPath)` — detect whether a vault uses PARA by checking for 2+ recognized top-level folders

**Usage:** Both the FTS5 index (field weighting: `para_area` at 4×) and the memory flush (auto-filing to the correct PARA location) use this. Users without PARA structure get graceful degradation — fields are empty, search still works.

### 7.3 Embedding Strategy: Use OpenClaw's Native `node-llama-cpp`

**Key finding:** OpenClaw already ships `node-llama-cpp` with a default GGUF embedding model (`embeddinggemma-300m-qat-q8_0`, 300M params, auto-downloaded from HuggingFace). This runs natively on Apple Silicon (Metal), CUDA, and CPU — zero external dependencies.

Our `local-rag` skill uses Ollama + `nomic-embed-text` (768d), which requires a separate Ollama installation and model pull. **For a provider that ships inside OpenClaw, this is a non-starter** — users expect `npm i -g openclaw` to just work.

**Decision:** The Obsidian provider MUST use OpenClaw's existing embedding infrastructure (`createLocalEmbeddingProvider` or the auto-resolution chain). This gives us:
- Zero setup for users — no Ollama, no model pull
- Works on Mac M2-M4 (Metal), Linux (CUDA/CPU), Windows out of the box
- Embedding cache for free (already built into OpenClaw's `embedding_cache` table)
- Fallback chain: local → OpenAI → Gemini → none

Users who want `nomic-embed-text` quality can set `memorySearch.obsidian.embedding.model` to a GGUF path or HuggingFace URL. The default just works.

**What we bring from local-rag (search innovations, not embedding):**
- RRF fusion algorithm (better than OpenClaw's linear combination)
- Per-field FTS5 weighting (filename:10, title:8, tags:5, para_area:4)
- Entity shortcut (instant filename/alias match, skip embedding)
- PARA-aware metadata extraction
- Paragraph-aware chunking with metadata prefix injection

### 7.4 Vault Indexing at Scale

**Problem:** When adding the Obsidian vault as an `extraPath` to the built-in memory provider, it broke — likely because the system was designed for `memory/` (10-30 files) not a full vault (725+ files).

**Analysis of a real vault (Jesten's):**
- 725 markdown files, 889KB total content
- ~725 chunks at 400 tokens/chunk (most files are small)
- Initial embedding: ~36 seconds with local `node-llama-cpp`
- Incremental: only changed files re-embedded (mtime + hash check)

**Root cause of the `extraPath` failure:** The built-in sync fires on session start (`warmSession`) and on search (`onSearch`) as fire-and-forget (`void`). With 725 files to embed on cold start, the sync runs in the background while the agent tries to search — returning zero or stale results. The sync may also timeout or OOM on large embedding batches.

**Solutions for the Obsidian provider:**
1. **Explicit initial index command** — `openclaw memory index --provider obsidian` for first-time setup. Show progress bar. Don't block agent turns.
2. **Background incremental sync** — Use file watcher (chokidar, with `.obsidian/` + attachments excluded, 1500ms debounce). Only re-embed changed files.
3. **Search-before-sync-complete** — Return keyword-only results (FTS5) while vector index is still building. Degrade gracefully, don't fail.
4. **Configurable exclude folders** — Default: `.obsidian`, `.trash`, `4-Archive` (searchable but lower priority). Users can customize.
5. **Chunk budget** — Cap initial indexing at N chunks per sync cycle (e.g., 100), spread across multiple cycles. Prevents blocking.

### 7.2 Lint-Check Mode (`--check`)

The memory provider needs to validate notes during indexing without modifying them. Currently `lint.js` always writes fixes.

**Action:** Add `--check` flag to `lint` command. Returns exit code 0 if valid, 1 if issues found. Outputs issues as JSON with `--json`. No file modification.

### 7.3 Programmatic API (`lib/api.js`)

The hook and memory provider currently shell out via `execFileSync`. This is fragile, slow (~200ms per spawn), and can't handle large content reliably.

**Action:** Export core operations as importable functions:

```javascript
// lib/api.js
export async function create(relPath, content, opts)    // → { path, linted }
export async function insert(relPath, content, opts)    // → { path, linted, insertedAt }
export async function edit(relPath, find, replace, opts) // → { path, diff, applied }
export async function move(source, target)               // → { from, to }
export async function archive(relPath)                   // → { from, to }
export async function lint(absPath, opts)                // → { valid, issues }
export async function read(absPath)                      // → { content, frontmatter }
```

`scribe.js` CLI becomes a thin wrapper around `lib/api.js`. The memory provider and hooks import `lib/api.js` directly — no child process spawning.

### 7.4 PARA Location Detection

`local-rag` has a `para-predict.js` that uses hybrid search to predict PARA destinations. The scribe currently has no awareness of this.

**Action:** Add `detectParaLocation(filePath)` to `lib/frontmatter.js` — parses the vault path to extract `para_category` (1-Projects, 2-Areas, etc.) and `para_area` (the subfolder name). This is a simple path parse, not the ML prediction — the prediction stays in local-rag, but the path-based detection is shared.

### 7.5 Batch Operations

The memory provider will flush multiple memories in a single compaction event. Currently each write spawns a new process.

**Action:** `lib/api.js` functions should be stateless and safe to call in rapid succession. The linter should accept a `skipLint` option for batch mode (lint once after all writes, not per-write).

## 8. Follow-up

- [ ] After this overhaul, update the obsidian-memory hook to import `lib/api.js` instead of spawning `write.js`/`append.js`
- [ ] Update the Obsidian memory provider to import shared modules directly
- [ ] Consider publishing obsidian-scribe as an OpenClaw community skill package
- [ ] Benchmark `lib/api.js` direct calls vs `execFileSync` spawn overhead
- [ ] Coordinate with local-rag to consolidate frontmatter parsing into scribe's `lib/frontmatter.js`
