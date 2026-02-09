# OpenClaw System Event Routing Review

## Diagnosis
The `openclaw system event` command injects a textual event into the agent's context and triggers a reasoning turn. However, system events do not carry a "reply-to" channel ID (unlike user messages). When the agent generates a response (plain text), the system has no destination for it, so it is dropped or logged internally.

## Recommendations

### 1. Do NOT bypass the agent (unless necessary)
Sending a direct message via `openclaw message` from `ha-bridge.js` would solve the delivery problem but bypasses the agent's intelligence (summarization, decision making, personality). Keep using `openclaw system event` to let Magnus decide *how* to respond.

### 2. Explicitly instruct the agent to route the response
Since the system event lacks routing metadata, you must provide it in the event text itself.

**Recommended Change:**
Modify `skills/home-presence/interrupt-manager.js` to append a standard routing instruction to all system events.

Change this line in `_dispatch(batch)`:
```javascript
const text = `home-presence interrupt: ${summaries.join(' | ')}`;
```
To:
```javascript
const text = `home-presence interrupt: ${summaries.join(' | ')} [instruction: use message tool to notify user on 'telegram']`;
```

### 3. Agent Policy (Mental Model)
The agent should be trained (via system prompt or skill documentation) that **"system events require explicit tool calls for output."**
- If the event comes from `ha-bridge`, the agent must use `message` (for chat) or `tts` (for speakers).
- Plain text responses to system events are effectively "internal monologue" and will not reach the user.

## Answers to Your Questions

1.  **Does OpenClaw support 'broadcast' or 'default channel' routing?**
    No. OpenClaw relies on the turn context. If the turn is triggered by a system event (which has no channel), there is no default fallback channel for plain text responses.

2.  **Should `ha-bridge.js` use the `message` tool directly?**
    Generally **no**, unless the alert is a simple "dumb" notification (e.g., "Door open") that requires no AI processing. For "home presence" where Magnus might want to greet someone or summarize multiple events, keep using `system event` but add the routing instruction.

3.  **Is it better to have the agent explicitly call the `message` tool?**
    **Yes.** This is the correct architectural pattern. The agent is the router. The system event provides the trigger and context; the agent decides the action (tool call) and destination. Explicitly telling the agent *where* to send the message (via the event text) ensures reliability.
