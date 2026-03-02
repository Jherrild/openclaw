## PRD Draft Complete

### Location

prd/issue-3.v2.md

### Summary

This PRD proposes end-to-end streaming voice response handling by threading an optional `onTextDelta` callback from `agentCommand` down through `runEmbeddedPiAgent`/`runEmbeddedAttempt`, and using that callback in Discord voice `processSegment` to dispatch TTS per completed sentence before full turn completion. It keeps ACP parity by forwarding `text_delta` events through the same callback surface, adds generation-based stale chunk suppression for barge-in safety, and preserves canonical persistence behavior by keeping session history sourced from final `agentCommand` completion payloads.

### Stages

1. Runner callback plumbing in embedded runner + subscribe handlers.
2. `agentCommand` API surface and forwarding for embedded + ACP.
3. Voice `processSegment` streaming sentence dispatch and completion flush.
4. Barge-in generation gating and persistence integrity regression hardening.

### Key Decisions

Use a dedicated `onTextDelta` callback instead of only repurposing generic `onAgentEvent`, to match issue requirements and provide a clear, typed contract for voice streaming consumers. Keep sentence-level dispatch (not token-level TTS) for better prosody and lower duplication risk, while still reducing first-audio latency. Retain final-response persistence on completion paths only, so streaming remains playback-side behavior and cannot corrupt canonical history.

### Open Questions

Should newline-only boundaries trigger dispatch without punctuation in v1, or be conservative and flush mostly on punctuation/completion? On barge-in, should stale generated audio artifacts be proactively deleted or left to existing temp-file lifecycle? Do we want future callback metadata (`runId`, `isFinal`) or keep the callback as minimal `delta: string` for initial rollout?
