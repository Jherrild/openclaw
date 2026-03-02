import { describe, expect, it, vi } from "vitest";
import {
  handleMessageUpdate,
  resolveSilentReplyFallbackText,
} from "./pi-embedded-subscribe.handlers.messages.js";
import type { EmbeddedPiSubscribeContext } from "./pi-embedded-subscribe.handlers.types.js";

function createMessageContext(onTextDelta: ReturnType<typeof vi.fn>): EmbeddedPiSubscribeContext {
  return {
    params: {
      runId: "run-1",
      session: { id: "session-1" },
      onTextDelta,
      onAgentEvent: vi.fn(),
    },
    state: {
      reasoningStreamOpen: false,
      streamReasoning: false,
      deltaBuffer: "",
      blockBuffer: "",
      lastStreamedAssistantCleaned: "",
      lastStreamedAssistant: "",
      emittedAssistantUpdate: false,
      blockReplyBreak: "text_end",
      partialBlockState: { thinking: false, final: false, inlineCode: { inCode: false } },
    },
    blockChunking: undefined,
    blockChunker: null,
    noteLastAssistant: vi.fn(),
    stripBlockTags: vi.fn((text: string) => text),
    emitReasoningStream: vi.fn(),
    consumePartialReplyDirectives: vi.fn(() => null),
    flushBlockReplyBuffer: vi.fn(),
    log: { debug: vi.fn(), warn: vi.fn() },
  } as unknown as EmbeddedPiSubscribeContext;
}

describe("resolveSilentReplyFallbackText", () => {
  it("replaces NO_REPLY with latest messaging tool text when available", () => {
    expect(
      resolveSilentReplyFallbackText({
        text: "NO_REPLY",
        messagingToolSentTexts: ["first", "final delivered text"],
      }),
    ).toBe("final delivered text");
  });

  it("keeps original text when response is not NO_REPLY", () => {
    expect(
      resolveSilentReplyFallbackText({
        text: "normal assistant reply",
        messagingToolSentTexts: ["final delivered text"],
      }),
    ).toBe("normal assistant reply");
  });

  it("keeps NO_REPLY when there is no messaging tool text to mirror", () => {
    expect(
      resolveSilentReplyFallbackText({
        text: "NO_REPLY",
        messagingToolSentTexts: [],
      }),
    ).toBe("NO_REPLY");
  });
});

describe("handleMessageUpdate onTextDelta", () => {
  it("calls onTextDelta for text_delta events only", () => {
    const onTextDelta = vi.fn();
    const ctx = createMessageContext(onTextDelta);

    handleMessageUpdate(ctx, {
      message: { role: "assistant", content: [] },
      assistantMessageEvent: { type: "text_delta", delta: "Hello " },
    } as never);
    handleMessageUpdate(ctx, {
      message: { role: "assistant", content: [] },
      assistantMessageEvent: { type: "text_end", content: "Hello world." },
    } as never);

    expect(onTextDelta).toHaveBeenCalledTimes(1);
    expect(onTextDelta).toHaveBeenCalledWith("Hello ");
  });
});
