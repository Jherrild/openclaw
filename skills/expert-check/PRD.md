# PRD: Expert Check Skill

## Overview
Create a skill that allows Magnus to seamlessly delegate complex reasoning tasks or specific queries to a higher-intelligence model (e.g., Gemini 1.5 Pro, Claude 3.5 Opus) via a sub-agent, without changing the main session's model.

## User Story
As Jesten, I want to say "Expert check this" or "Ask the pro about [topic]" so that Magnus spawns a temporary, high-intelligence sub-agent to answer the question, preserving the main session's context window and cost efficiency.

## Requirements

### 1. Skill Definition (`SKILL.md`)
- **Name:** `expert-check`
- **Description:** Delegate a query to a high-intelligence sub-agent (Gemini Pro/Claude Opus) for reasoning, coding, or complex analysis.
- **Triggers:** "Expert check", "Ask the pro", "Double check this", "Deep think".

### 2. Operational Protocol (Instructions for Magnus)
When the skill is triggered:
1.  **Analyze Context:** Identify the specific question or problem the user wants checked. If ambiguous, use the last user message.
2.  **Compile Prompt:** Create a self-contained `task` string that includes:
    - The core question.
    - Relevant background context from the current session (summary).
    - Any necessary file paths.
3.  **Spawn Sub-Agent:** Call `sessions_spawn` with strict parameters:
    - `model`: `google/gemini-3-pro-preview` (Hardcoded as the "Expert" model).
    - `thinking`: `high` (Enable reasoning/chain-of-thought if available).
    - `cleanup`: `delete` (Session is ephemeral; we only need the answer).
    - `task`: The compiled prompt.
4.  **Report:** When the sub-agent returns the result, present it to the user as the "Expert Opinion".

### 3. CLI/Scripting (Optional but Recommended)
- While `sessions_spawn` is a native tool, we should check if we can wrap this in a CLI command for testing or manual invocation if needed.
- *Decision:* For V1, rely on the `SKILL.md` protocol to drive the native tool usage. No external scripts are strictly required unless we want to enforce specific prompt templates.

## Deliverables
- `skills/expert-check/SKILL.md`: The authoritative guide for the agent.

## Future Extensions
- Allow user to specify the expert model (e.g., "Ask Claude").
- Auto-attach active file context.
