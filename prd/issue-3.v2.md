# PRD: Voice LLM Streaming for Early TTS (Issue #3, v2)

## Status

Draft

## Problem Statement

The current Discord voice path blocks on a full `agentCommand()` result before starting any TTS work. Even with sentence-level TTS pipelining, users still wait through full LLM completion before hearing the first audio. This issue requires true incremental behavior: as soon as the first complete sentence is available during model generation, TTS should start while generation continues.

## Proposed Approach

Add a dedicated optional text-delta callback (`onTextDelta`) through the embedded runner stack, expose it in `agentCommand`, and consume it in voice `processSegment` to emit sentence-level TTS as soon as sentence boundaries close.

High-level flow after change:

1. `processSegment` calls `agentCommand(..., { onTextDelta })`.
2. `agentCommand` forwards callback to:
   - embedded path (`runEmbeddedPiAgent` -> `runEmbeddedAttempt` -> stream subscription handler), and
   - ACP path (`text_delta` handler).
3. Voice manager buffers deltas, emits complete sentences immediately to TTS/playback, and flushes final remainder at turn completion.
4. Canonical final response persistence still uses final `agentCommand` payload/result path (not streaming side effects).

## Goals

- Reduce first-audio latency for voice responses.
- Keep non-voice `agentCommand` behavior unchanged.
- Preserve full final response/session history correctness.
- Make barge-in safe by dropping stale generation chunks.

## Non-Goals

- Reworking provider-level TTS engines.
- Changing ACP protocol/event schema.
- Refactoring unrelated voice capture/noise logic outside streaming integration.

## Implementation Stages

### Stage 1: Runner callback plumbing (`runEmbeddedPiAgent` / `runEmbeddedAttempt`)

Add `onTextDelta?: (delta: string) => void` as an optional callback in runner parameter types and thread it through:

- `src/agents/pi-embedded-runner/run/params.ts` (`RunEmbeddedPiAgentParams`)
- `src/agents/pi-embedded-runner/run/types.ts` (`EmbeddedRunAttemptParams` via base type)
- `src/agents/pi-embedded-runner/run.ts` (forward param into `runEmbeddedAttempt`)
- `src/agents/pi-embedded-runner/run/attempt.ts` (forward into stream subscription)
- `src/agents/pi-embedded-subscribe.types.ts` + message handlers (invoke for monotonic assistant text deltas only)

Acceptance criteria:

- Callback is optional and zero-impact when omitted.
- Callback fires only for assistant text deltas in generation order.
- No duplicate callback invocations for replayed full content (`text_end` with full content).

### Stage 1 Test Plan

- **Test file:** `src/agents/pi-embedded-subscribe.handlers.messages.test.ts`
- **Test cases:**
  1. `handleMessageUpdate_calls_onTextDelta_for_text_delta_only` — Input: stream events sequence `text_start(content="")`, `text_delta(delta="Hello ")`, `text_delta(delta="world.")`, `text_end(content="Hello world.")` with `onTextDelta` spy. Expected: callback called exactly with `["Hello ", "world."]`.
  2. `handleMessageUpdate_ignores_non_text_events` — Input: assistant events `thinking_delta`, `tool_call`, `message_end` mixed with one `text_delta("Hi.")`. Expected: callback called once with `"Hi."`; no calls for non-text events.
- **Test file:** `src/agents/pi-embedded-runner/run/attempt.test.ts`
- **Test cases:**
  1. `runEmbeddedAttempt_forwards_onTextDelta_to_subscription` — Input: attempt params include `onTextDelta` spy and mocked subscribe function capturing args. Expected: subscribe called with same callback reference.
  2. `runEmbeddedAttempt_without_onTextDelta_keeps_existing_subscription_contract` — Input: attempt params omit callback. Expected: subscribe still succeeds and run result payload unchanged.

---

### Stage 2: `agentCommand` callback surface + ACP/embedded forwarding

Add `onTextDelta?: (delta: string) => void` to `AgentCommandOpts` and wire it through both execution paths:

- Embedded path: forward into `runEmbeddedPiAgent` call.
- ACP path: invoke callback inside `text_delta` event branch before/alongside current aggregation logic.

Acceptance criteria:

- Existing callsites compile unchanged.
- ACP and embedded paths both deliver deltas through same callback API.
- Final `agentCommand` return shape remains unchanged.

### Stage 2 Test Plan

- **Test file:** `src/commands/agent.test.ts`
- **Test cases:**
  1. `agentCommand_embedded_forwards_onTextDelta_to_runner` — Input: call `agentCommand({ message:"ping", sessionKey:"agent:main:subagent:test", onTextDelta: spy })` with mocked `runEmbeddedPiAgent`. Expected: embedded call receives same `onTextDelta` function in params.
  2. `agentCommand_without_onTextDelta_preserves_previous_behavior` — Input: same command without callback. Expected: same payload/meta logging behavior as baseline and no new errors.
- **Test file:** `src/commands/agent.acp.test.ts`
- **Test cases:**
  1. `agentCommand_acp_invokes_onTextDelta_per_text_delta_event` — Input: ACP `runTurn` emits deltas `"A"`, `"BC"`, then done. Expected: callback calls are `["A","BC"]`; final payload text is `"ABC"`.
  2. `agentCommand_acp_ignores_empty_or_non_output_text_delta` — Input: ACP emits `text_delta(text="")`, `text_delta(stream="reasoning", text="ignore")`, `text_delta(stream="output", text="ok")`. Expected: callback called once with `"ok"`.

---

### Stage 3: Voice streaming sentence pipeline in `processSegment`

Refactor `src/discord/voice/manager.ts` `processSegment` to stream TTS:

- Start `agentCommand` with `onTextDelta`.
- Maintain per-turn text buffer.
- Detect complete sentence boundaries (`. ! ?` and newline break), dispatch completed sentences immediately to TTS.
- Keep queue order deterministic.
- Flush any unsent trailing text after command completion.
- Keep current `parseTtsDirectives` behavior applied to spoken text before TTS.

Acceptance criteria:

- First TTS generation can begin before `agentCommand` resolves.
- Sentences are spoken in generation order.
- Final trailing fragment is spoken once on completion.
- Non-streaming models still produce one spoken response.

### Stage 3 Test Plan

- **Test file:** `src/discord/voice/manager.test.ts`
- **Test cases:**
  1. `processSegment_starts_first_tts_before_agent_resolves` — Input: mocked `agentCommand` invokes `onTextDelta("First sentence. ")` and delays final resolve 500ms. Expected: `textToSpeech` called for `"First sentence."` before command promise resolves.
  2. `processSegment_waits_for_sentence_boundary` — Input: deltas `"This is incom"` then `"plete"` then `". Next"`. Expected: no TTS before period; first TTS chunk is `"This is incomplete."`.
  3. `processSegment_flushes_trailing_fragment_on_completion` — Input: deltas `"No punctuation tail"` and command resolve with final payload same text. Expected: exactly one TTS call with `"No punctuation tail"`.
  4. `processSegment_non_streaming_fallback_speaks_once` — Input: no deltas; final payload `"Only final text."`. Expected: one TTS call for `"Only final text."`.

---

### Stage 4: Barge-in generation safety + history integrity regressions

Integrate sentence streaming with generation invalidation and persistence safeguards:

- Add/use `bargeInGeneration` monotonic counter on voice session entry (increment when user interrupts).
- Stamp each TTS/playback task with generation; skip stale generation tasks.
- Ensure final persisted assistant output remains the complete final response (streaming callback is side-channel only).

Acceptance criteria:

- Interrupted prior generation audio never resumes after a new user utterance starts.
- Session history/transcript keeps complete final assistant response.
- No duplicate stored final messages caused by streaming + final flush overlap.

### Stage 4 Test Plan

- **Test file:** `src/discord/voice/manager.test.ts`
- **Test cases:**
  1. `processSegment_drops_stale_generation_chunks_after_barge_in` — Input: generation 1 emits `"Old sentence."`, then simulated barge-in increments generation to 2 before playback executes. Expected: generation 1 pending chunk is skipped; generation 2 chunk plays.
  2. `processSegment_generation_check_applies_to_tts_and_playback` — Input: generation changes between TTS completion and playback enqueue for old chunk. Expected: old chunk audio file is not played.
- **Test file:** `src/commands/agent.test.ts`
- **Test cases:**
  1. `agentCommand_streaming_deltas_do_not_change_final_persisted_payload` — Input: embedded run emits deltas `"Hi "` + `"there"` and final payload `"Hi there"`. Expected: stored session response and returned payload are exactly `"Hi there"`.
  2. `agentCommand_streaming_and_completion_do_not_duplicate_history_entries` — Input: streaming deltas plus normal completion for one turn. Expected: session store contains one assistant turn for the response, not duplicates.

## Alternatives Considered

1. **Only use existing `onAgentEvent` from `agentCommand` without runner callback plumbing**
   - Rejected for this issue because required scope explicitly asks `runEmbeddedPiAgent`/`runEmbeddedAttempt` callback threading and clearer contract for voice consumers.
2. **Do sentence splitting only after full completion (current behavior) with faster TTS**
   - Rejected because dominant latency is pre-TTS wait on full LLM completion.
3. **Stream character-level TTS immediately (no sentence boundaries)**
   - Rejected due to poor prosody and frequent rewrites/corrections mid-sentence.

## Dependencies

- `@mariozechner/pi-ai` text stream events (`text_delta`, `text_start`, `text_end`) already surfaced through embedded subscription handlers.
- `agentCommand` ACP runtime event stream (`text_delta`) in `src/commands/agent.ts`.
- Existing Discord voice queueing and TTS directive parsing in `src/discord/voice/manager.ts`.

## Risks and Mitigations

1. **Duplicate spoken content due to overlap between streamed sentences and final flush**
   - Mitigation: track consumed buffer index / dispatched sentence boundaries; flush only undispatched tail.
2. **Sentence boundary false positives (abbreviations, decimals)**
   - Mitigation: start with conservative boundary rules and validate with targeted tests; keep final-tail flush to avoid dropped text.
3. **Stale audio after interruption**
   - Mitigation: generation-token checks before both TTS generation and playback execution.
4. **Behavior regressions for non-voice callers**
   - Mitigation: callback remains optional; add explicit no-callback regression tests.

## Open Questions for Reviewer

1. Should newline-only boundaries trigger immediate sentence dispatch even without punctuation, or only when followed by another clause?
2. On barge-in, should stale generated audio files be proactively deleted for disk hygiene, or left to existing temp cleanup behavior?
3. Should voice streaming callback include metadata (`runId`, `isFinal`) in future, or keep current minimal `delta: string` shape for v1?
