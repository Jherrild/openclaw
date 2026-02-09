# PRD: Refactor Voice Bridge to Interrupt-Driven Events

## Goal
Transition the "Tell Magnus" voice bridge from a direct REST command (which hit the gateway API) to an interrupt-driven event. This allows Magnus to handle voice commands as sub-agent tasks, following the new `home-presence` interrupt architecture.

## Context
Current architecture attempts to POST to the OpenClaw REST API directly from Home Assistant. This is fragile and bypasses the `ha-bridge` which is already listening to the HA event bus.

## Requirements

### 1. Home Assistant Refactor
- Update the "Tell Magnus" automation/script in Home Assistant to **NOT** call the `rest_command`.
- Instead, have it fire a custom event on the Home Assistant bus, or update an `input_text` helper.
- **Preferred Method:** Fire a custom event named `magnus_voice_command` with the `message` as event data.

### 2. Magnus (HA Bridge) Integration
- Update `ha-bridge.js` to listen for the `magnus_voice_command` event.
- When detected, the bridge should trigger a Magnus interrupt.

### 3. Interrupt Configuration
- Register a persistent interrupt for the voice command event.
- **Sub-agent Task Boilerplate:**
  - "I've received a voice command from Jesten via the Google Home bridge."
  - "Command: [MESSAGE]"
  - "Instructions: Analyze the command. If it's a request to file something, use obsidian-scribe. If it's a task, use google-tasks. If it's a general question, answer it. Reply back to the main session ONLY if you have a response for Jesten."

## Implementation Plan
1. **HA Side:** Update `skills/google-home-bridge/ha_config/automation_magnus_webhook.yaml` to fire an event instead of a REST command.
2. **Bridge Side:** Update `ha-bridge.js` to handle this specific event type (if not already covered by general state changes).
3. **Registration:** Use `register-interrupt.js` to create the persistent voice command handler.
