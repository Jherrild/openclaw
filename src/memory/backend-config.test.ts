import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { resolveMemoryBackendConfig } from "./backend-config.js";

describe("resolveMemoryBackendConfig", () => {
  it("defaults to builtin backend when config missing", () => {
    const cfg = { agents: { defaults: { workspace: "/tmp/memory-test" } } } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.backend).toBe("builtin");
    expect(resolved.citations).toBe("auto");
    expect(resolved.qmd).toBeUndefined();
  });

  it("resolves qmd backend with default collections", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "qmd",
        qmd: {},
      },
    } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.backend).toBe("qmd");
    expect(resolved.qmd?.collections.length).toBeGreaterThanOrEqual(3);
    expect(resolved.qmd?.command).toBe("qmd");
    expect(resolved.qmd?.searchMode).toBe("search");
    expect(resolved.qmd?.update.intervalMs).toBeGreaterThan(0);
    expect(resolved.qmd?.update.waitForBootSync).toBe(false);
    expect(resolved.qmd?.update.commandTimeoutMs).toBe(30_000);
    expect(resolved.qmd?.update.updateTimeoutMs).toBe(120_000);
    expect(resolved.qmd?.update.embedTimeoutMs).toBe(120_000);
  });

  it("parses quoted qmd command paths", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "qmd",
        qmd: {
          command: '"/Applications/QMD Tools/qmd" --flag',
        },
      },
    } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.qmd?.command).toBe("/Applications/QMD Tools/qmd");
  });

  it("resolves custom paths relative to workspace", () => {
    const cfg = {
      agents: {
        defaults: { workspace: "/workspace/root" },
        list: [{ id: "main", workspace: "/workspace/root" }],
      },
      memory: {
        backend: "qmd",
        qmd: {
          paths: [
            {
              path: "notes",
              name: "custom-notes",
              pattern: "**/*.md",
            },
          ],
        },
      },
    } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    const custom = resolved.qmd?.collections.find((c) => c.name.startsWith("custom-notes"));
    expect(custom).toBeDefined();
    const workspaceRoot = resolveAgentWorkspaceDir(cfg, "main");
    expect(custom?.path).toBe(path.resolve(workspaceRoot, "notes"));
  });

  it("resolves qmd update timeout overrides", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "qmd",
        qmd: {
          update: {
            waitForBootSync: true,
            commandTimeoutMs: 12_000,
            updateTimeoutMs: 480_000,
            embedTimeoutMs: 360_000,
          },
        },
      },
    } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.qmd?.update.waitForBootSync).toBe(true);
    expect(resolved.qmd?.update.commandTimeoutMs).toBe(12_000);
    expect(resolved.qmd?.update.updateTimeoutMs).toBe(480_000);
    expect(resolved.qmd?.update.embedTimeoutMs).toBe(360_000);
  });

  it("resolves qmd search mode override", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "qmd",
        qmd: {
          searchMode: "vsearch",
        },
      },
    } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.qmd?.searchMode).toBe("vsearch");
  });

  it("resolves obsidian backend with defaults", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "obsidian",
        obsidian: {
          vaultPath: "/home/user/vault",
        },
      },
    } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.backend).toBe("obsidian");
    expect(resolved.obsidian).toBeDefined();
    expect(resolved.obsidian?.vaultPath).toBe("/home/user/vault");
    expect(resolved.obsidian?.dbPath).toBe("/home/user/vault/.obsidian/openclaw-memory.sqlite");
    expect(resolved.obsidian?.excludeFolders).toEqual([".obsidian", ".trash", "4-Archive"]);
    expect(resolved.obsidian?.preserveLocal).toBe(true);
    expect(resolved.obsidian?.chunking).toEqual({ tokens: 400, overlap: 80 });
    expect(resolved.obsidian?.search.maxResults).toBe(8);
    expect(resolved.obsidian?.search.minScore).toBe(0);
    expect(resolved.obsidian?.search.vectorWeight).toBe(0.7);
    expect(resolved.obsidian?.search.textWeight).toBe(0.3);
    expect(resolved.qmd).toBeUndefined();
  });

  it("resolves obsidian backend with custom overrides", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "obsidian",
        obsidian: {
          vaultPath: "/home/user/vault",
          dbPath: "/tmp/custom.sqlite",
          excludeFolders: [".obsidian"],
          preserveLocal: false,
          chunking: { tokens: 200, overlap: 40 },
          search: { maxResults: 12, minScore: 0.5, vectorWeight: 0.8, textWeight: 0.2 },
        },
      },
    } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.obsidian?.dbPath).toBe("/tmp/custom.sqlite");
    expect(resolved.obsidian?.excludeFolders).toEqual([".obsidian"]);
    expect(resolved.obsidian?.preserveLocal).toBe(false);
    expect(resolved.obsidian?.chunking).toEqual({ tokens: 200, overlap: 40 });
    expect(resolved.obsidian?.search.maxResults).toBe(12);
    expect(resolved.obsidian?.search.minScore).toBe(0.5);
    expect(resolved.obsidian?.search.vectorWeight).toBe(0.8);
    expect(resolved.obsidian?.search.textWeight).toBe(0.2);
  });

  it("falls back to workspace dir when no vaultPath specified", () => {
    const cfg = {
      agents: { defaults: { workspace: "/tmp/memory-test" } },
      memory: {
        backend: "obsidian",
      },
    } as OpenClawConfig;
    const resolved = resolveMemoryBackendConfig({ cfg, agentId: "main" });
    expect(resolved.backend).toBe("obsidian");
    const workspaceDir = resolveAgentWorkspaceDir(cfg, "main");
    expect(resolved.obsidian?.vaultPath).toBe(workspaceDir);
  });
});
