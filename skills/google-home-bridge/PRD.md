# PRD: Google Home to Magnus Voice Bridge

## Goal
Enable Jesten to speak to a Google Home device and have the transcribed message delivered to Magnus (OpenClaw).

## Architecture (v3 — IFTTT Webhook Bridge)

> **Why IFTTT instead of Google Assistant SDK or Routines?**  
> Investigation (2026-02-08) confirmed that:
> - The Google Assistant SDK integration is for sending commands FROM HA TO Google, not intercepting speech.
> - Google does not forward unrecognized commands to HA (Nabu Casa only maps pre-defined entities).
> - Google Home Routines cannot pass wildcard text into HA script fields.
> - **IFTTT** is the only current method to capture arbitrary voice text and relay it to HA via webhook.

1. **Google Home** — Jesten says *"Hey Google, tell Magnus I'm heading out"*.
2. **IFTTT Applet** — Trigger: "Tell Magnus $" captures the wildcard text.
3. **Webhook POST** — IFTTT POSTs `{"message": "I'm heading out"}` to the Nabu Casa webhook URL.
4. **HA Automation** — Triggers on webhook, strips any remaining prefix, forwards to REST command.
5. **REST Command** — POSTs the message to the OpenClaw system-event endpoint over Tailscale.

## Files

| File | Purpose |
|------|---------|
| `ha_config/automation_magnus_webhook.yaml` | **Primary** — Webhook automation for IFTTT bridge |
| `ha_config/rest_command_magnus.yaml` | REST command (merge into `/config/configuration.yaml`) |
| `ha_config/script_tell_magnus.yaml` | Fallback — Script for Google Home Routine preset messages |
| `ha_config/automation_magnus_message.yaml` | *(deprecated — kept for reference)* |
| `ha_config/custom_sentences_en_magnus.yaml` | *(deprecated — kept for reference)* |

## Setup Steps (Jesten)

### 1. Add the REST command
Merge `rest_command_magnus.yaml` into `/config/configuration.yaml` under the `rest_command:` key (if not already there).

### 2. Add the webhook automation
Append `automation_magnus_webhook.yaml` to `/config/automations.yaml`, or add via the HA UI.
Then reload automations (**Settings → Automations & Scenes → Automations → ⋮ → Reload automations**).

### 3. Expose the webhook via Nabu Casa
1. Go to **Settings → Home Assistant Cloud → Webhooks**.
2. Find `magnus-voice-bridge` and toggle it **ON**.
3. Copy the public URL (e.g., `https://hooks.nabu.casa/goog_XXXX/api/webhook/magnus-voice-bridge`).

### 4. Create the IFTTT applet
1. Sign in at [ifttt.com](https://ifttt.com).
2. **If This** → Google Assistant (V2) → "Say a phrase with a text ingredient".
   - Phrase: `Tell Magnus $`
   - Alt phrases: `Ask Magnus to $`, `Send Magnus $`
   - Response: `Message sent to Magnus`
3. **Then That** → Webhooks → Make a web request.
   - URL: *(paste the Nabu Casa webhook URL from Step 3)*
   - Method: POST | Content-Type: application/json
   - Body: `{"message": "{{TextField}}"}`
4. Save and enable.

### 5. Test
Say *"Hey Google, tell Magnus hello"*. Google should reply "Message sent to Magnus".
Check HA persistent notifications and the OpenClaw system-event log.

## Constraints
- Requires IFTTT account (free tier supports this use case).
- Requires Nabu Casa Cloud subscription for public webhook URL.
- REST command payload must be properly templated.
- Code should be clean and follow Home Assistant 2026.2.x standards.
