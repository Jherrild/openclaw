---
name: google-home-bridge
description: Bridge between Google Home voice commands (via IFTTT) and Magnus through Home Assistant events and the interrupt service.
---

# Skill: Google Home Bridge

This skill provides a bridge between Google Home (via IFTTT) and Magnus.

## Architecture

1.  **IFTTT**: Listens for "Tell Magnus [message]" voice commands.
2.  **Webhook**: IFTTT sends a POST request to Home Assistant (`/api/webhook/magnus-voice-bridge`).
3.  **Home Assistant**: 
    - The `automation_magnus_webhook.yaml` automation receives the webhook.
    - It extracts the `message` payload.
    - It fires a `magnus_voice_command` event on the HA Event Bus.
4.  **HA Bridge (OpenClaw)**:
    - `ha-bridge.js` subscribes to `magnus_voice_command`.
    - When received, it triggers the Interrupt Manager with entity `magnus.voice_command`.
5.  **Interrupt Manager**:
    - Matches the `magnus.voice_command` event against registered persistent interrupts.
    - Spawns a sub-agent to handle the voice command.

## Setup

### 1. Home Assistant
Copy `ha_config/automation_magnus_webhook.yaml` to your HA `automations.yaml` or include it.

### 2. IFTTT
Create an applet:
- **If**: Google Assistant "Say a phrase with a text ingredient" ("Tell Magnus $").
- **Then**: Webhooks "Make a web request".
  - URL: `https://<your-ha-url>/api/webhook/magnus-voice-bridge`
  - Method: POST
  - Content Type: application/json
  - Body: `{"message": "{{TextField}}"}`

### 3. OpenClaw Configuration
Ensure `magnus.voice_command` is registered as a persistent interrupt in the interrupt-service:
```bash
node skills/interrupt-service/interrupt-cli.js add \
  --source ha.state_change \
  --condition '{"entity_id":"magnus.voice_command"}' \
  --action message \
  --message "{{new_state}}" \
  --label "🦁 Voice" \
  --skip-validation
```
