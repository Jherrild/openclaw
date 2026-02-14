# PRD: Channel Resolver (Context-Aware Routing)

## Problem Statement
Currently, OpenClaw and its various skills (`interrupt-service`, `task-orchestrator`, `monarch-bridge`) default to sending all messages to a single monolithic Telegram chat (the "Main Session"). This clutters the conversation and ignores the user's organizational structure across multiple **Channels**, **Topics** (Threads), and **Platforms**.

Jesten wants a system that can intelligently route messages to the **correct destination** based on the *context*, *content*, and *metadata* of the message. This system must be extensible to support future platforms (Slack, Discord, Home Presence/Voice) and capable of dynamically discovering available destinations without manual configuration.

## Goals
1.  **Multi-Platform Routing:** Support routing to Telegram Topics, Slack Channels, Discord Servers/Categories, and Home Presence (Voice).
2.  **Context-Aware Analysis:** Analyze message content (text, source app, urgency) to determine the best destination (e.g., "Critical Alert" -> `#alerts`, "Dev Log" -> `#git`, "Casual" -> `General`).
3.  **Dynamic Discovery:** Automatically scan connected platforms to discover available channels/topics and their purpose (e.g., by reading descriptions or recent history) without manual config file editing.
4.  **Centralized Resolver API:** Provide a single tool/endpoint that other skills call:
    -   `resolve_destination(content: string, source: string, tags: string[]) -> { platform: string, channelId: string, threadId: string, method: string }`
5.  **Fallback Safety:** Always have a safe default (e.g., Telegram General) if resolution fails or is ambiguous.

## Architecture

### 1. `channel-resolver` Skill
A new skill located in `skills/channel-resolver/` that acts as the routing brain.

**Core Components:**
-   **Routing Table:** A dynamic map of `Semantic Concept` -> `Destination`.
    -   Example: `concept:dev` -> `{ platform: "telegram", channelId: "-100...", threadId: "6" }`
    -   Example: `concept:home` -> `{ platform: "telegram", channelId: "-100...", threadId: "2" }`
    -   Example: `concept:voice` -> `{ platform: "home-presence", method: "speak", device: "kitchen" }`
-   **Discovery Engine:**
    -   **Scanner:** Periodically polls connected platforms (via their APIs/OpenClaw tools) to list channels.
    -   **Classifier:** Uses a small LLM (Haiku/Flash) to analyze channel names/descriptions and assign semantic tags (e.g., `#dev`, `#alerts`, `#random`).
-   **Resolver Logic:**
    -   **Rule-Based (Fast):** Regex/Keyword matching (e.g., "HA", "Thermostat" -> Home).
    -   **LLM-Based (Smart):** Small model call to classify ambiguous messages based on the semantic tags of available channels.

### 2. Integration Points
-   **Interrupt Service:** Update `interrupt-service` to call `channel-resolver` before dispatching alerts.
-   **Task Orchestrator:** Background tasks route completion reports to project-specific channels.
-   **Monarch Bridge:** Financial updates route to `#finance` or a private DM.
-   **Agent Replies:** The main agent (Magnus) can use the resolver to decide whether to reply in-thread, start a new thread, or move to a different platform.

### 3. Extensibility (Future-Proofing)
-   **Slack/Discord:** The resolver schema must support `channelId`, `threadId`, `guildId` (Discord), and `teamId` (Slack).
-   **Home Presence:** Support routing to `home-presence` skill for TTS output (e.g., `destination: { platform: "voice", device: "living-room" }`).

## Technical Requirements
-   **Language:** Node.js (consistent with other skills).
-   **Input:** JSON payload with `{ text, source, tags, urgency }`.
-   **Output:** JSON payload with `{ platform, channelId, threadId, method }`.
-   **Latency:** Must be fast (<500ms for rule-based, <2s for LLM-based) to not block critical alerts.
-   **Storage:** Persist the learned Routing Table to a JSON file (`routing-table.json`) to avoid re-scanning on every boot.

## Implementation Phases

### Phase 1: Foundation & Telegram Topics
-   Define the `routing-table.json` schema.
-   Implement `resolve.js` CLI with static map support.
-   Implement basic Telegram Topic discovery (if API allows) or manual map for Jesten's current setup.
-   Keyword-based routing logic.

### Phase 2: Dynamic Discovery & Scanner
-   Implement the **Scanner** to fetch channel lists from connected providers.
-   Implement the **Classifier** to tag channels with semantic concepts (LLM-based).
-   Auto-update `routing-table.json`.

### Phase 3: Multi-Platform & Voice
-   Add support for Slack/Discord schemas.
-   Add `home-presence` integration for voice routing.
-   Update `interrupt-service` to use the full resolver.

## Review Notes (2026-02-14)

- **Structure:** Strong. Keep separate as cross-cutting service.
- **Missing:** Concrete success metrics beyond "safe fallback". How does the dynamic discovery classifier decide semantic tags? No error handling strategy for ambiguous routing.
- **Recommendation:** Add success criteria section with measurable metrics. Define classifier approach (keyword? embedding? LLM?). Add error/fallback matrix.
