## PRD Draft Complete

### Location

prd/issue-3.md

### Summary

This PRD proposes adding an optional `onTextDelta` callback through the embedded runner and `agentCommand`, then refactoring Discord voice `processSegment` to stream sentence-level TTS as deltas arrive instead of waiting for full completion. The approach preserves existing final-response/session-history behavior by treating streaming as a side-channel for low-latency playback while the canonical final payload remains unchanged. It also introduces generation-token gating for interruption safety so stale queued speech is dropped after barge-in.

### Stages

1. Embedded runner delta callback plumbing (`runEmbeddedPiAgent`/`runEmbeddedAttempt` and stream event adapter).
2. `agentCommand` optional callback threading with ACP/non-voice compatibility preserved.
3. Voice manager streaming sentence pipeline with early TTS + barge-in generation checks.
4. Final-response persistence and regression hardening for session history and duplicate emission safety.

### Key Decisions

Use a dedicated `onTextDelta` callback rather than relying on generic `onAgentEvent` or `onPartialReply`, because voice latency logic needs explicit monotonic text deltas with minimal coupling to broader event payloads. Keep final session/transcript persistence tied to the completed `agentCommand` result so streaming cannot corrupt canonical history. Reject “TTS-only optimization without streaming” because it does not remove the largest latency source (blocking full LLM completion).

### Open Questions

Whether sentence boundaries should include newline-based flushes in addition to punctuation; whether to enforce a minimum tail-length before final flush at stream end; and whether this issue should include introducing `bargeInGeneration` on this branch if it is not yet present.
