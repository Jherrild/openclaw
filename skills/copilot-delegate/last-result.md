# Result: Configurable Notification Channels for Interrupts

**Status:** ✅ Complete  
**Commit:** `feat(home-presence): configurable notification channels for interrupts`

## What Changed

Refactored the interrupt system to support configurable, validated notification channels. Each interrupt rule can now target a specific channel (e.g., `telegram`), with a `config.json` default and validation against live openclaw channel configuration.

### Files Created (2)

| File | Purpose |
|------|---------|
| `config.json` | Stores `default_channel` (initially `"telegram"`) |
| `manage-channel.js` | CLI utility to view/update default channel (`get`, `set`, `list-valid`) |

### Files Modified (4)

| File | Change |
|------|--------|
| `register-interrupt.js` | Added `--channel` flag; validates channel against `openclaw channels list --json`; `list` command displays resolved channel for each rule |
| `interrupt-manager.js` | Reads per-rule `channel`; resolves `"default"` to `config.json`'s `default_channel` at dispatch time; groups triggers by resolved channel for separate system events |
| `SKILL.md` | Added `channel` field to schema; documented channel config, `manage-channel.js` usage, and channel routing behavior |
| `prd/initial-design.md` | Added implementation status row; documented channel architecture, design choices, and TODO for future channels |

### How It Works

1. **Config:** `config.json` holds `"default_channel": "telegram"`. Managed via `manage-channel.js get/set/list-valid`.
2. **Registration:** `node register-interrupt.js persistent sensor.x --channel telegram` — validates channel against `openclaw channels list --json`. If `--channel` omitted, stores `"default"`.
3. **Dispatch:** `interrupt-manager.js` resolves `"default"` → `config.json`'s `default_channel` at dispatch time, groups triggers by channel, and sends separate system events with `[instruction: use message tool to notify user on '<channel>']`.
4. **Listing:** `list` command shows `[channel: telegram]` or `[channel: default (telegram)]` for each rule.

### Channel Validation

- Valid channels are the keys under `.chat` in the output of `openclaw channels list --json`.
- The special value `"default"` always passes validation and is resolved lazily at dispatch time.
- Use `--skip-validation` to bypass both entity and channel checks.

### Backward Compatibility

Fully backward-compatible. Existing rules without a `channel` field default to `"default"`, which resolves to `config.json`'s `default_channel` (`"telegram"`), preserving the previous hardcoded behavior.
