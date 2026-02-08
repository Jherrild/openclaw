---
name: expert-check
description: Delegate a query to a high-intelligence sub-agent (Gemini Pro/Claude Opus) for reasoning, coding, or complex analysis.
---

# expert-check

## Overview
- Spawns a temporary, high-intelligence sub-agent to answer complex questions
- Preserves the main session's context window and cost efficiency
- Returns the result as an "Expert Opinion" to the user

## Configuration
- **Expert Model:** `gemini-3-pro-preview` (hardcoded default)
- **Thinking Mode:** `high` (enable chain-of-thought reasoning)
- **Session Cleanup:** `delete` (ephemeral sub-agent; only the answer is retained)

## Triggers
Activate this skill when the user says any of:
- "Expert check"
- "Ask the pro"
- "Double check this"
- "Deep think"

## Workflow

When triggered, follow these steps:

### 1. Analyze Context
Identify the specific question or problem the user wants checked.
- If the user explicitly states the question, use it directly.
- If ambiguous, use the last user message as the query.

### 2. Compile Prompt
Create a self-contained task string that includes:
- **The core question** — clearly stated
- **Relevant background context** — summary of the current session's context
- **File paths** — any relevant files the expert should reference (if applicable)

The prompt should be fully self-contained so the sub-agent can answer without additional context.

### 3. Spawn Sub-Agent
Use the `task` tool with these **strict parameters**:

```
task(
  agent_type: "general-purpose",
  model: "gemini-3-pro-preview",
  description: "Expert check: <short summary>",
  prompt: "<compiled prompt from step 2>"
)
```

**Important:** Always use `gemini-3-pro-preview` as the expert model unless the user explicitly requests a different model.

### 4. Report Results
When the sub-agent returns:
1. Present the response to the user as the **"Expert Opinion"**
2. Format the response clearly, preserving any code blocks or structured output
3. Attribute the answer to the expert model used

**Example output format:**
```
**Expert Opinion** (via Gemini 3 Pro):

<sub-agent response>
```

## Error Handling

| Failure Mode | Action |
|--------------|--------|
| Sub-agent times out | Report the timeout and ask if user wants to retry with a simplified query |
| Sub-agent returns error | Report the error and offer to retry or escalate |
| Ambiguous user query | Ask the user to clarify what they want checked |

## Notes
- This skill is for **reasoning and analysis** tasks, not for code execution or file manipulation
- The sub-agent session is ephemeral and deleted after returning results
- Cost-conscious: only use when the user explicitly triggers the skill
