import { existsSync } from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { SILENT_REPLY_TOKEN } from "../../auto-reply/tokens.js";
import { getVoiceManager } from "../../discord/voice/voice-registry.js";
import type { AnyAgentTool } from "./common.js";

const PlayAudioToolSchema = Type.Object({
  paths: Type.Array(Type.String(), {
    description:
      "One or more absolute paths to audio files (WAV/MP3/OGG) to play sequentially in the current voice channel.",
  }),
});

/**
 * Tool that plays pre-existing audio files directly in the Discord voice channel.
 * Files are queued and played sequentially. Returns immediately after queuing.
 */
export function createPlayAudioTool(): AnyAgentTool {
  return {
    label: "Play Audio",
    name: "play_audio",
    description: `Play audio files in the current Discord voice channel. Files are queued and played in order. Reply with ${SILENT_REPLY_TOKEN} after a successful call to avoid duplicate messages.`,
    parameters: PlayAudioToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const paths = params.paths as string[];

      if (!paths || paths.length === 0) {
        return {
          content: [{ type: "text", text: "Error: no file paths provided." }],
          details: { error: "no paths" },
        };
      }

      // Validate all files exist before queueing any
      const missing = paths.filter((p) => !existsSync(p));
      if (missing.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `Error: files not found: ${missing.map((p) => path.basename(p)).join(", ")}`,
            },
          ],
          details: { error: "missing files", missing },
        };
      }

      // Find an active voice manager and queue all files
      const voiceManager = getVoiceManager();
      if (!voiceManager) {
        return {
          content: [{ type: "text", text: "Error: no active voice connection." }],
          details: { error: "no voice manager" },
        };
      }

      let queued = 0;
      for (const audioPath of paths) {
        if (voiceManager.playAudioAny(audioPath)) {
          queued++;
        }
      }

      if (queued === 0) {
        return {
          content: [{ type: "text", text: "Error: not connected to a voice channel." }],
          details: { error: "not in voice channel" },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Queued ${queued} audio file${queued === 1 ? "" : "s"} for playback.`,
          },
        ],
        details: { queued, paths: paths.map((p) => path.basename(p)) },
      };
    },
  };
}
