# PRD: Voice LLM Streaming for Early TTS (Issue #3)

## Status

Draft

## Problem Statement

The current Discord voice flow blocks on `agentCommand()` until the full model response is complete, then performs sentence splitting and TTS. This creates avoidable first-audio latency even though sentence-level TTS/playback is already pipelined. The goal is to start TTS as soon as the first complete sentence is available from streamed LLM output, while preserving final response correctness and session history integrity.

## Proposed Approach

Add an optional text-delta callback from the embedded runner all the way to voice processing:

1. **Runner plumbing:** Add `onTextDelta?: (delta: string) => void` to embedded run params and invoke it from the existing assistant stream update path (`text_delta`/`text_start`/`text_end` normalized deltas).
2. **Command plumbing:** Add the same optional callback to `AgentCommandOpts` and forward it through `agentCommand` → `runEmbeddedPiAgent` → `runEmbeddedAttempt`.
3. **Voice streaming pipeline:** In `DiscordVoiceManager.processSegment`, replace blocking “wait full reply then split” with a streaming accumulator that:
   - buffers deltas,
   - emits complete sentences immediately to TTS/playback,
   - leaves incomplete tail text buffered until enough punctuation arrives or run completion flushes it.
4. **Barge-in safety:** Tag sentence-generation work with a monotonic generation token (aligned with the existing/expected `bargeInGeneration` model), and skip stale TTS/playback when a newer speaker interruption supersedes the old response.
5. **History integrity:** Continue using the normal final `agentCommand` result as the source of truth for persisted session/transcript state; streaming callback is side-channel only.

## Scope

### In Scope

- Embedded runner text delta callback threading.
- `agentCommand` optional callback support without breaking existing callers.
- Voice sentence streaming + early TTS start.
- Barge-in-aware cancellation/skip behavior at sentence granularity.
- Regression coverage for transcript/session-history final output.

### Out of Scope

- Changing ACP runtime behavior beyond preserving current semantics.
- Reworking TTS provider internals.
- Replacing existing directive parsing rules (`parseTtsDirectives`) beyond what sentence streaming needs.

## Implementation Stages

### Stage 1 — Embedded runner delta callback plumbing

Implement optional `onTextDelta` in:

- `src/agents/pi-embedded-runner/run/params.ts`
- `src/agents/pi-embedded-runner/run/types.ts` (if needed for attempt typing)
- `src/agents/pi-embedded-runner/run.ts`
- `src/agents/pi-embedded-runner/run/attempt.ts`
- `src/agents/pi-embedded-subscribe.handlers.messages.ts` (or nearest stream event adapter) to invoke callback only for normalized assistant text deltas.

**Acceptance criteria**

- Callback receives monotonic assistant text deltas in model output order.
- No callback emission for non-assistant/tool lifecycle events.
- Existing behavior unchanged when callback is undefined.

### Stage 1 Test Plan

- **Test file:** `src/agents/pi-embedded-runner/run/attempt.test.ts`
- **Test cases:**
  1. `runEmbeddedAttempt_forwards_assistant_text_deltas` — Input: mocked assistant stream emits `text_start(content="Hello")`, `text_delta(delta=" world.")`, tool events, then `text_end(content="Hello world. Next.")`. Expected: `onTextDelta` receives exactly `["Hello", " world.", " Next."]` in order; tool events produce no callback calls.
  2. `runEmbeddedAttempt_noop_when_onTextDelta_missing` — Input: same stream as above with `onTextDelta` omitted. Expected: attempt completes successfully, no thrown errors, and final assistant text remains `"Hello world. Next."`.

---

### Stage 2 — `agentCommand` API threading (non-breaking)

Add optional callback to command-layer types and forwarding:

- `src/commands/agent/types.ts` (`AgentCommandOpts`)
- `src/commands/agent.ts` (forward in `runAgentAttempt` to embedded path)

**Acceptance criteria**

- Existing non-voice callsites compile unchanged.
- Embedded path forwards callback.
- ACP path remains unaffected (still uses ACP event flow and final aggregation).

### Stage 2 Test Plan

- **Test file:** `src/commands/agent.test.ts`
- **Test cases:**
  1. `agentCommand_forwards_onTextDelta_to_embedded_runner` — Input: call `agentCommand({ message:"hi", to:"+1555", onTextDelta: spy })` with embedded runner mocked. Expected: mocked `runEmbeddedPiAgent` receives the same callback function reference in params.
  2. `agentCommand_keeps_existing_behavior_without_onTextDelta` — Input: call `agentCommand({ message:"hi", to:"+1555" })` with no callback. Expected: returns existing payloads and logs/output behavior unchanged.
- **Test file:** `src/commands/agent.acp.test.ts`
- **Test cases:**
  1. `agentCommand_acp_session_ignores_onTextDelta_and_streams_normally` — Input: ACP session with `onTextDelta` provided plus ACP `text_delta` events `["ACP_", "OK"]`. Expected: final response remains `ACP_OK`; embedded runner not invoked.

---

### Stage 3 — Voice streaming sentence pipeline + barge-in gating

Refactor `processSegment` in `src/discord/voice/manager.ts`:

- start `agentCommand` with `onTextDelta`,
- maintain `deltaBuffer` + sentence extraction state,
- dispatch sentence TTS immediately when a complete sentence boundary is reached,
- flush trailing text on completion,
- guard each sentence TTS/playback with current generation token to prevent stale speech after barge-in.

**Acceptance criteria**

- First playable audio can start before full LLM completion.
- Sentence order preserved.
- Interruption (new speaking event) prevents stale queued chunks from old generation from playing.

### Stage 3 Test Plan

- **Test file:** `src/discord/voice/manager.test.ts`
- **Test cases:**
  1. `processSegment_starts_tts_on_first_complete_sentence_before_final_reply` — Input: mocked `agentCommand` invokes `onTextDelta` with `"Hello there."`, waits, then `" How are you today?"`, then resolves final payload. Expected: first `textToSpeech` call happens before `agentCommand` promise resolves; playback queue receives sentence 1 first.
  2. `processSegment_buffers_incomplete_sentence_until_boundary` — Input: deltas `["This is incomplete", " but now complete."]`. Expected: no TTS call after first delta; one TTS call with `"This is incomplete but now complete."` after boundary arrives.
  3. `processSegment_skips_stale_generation_after_barge_in` — Input: generation N emits first sentence, then simulated new speaking event increments generation to N+1 before N’s second sentence. Expected: N second-sentence TTS/playback is skipped; only generation N+1 chunks are played.

---

### Stage 4 — Final-response persistence and regression hardening

Ensure streaming path does not alter persisted final assistant content:

- keep final `agentCommand` result handling intact,
- verify session/transcript writes still use completed response text,
- verify no duplicate assistant events/payload regressions.

**Acceptance criteria**

- Session history records full final response, not partial fragments only.
- No duplicate final text emissions caused by combined streaming + completion handling.

### Stage 4 Test Plan

- **Test file:** `src/commands/agent.test.ts`
- **Test cases:**
  1. `agentCommand_preserves_final_payload_with_streaming_callback` — Input: embedded runner emits streamed deltas `["Hi", " there."]` and final payload `"Hi there."`. Expected: returned payload text is exactly `"Hi there."`; callback call count equals 2; no truncation.
  2. `agentCommand_session_store_records_complete_text_when_streaming_used` — Input: seeded session store + streaming callback + final payload `"Complete answer."`. Expected: persisted session metadata/transcript reflects full `"Complete answer."`, not an intermediate partial.

## Alternatives Considered

1. **Use only `onAgentEvent` and parse `assistant.delta` in voice layer**
   - Rejected: broader event surface than needed, more coupling to event schema, and less explicit API contract for “text-only deltas.”
2. **Use existing `onPartialReply` instead of adding `onTextDelta`**
   - Rejected: `onPartialReply` carries cleaned cumulative text/media semantics, not guaranteed raw monotonic deltas; sentence streaming benefits from explicit delta callbacks.
3. **Keep current blocking flow and optimize TTS only**
   - Rejected: does not address root first-token/first-audio latency from waiting for full model completion.

## Dependencies

- Existing embedded stream event handling (`text_start`/`text_delta`/`text_end`) in `src/agents/pi-embedded-subscribe.handlers.messages.ts`.
- Voice TTS stack (`parseTtsDirectives`, `textToSpeech`, playback queueing) in `src/discord/voice/manager.ts`.
- Existing or incoming barge-in generation counter behavior from `feat/voice-improvements`.

## Risks and Mitigations

1. **Out-of-order or duplicate stream events**
   - Mitigation: reuse existing monotonic delta normalization path already used for assistant streaming.
2. **Sentence segmentation errors with directives or abbreviations**
   - Mitigation: keep conservative boundary rules; flush residual tail text on completion.
3. **Race conditions on interruption (old generation still enqueued)**
   - Mitigation: validate generation token at both TTS generation time and playback execution time.
4. **Regression for non-voice callers**
   - Mitigation: optional callback only; add explicit no-callback regression tests in command layer.

## Open Questions

1. Should sentence boundary detection in voice mode treat newlines as hard boundaries or punctuation-only boundaries?
2. Should trailing non-punctuated tail text be spoken immediately on stream end or only if above a minimum character threshold?
3. If `bargeInGeneration` is not yet present on the target branch, should this issue include introducing it, or depend on merge/cherry-pick from `feat/voice-improvements` first?
