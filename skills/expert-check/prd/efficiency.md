# expert-check Efficiency PRD

## Problem
SKILL.md is 3,302 chars with ~65% boilerplate. The Delegation Protocol repeats "analysis only / no implementation" three different ways (lines 27-29). Configuration duplicates info already in Overview. Error Handling table and Notes section restate constraints already covered. Every read costs Magnus ~820 tokens.

## Proposed Changes
1. **Merge Configuration into Overview** — collapse the 3-bullet config block into a single line: `Spawns ephemeral gemini-3-pro-preview sub-agent (thinking: high) for complex reasoning.`
2. **Deduplicate Delegation Protocol** — reduce 4 numbered items to 2: (a) Expert analyzes only, returns pseudocode/plan; (b) Magnus hands implementation to `copilot-delegate`. Remove redundant "Analysis Only" and "No Implementation" headers.
3. **Compress Workflow** — "Analyze Context" and "Compile Prompt" steps are obvious; collapse into a single "Prepare a self-contained prompt with question + context + file paths."
4. **Shorten Error Handling** — replace 3-row table with inline note: `On timeout/error: report and offer retry. On ambiguous query: ask user to clarify.`
5. **Remove Notes section** — all 3 bullets duplicate earlier content (analysis-only, ephemeral, cost-conscious).

## Expected Impact
- Current: 3,302 chars (~820 tokens)
- Target: ~2,100 chars (~525 tokens)
- Savings: ~1,200 chars (~295 tokens per read, ~36% reduction)

## Bugs / Errors Found
- **Verify model name**: `gemini-3-pro-preview` — confirm this is still the correct model identifier in `openclaw.json`. If the model was updated, this hardcoded default is stale.
- **No fallback model specified** — if `gemini-3-pro-preview` is unavailable, the skill has no documented fallback behavior.
