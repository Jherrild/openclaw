# local-rag Efficiency PRD

## Problem
SKILL.md is ~3,200 chars with ~25% boilerplate. Use Cases 1–3 repeat the same `node rag.js <cmd> <dir>` pattern with different directories. Suggested Workflow duplicates commands already shown. Best Practices section restates information from other sections.

## Proposed Changes
1. **Collapse Use Cases 1–3 into a table** — 3 columns: Scope, Index Target, When to Use. Eliminates 6 redundant code blocks.
2. **Merge Suggested Workflow into Use Cases** — Add a "Typical Flow" row or footnote: index → search → query → reset. Remove the standalone section.
3. **Merge Best Practices into a Tips subsection** under Usage — 4 bullet points max. Drop "Hybrid Scoring" (implementation detail Magnus doesn't need) and "Always Use for Research" (obvious from the skill description).
4. **Trim Indexing Behavior** — Reduce the 3-bullet explanation + symlink warning to 2 sentences: "Indexes all .md files recursively under the target, including symlinked directories. Scope your target narrowly."

## Expected Impact
- Current: ~3,200 chars
- Target: ~2,560 chars (~20% reduction, ~160 token savings per read)

## Bugs / Errors Found
- **No bugs found.** SKILL.md is accurate and consistent with the codebase.
- Minor: `config.json` reference at the bottom is useful but could note which model/chunk settings are configurable.
