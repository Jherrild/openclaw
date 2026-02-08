# Google Home → Magnus Voice Bridge — HA Config Files

## Setup Instructions

### 1. Custom Sentence (Intent Definition)
Copy `custom_sentences_en_magnus.yaml` to your HA config:
```
/config/custom_sentences/en/magnus.yaml
```
This registers the `MagnusMessage` intent with a `{message}` wildcard slot.

### 2. REST Command
Merge the contents of `rest_command_magnus.yaml` into your `/config/configuration.yaml`.
If you already have a `rest_command:` section, just add the `post_magnus_message` entry under it.

> **Note:** The URL uses the Tailscale node name `nr200p-1` on port `1337`. Update the hostname/port
> if your OpenClaw gateway is exposed differently.

### 3. Automation
Append the contents of `automation_magnus_message.yaml` to `/config/automations.yaml`,
or create it as a new automation via the HA UI.

### 4. Reload
After copying the files, reload HA config:
- **Settings → System → Restart** (full restart), or
- Call `homeassistant.reload_all` from Developer Tools → Services.

### Testing
Say to your Google Home:
> "Hey Google, tell Magnus I'm heading out"

Check the HA logs (`Settings → System → Logs`) to confirm the automation fired
and the REST command returned 200.
