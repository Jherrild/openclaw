import { ChannelType } from "@buape/carbon";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createConnectionMock,
  joinVoiceChannelMock,
  entersStateMock,
  createAudioPlayerMock,
  resolveAgentRouteMock,
  agentCommandMock,
  textToSpeechMock,
  resolveTtsConfigMock,
  runCapabilityMock,
} = vi.hoisted(() => {
  type EventHandler = (...args: unknown[]) => unknown;
  type MockConnection = {
    destroy: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    receiver: {
      speaking: {
        on: ReturnType<typeof vi.fn>;
        off: ReturnType<typeof vi.fn>;
      };
      subscribe: ReturnType<typeof vi.fn>;
    };
    handlers: Map<string, EventHandler>;
  };

  const createConnectionMock = (): MockConnection => {
    const handlers = new Map<string, EventHandler>();
    const connection: MockConnection = {
      destroy: vi.fn(),
      subscribe: vi.fn(),
      on: vi.fn((event: string, handler: EventHandler) => {
        handlers.set(event, handler);
      }),
      off: vi.fn(),
      receiver: {
        speaking: {
          on: vi.fn(),
          off: vi.fn(),
        },
        subscribe: vi.fn(() => ({
          on: vi.fn(),
          [Symbol.asyncIterator]: async function* () {},
        })),
      },
      handlers,
    };
    return connection;
  };

  return {
    createConnectionMock,
    joinVoiceChannelMock: vi.fn(() => createConnectionMock()),
    entersStateMock: vi.fn(async (_target?: unknown, _state?: string, _timeoutMs?: number) => {
      return undefined;
    }),
    createAudioPlayerMock: vi.fn(() => ({
      on: vi.fn(),
      off: vi.fn(),
      stop: vi.fn(),
      play: vi.fn(),
      state: { status: "idle" },
    })),
    resolveAgentRouteMock: vi.fn(() => ({ agentId: "agent-1", sessionKey: "discord:g1:c1" })),
    agentCommandMock: vi.fn(),
    resolveTtsConfigMock: vi.fn(() => ({
      modelOverrides: {
        enabled: true,
        allowProvider: true,
        allowVoice: true,
        allowText: true,
        allowSpeed: true,
        allowStyle: true,
        allowLanguage: true,
        allowModel: true,
        allowedProviders: ["openai", "elevenlabs", "edge", "local"],
        allowedModelRefs: [],
      },
    })),
    textToSpeechMock: vi.fn(async () => ({
      success: true,
      audioPath: "/tmp/tts.wav",
    })),
    runCapabilityMock: vi.fn(async () => ({
      outputs: [{ kind: "audio.transcription", text: "hello from user" }],
    })),
  };
});

vi.mock("@discordjs/voice", () => ({
  AudioPlayerStatus: { Playing: "playing", Idle: "idle" },
  EndBehaviorType: { AfterSilence: "AfterSilence" },
  VoiceConnectionStatus: {
    Ready: "ready",
    Disconnected: "disconnected",
    Destroyed: "destroyed",
    Signalling: "signalling",
    Connecting: "connecting",
  },
  createAudioPlayer: createAudioPlayerMock,
  createAudioResource: vi.fn(),
  entersState: entersStateMock,
  joinVoiceChannel: joinVoiceChannelMock,
}));

vi.mock("../../routing/resolve-route.js", () => ({
  resolveAgentRoute: resolveAgentRouteMock,
}));

vi.mock("../../commands/agent.js", () => ({
  agentCommand: agentCommandMock,
}));

vi.mock("../../tts/tts.js", () => ({
  resolveTtsConfig: resolveTtsConfigMock,
  textToSpeech: textToSpeechMock,
}));

vi.mock("../../media-understanding/runner.js", () => ({
  buildProviderRegistry: vi.fn(() => ({})),
  createMediaAttachmentCache: vi.fn(() => ({
    cleanup: vi.fn(async () => undefined),
  })),
  normalizeMediaAttachments: vi.fn(() => [{ id: "attachment-1" }]),
  runCapability: runCapabilityMock,
}));

let managerModule: typeof import("./manager.js");

function createClient() {
  return {
    fetchChannel: vi.fn(async (channelId: string) => ({
      id: channelId,
      guildId: "g1",
      type: ChannelType.GuildVoice,
    })),
    getPlugin: vi.fn(() => ({
      getGatewayAdapterCreator: vi.fn(() => vi.fn()),
    })),
    fetchMember: vi.fn(),
    fetchUser: vi.fn(),
  };
}

function createRuntime() {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };
}

describe("DiscordVoiceManager", () => {
  beforeAll(async () => {
    managerModule = await import("./manager.js");
  });

  beforeEach(() => {
    joinVoiceChannelMock.mockReset();
    joinVoiceChannelMock.mockImplementation(() => createConnectionMock());
    entersStateMock.mockReset();
    entersStateMock.mockResolvedValue(undefined);
    createAudioPlayerMock.mockClear();
    resolveAgentRouteMock.mockClear();
    agentCommandMock.mockReset();
    agentCommandMock.mockResolvedValue({
      payloads: [{ text: "ok" }],
      meta: { durationMs: 5 },
    });
    textToSpeechMock.mockReset();
    textToSpeechMock.mockResolvedValue({
      success: true,
      audioPath: "/tmp/tts.wav",
    });
    resolveTtsConfigMock.mockClear();
    runCapabilityMock.mockReset();
    runCapabilityMock.mockResolvedValue({
      outputs: [{ kind: "audio.transcription", text: "hello from user" }],
    });
  });

  it("keeps the new session when an old disconnected handler fires", async () => {
    const oldConnection = createConnectionMock();
    const newConnection = createConnectionMock();
    joinVoiceChannelMock.mockReturnValueOnce(oldConnection).mockReturnValueOnce(newConnection);
    entersStateMock.mockImplementation(async (target: unknown, status?: string) => {
      if (target === oldConnection && (status === "signalling" || status === "connecting")) {
        throw new Error("old disconnected");
      }
      return undefined;
    });

    const manager = new managerModule.DiscordVoiceManager({
      client: createClient() as never,
      cfg: {},
      discordConfig: {},
      accountId: "default",
      runtime: createRuntime(),
    });

    await manager.join({ guildId: "g1", channelId: "c1" });
    await manager.join({ guildId: "g1", channelId: "c2" });

    const oldDisconnected = oldConnection.handlers.get("disconnected");
    expect(oldDisconnected).toBeTypeOf("function");
    await oldDisconnected?.();

    expect(manager.status()).toEqual([
      {
        ok: true,
        message: "connected: guild g1 channel c2",
        guildId: "g1",
        channelId: "c2",
      },
    ]);
  });

  it("keeps the new session when an old destroyed handler fires", async () => {
    const oldConnection = createConnectionMock();
    const newConnection = createConnectionMock();
    joinVoiceChannelMock.mockReturnValueOnce(oldConnection).mockReturnValueOnce(newConnection);

    const manager = new managerModule.DiscordVoiceManager({
      client: createClient() as never,
      cfg: {},
      discordConfig: {},
      accountId: "default",
      runtime: createRuntime(),
    });

    await manager.join({ guildId: "g1", channelId: "c1" });
    await manager.join({ guildId: "g1", channelId: "c2" });

    const oldDestroyed = oldConnection.handlers.get("destroyed");
    expect(oldDestroyed).toBeTypeOf("function");
    oldDestroyed?.();

    expect(manager.status()).toEqual([
      {
        ok: true,
        message: "connected: guild g1 channel c2",
        guildId: "g1",
        channelId: "c2",
      },
    ]);
  });

  it("removes voice listeners on leave", async () => {
    const connection = createConnectionMock();
    joinVoiceChannelMock.mockReturnValueOnce(connection);
    const manager = new managerModule.DiscordVoiceManager({
      client: createClient() as never,
      cfg: {},
      discordConfig: {},
      accountId: "default",
      runtime: createRuntime(),
    });

    await manager.join({ guildId: "g1", channelId: "c1" });
    await manager.leave({ guildId: "g1" });

    const player = createAudioPlayerMock.mock.results[0]?.value;
    expect(connection.receiver.speaking.off).toHaveBeenCalledWith("start", expect.any(Function));
    expect(connection.off).toHaveBeenCalledWith("disconnected", expect.any(Function));
    expect(connection.off).toHaveBeenCalledWith("destroyed", expect.any(Function));
    expect(player.off).toHaveBeenCalledWith("error", expect.any(Function));
  });

  it("passes DAVE options to joinVoiceChannel", async () => {
    const manager = new managerModule.DiscordVoiceManager({
      client: createClient() as never,
      cfg: {},
      discordConfig: {
        voice: {
          daveEncryption: false,
          decryptionFailureTolerance: 8,
        },
      },
      accountId: "default",
      runtime: createRuntime(),
    });

    await manager.join({ guildId: "g1", channelId: "c1" });

    expect(joinVoiceChannelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        daveEncryption: false,
        decryptionFailureTolerance: 8,
      }),
    );
  });

  it("attempts rejoin after repeated decrypt failures", async () => {
    const manager = new managerModule.DiscordVoiceManager({
      client: createClient() as never,
      cfg: {},
      discordConfig: {},
      accountId: "default",
      runtime: createRuntime(),
    });

    await manager.join({ guildId: "g1", channelId: "c1" });

    const entry = (manager as unknown as { sessions: Map<string, unknown> }).sessions.get("g1");
    expect(entry).toBeDefined();
    (
      manager as unknown as { handleReceiveError: (e: unknown, err: unknown) => void }
    ).handleReceiveError(
      entry,
      new Error("Failed to decrypt: DecryptionFailed(UnencryptedWhenPassthroughDisabled)"),
    );
    (
      manager as unknown as { handleReceiveError: (e: unknown, err: unknown) => void }
    ).handleReceiveError(
      entry,
      new Error("Failed to decrypt: DecryptionFailed(UnencryptedWhenPassthroughDisabled)"),
    );
    (
      manager as unknown as { handleReceiveError: (e: unknown, err: unknown) => void }
    ).handleReceiveError(
      entry,
      new Error("Failed to decrypt: DecryptionFailed(UnencryptedWhenPassthroughDisabled)"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(joinVoiceChannelMock).toHaveBeenCalledTimes(2);
  });

  it("starts TTS before agent command resolves when first sentence streams", async () => {
    const manager = new managerModule.DiscordVoiceManager({
      client: createClient() as never,
      cfg: {},
      discordConfig: {},
      accountId: "default",
      runtime: createRuntime(),
    });
    const entry = {
      guildId: "g1",
      channelId: "c1",
      sessionChannelId: "discord:g1:c1",
      route: { agentId: "agent-1", sessionKey: "discord:g1:c1" },
      connection: createConnectionMock(),
      player: createAudioPlayerMock(),
      playbackQueue: Promise.resolve(),
      processingQueue: Promise.resolve(),
      activeSpeakers: new Set<string>(),
      bargeInGeneration: 1,
      decryptFailureCount: 0,
      lastDecryptFailureAt: 0,
      decryptRecoveryInFlight: false,
      stop: vi.fn(),
    };

    let resolveAgent: (() => void) | undefined;
    agentCommandMock.mockImplementationOnce(
      async (opts: { onTextDelta?: (delta: string) => void }) => {
        opts.onTextDelta?.("First sentence. ");
        await new Promise<void>((resolve) => {
          resolveAgent = resolve;
        });
        return {
          payloads: [{ text: "First sentence. Final tail." }],
          meta: { durationMs: 5 },
        };
      },
    );

    const processPromise = (
      manager as unknown as {
        processSegment: (params: {
          entry: unknown;
          wavPath: string;
          userId: string;
          durationSeconds: number;
        }) => Promise<void>;
      }
    ).processSegment({
      entry,
      wavPath: "/tmp/input.wav",
      userId: "u1",
      durationSeconds: 1,
    });

    await vi.waitFor(() =>
      expect(textToSpeechMock).toHaveBeenCalledWith(
        expect.objectContaining({ text: "First sentence." }),
      ),
    );

    resolveAgent?.();
    await processPromise;
  });

  it("flushes only unseen suffix from final payload", async () => {
    const manager = new managerModule.DiscordVoiceManager({
      client: createClient() as never,
      cfg: {},
      discordConfig: {},
      accountId: "default",
      runtime: createRuntime(),
    });
    const entry = {
      guildId: "g1",
      channelId: "c1",
      sessionChannelId: "discord:g1:c1",
      route: { agentId: "agent-1", sessionKey: "discord:g1:c1" },
      connection: createConnectionMock(),
      player: createAudioPlayerMock(),
      playbackQueue: Promise.resolve(),
      processingQueue: Promise.resolve(),
      activeSpeakers: new Set<string>(),
      bargeInGeneration: 1,
      decryptFailureCount: 0,
      lastDecryptFailureAt: 0,
      decryptRecoveryInFlight: false,
      stop: vi.fn(),
    };

    agentCommandMock.mockImplementationOnce(
      async (opts: { onTextDelta?: (delta: string) => void }) => {
        opts.onTextDelta?.("Hello ");
        opts.onTextDelta?.("world.");
        return {
          payloads: [{ text: "Hello world. Extra tail." }],
          meta: { durationMs: 5 },
        };
      },
    );

    await (
      manager as unknown as {
        processSegment: (params: {
          entry: unknown;
          wavPath: string;
          userId: string;
          durationSeconds: number;
        }) => Promise<void>;
      }
    ).processSegment({
      entry,
      wavPath: "/tmp/input.wav",
      userId: "u1",
      durationSeconds: 1,
    });

    const spokenTexts = textToSpeechMock.mock.calls.map(
      ([args]) => (args as { text: string }).text,
    );
    expect(spokenTexts).toEqual(["Hello world.", "Extra tail."]);
  });
});
