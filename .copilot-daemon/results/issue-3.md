## PRD Updated

### Location

prd/issue-3.v2.md

### Changes Made

- Added a **Prior Review Feedback Status** section documenting that earlier concerns (missing runner callback plumbing and underspecified barge-in integration) are now explicitly addressed in the plan.
- Tightened Stage 3 with missing edge-case criteria/tests:
  - speak only the unseen suffix when final payload extends beyond streamed deltas,
  - preserve TTS directive overrides consistently across streamed chunks.
- Clarified Stage 4 scope to **reuse existing `bargeInGeneration`** behavior from the voice improvements baseline, with a minimal fallback only if absent.
- Replaced unresolved reviewer questions with concrete **Resolved Defaults** to avoid implementation ambiguity and reduce re-review churn.

### Remaining Concerns

None.
