# obsidian-scribe Efficiency PRD

## Problem
SKILL.md is ~6,500 chars with ~35% boilerplate — the largest skill doc. Rules 5 (Attachments) and 6 (Subfolder Preference) describe related file-organization concerns separately. Rules 1 (Search First) and 2 (PARA Structure) overlap with the Organize workflow. The Companion Tool section repeats information already in the Auto-Indexing subsection. Rule 7 mentions "split destinations" without a concrete example.

## Proposed Changes
1. **Merge Rules 5 & 6 into a single "File Organization" rule** — both deal with attachment co-location and the `Documents/` subfolder convention. Combine into one rule with sub-bullets for .md placement vs attachment placement. Saves ~400 chars.
2. **Consolidate Rules 1 & 2 with Organize workflow** — the Organize workflow already mandates searching and PARA categorization. Reduce Rules 1 & 2 to back-references: "See Organize workflow for search-first and PARA logic." Saves ~300 chars.
3. **Reduce Companion Tool section to 1-line reference** — "For vault search, use `local-rag`. See Auto-Indexing above for integration details." The current 2-line section + the Auto-Indexing section both reference local-rag. Saves ~150 chars.
4. **Add guidance for notes spanning multiple PARA categories** — Rule 7 says to ask when ambiguous but doesn't address the common case of notes that legitimately span categories (e.g., a work receipt that's both Career and Finance). Add a 1-line tiebreaker: "Finance takes precedence per Rule 8; otherwise, file by primary action area."
5. **Compress Delegation Protocol** — the High-Context vs Low-Context distinction is clear but verbose. Replace the bullet-list examples with a compact table: Trigger | Action | Why. Saves ~250 chars.
6. **Trim tool Usage blocks** — all 5 tools repeat the full absolute path. Show it once as `SCRIBE_DIR` and use short-form in each tool entry.

## Expected Impact
- Current: ~6,500 chars
- Target: ~4,875 chars (~25% reduction, ~400 token savings per read)

## Bugs / Errors Found
- **Rule 7 "split destinations" lacks a concrete example** — the rule says to stop and ask if files get split across root folders, but provides no example scenario. This can leave Magnus uncertain about when to trigger the check. Add: "e.g., batch of medical documents split between `2-Areas/Finance/Medical/` and `2-Areas/Health/`."
- Minor: Rule 1 references `memory_search` — verify this is the current tool name (may be stale if local-rag replaced it).
- Minor: `scribe_read_pdf` section could note that it only extracts text (no OCR) to set expectations for scanned PDFs.
