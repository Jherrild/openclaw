## PRD Updated

### Location

prd/issue-3.md

### Changes Made

- Removed unnecessary runner-internal plumbing stages (`runEmbeddedPiAgent` / `runEmbeddedAttempt`) and replaced with a simpler plan that reuses existing embedded assistant delta events already emitted via `onAgentEvent`.
- Refocused implementation on a minimal non-breaking `agentCommand` API addition (`onTextDelta`) with explicit bridging for both embedded and ACP paths.
- Reworked staging to 3 independently testable stages (command callback, voice streaming + generation gating, persistence regressions) with concrete acceptance criteria and test cases.
- Resolved prior open questions directly in the PRD (sentence boundaries, tail flush behavior, and barge-in generation ownership) so implementation can proceed without ambiguity.
- Updated scope/alternatives/risks to match the simplified architecture and reduce overengineering risk.

### Remaining Concerns

None.
