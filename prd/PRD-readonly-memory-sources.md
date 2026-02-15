# PRD: Read-Only Memory Sources for OpenClaw

> **Status:** Proposed — 2026-02-15
> **Depends on:** Obsidian memory provider (must be working first)

---

## 1. Problem Statement

Magnus only knows about external data (todos, calendar, emails) when he explicitly invokes a skill. He has to _decide_ to check. This means conversationally relevant context — like a todo related to the topic being discussed — never surfaces unless the user asks or Magnus happens to think of it.

**Goal:** Allow local skills to register as read-only memory sources. Their data gets indexed alongside vault/memory files and surfaces automatically via semantic search during normal conversation.

**Example:** User says "let's talk about the kitchen remodel." Without being asked, Magnus's memory search returns both the Obsidian note about the remodel AND the todo "buy tile samples from Home Depot" from google-tasks — because both matched the query.

---

## 2. Interface

```typescript
interface ReadOnlyMemorySource {
  id: string; // Unique source ID: "google-tasks", "calendar"
  name: string; // Human-readable: "Google Tasks"
  fetch(): Promise<MemoryDocument[]>; // Pull latest data
  refreshIntervalMs: number; // Re-fetch interval (e.g., 300_000 for 5 min)
}

interface MemoryDocument {
  id: string; // Stable ID for dedup/update detection
  text: string; // Searchable content
  title?: string; // For FTS5 title field weighting
  tags?: string[]; // For FTS5 tag field weighting
  timestamp?: number; // For recency ranking
  metadata?: Record<string, string>; // Arbitrary metadata
}
```

Skills register via config:

```json
{
  "memorySearch": {
    "readOnlySources": [
      {
        "id": "google-tasks",
        "command": "node skills/google-tasks/tasks.js list --json",
        "refreshInterval": "5m"
      },
      {
        "id": "calendar",
        "command": "node skills/google-tasks/tasks.js calendar --json --days 7",
        "refreshInterval": "15m"
      }
    ]
  }
}
```

The memory provider executes the command, parses the JSON output as `MemoryDocument[]`, and indexes it alongside vault content.

---

## 3. What Gets Ambient Awareness vs. Stays Skill-Invoked

| Source                           | Ambient (indexed) | Why                                                                            |
| -------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| Todos/tasks                      | ✅ Yes            | Provides conversational context ("we discussed X, and you have a todo for it") |
| Calendar (next 7 days)           | ✅ Yes            | Time-sensitive awareness ("your meeting about X is tomorrow")                  |
| Recent emails (subjects/senders) | ⚠️ Maybe          | Privacy-sensitive; subjects only, not bodies                                   |
| Financial data                   | ❌ No             | Rarely relevant to conversation; query-on-demand is fine                       |
| Weather                          | ❌ No             | Better as a real-time lookup than stale index                                  |

---

## 4. Ranking and Noise Mitigation

More indexed sources = more search results = potential noise. Mitigations:

1. **Source-type weighting in FTS5** — Add a `source` field to FTS5 with configurable weight. Vault notes rank higher than todos by default.
2. **Recency bias** — Documents with recent timestamps get a small boost. A todo from today outranks one from 3 months ago.
3. **Document count caps** — Each source has a max document count (e.g., 100 todos, 50 calendar events). Oldest/completed items are evicted first.
4. **Source-level minScore** — A per-source minimum relevance score. Low-relevance todo matches don't pollute vault search results.

---

## 5. Implementation Approach

This is a **generalization of the Obsidian provider pattern.** The Obsidian provider indexes files from a vault. Read-only sources index documents from commands. Both feed into the same FTS5 + vector search pipeline.

### Phase 1: Command-Based Sources

- Config: `readOnlySources[]` with `command` and `refreshInterval`
- Daemon runs commands on interval, parses JSON output
- Documents inserted into existing FTS5 + vector tables with `source` field
- Dedup by document `id` — only re-embed changed documents

### Phase 2: Skill-Native Sources

- Skills can export a `memorySource` in their SKILL.md frontmatter
- OpenClaw auto-discovers and registers them
- No config needed — just enable the skill

### Phase 3: Source Weighting and Tuning

- Per-source FTS5 weight configuration
- Recency bias
- Document count caps
- Dashboard showing indexed source stats

---

## 6. Dependencies

- Obsidian memory provider must be working (establishes the indexing/search pattern)
- Skills that want to be sources must support `--json` output format
- `google-tasks/tasks.js` already supports `list` — just needs JSON output mode

---

## 7. Alternatives Considered

### Just Use Skills (Current Approach)

Works for explicit queries. Fails for ambient awareness. The user has to ask "check my todos" — the agent won't proactively surface relevant context.

### Index Everything into Obsidian

Write todos/calendar/emails as Obsidian notes. The vault becomes the single index. **Rejected:** Creates noise in the user's vault, mixes ephemeral data (today's calendar) with durable knowledge. The vault should be human-curated, not auto-polluted.

### MCP Tool Results Caching

Cache recent tool call results and search them. **Interesting but different scope** — this indexes historical tool outputs, not live data. Could complement read-only sources but doesn't replace them.

---

## 8. Open Questions

1. Should completed/archived todos be evicted from the index automatically, or kept for historical context?
2. How do we handle sources that fail to fetch? (Network down, auth expired) — degrade gracefully, keep stale data?
3. Should the agent know _which source_ a result came from? (e.g., "From your Google Tasks: ...")
4. Privacy: should there be a per-source "include in context" toggle?

---

## 9. Test Plan

- Unit: Command execution and JSON parsing
- Unit: Document dedup (same ID, changed content → re-embed; unchanged → skip)
- Unit: Source-type weighting in search results
- Integration: Index 20 test todos, verify they surface in semantic search alongside vault results
- Integration: Refresh interval works (stale data updated)
