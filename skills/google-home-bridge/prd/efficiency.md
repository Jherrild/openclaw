# google-home-bridge Efficiency PRD

## Problem
SKILL.md is 1,830 chars with ~45% spent on architecture details that duplicate interrupt-service docs. The 5-step architecture walkthrough and interrupt registration example are reference material Magnus rarely needs on every read.

## Proposed Changes
1. **Collapse Architecture to 2 bullets** — `Voice command → IFTTT webhook → HA automation → ha-bridge → interrupt-service (entity: magnus.voice_command)`. Remove the 5 numbered steps.
2. **Move interrupt-service registration details** — the `interrupt-cli.js add` example at the end belongs in interrupt-service docs. Replace with: "Register `magnus.voice_command` as an interrupt rule (see interrupt-service SKILL.md)."
3. **Abbreviate IFTTT setup** — reduce to essentials: trigger phrase pattern, webhook URL, POST body format. Remove verbose sub-bullets.
4. **Merge HA and OpenClaw setup** — both are one-liners; combine into a single "Setup" section with 3 bullet points.

## Expected Impact
- Current: 1,830 chars (~460 tokens)
- Target: ~1,100 chars (~275 tokens)
- Savings: ~730 chars (~185 tokens per read, ~40% reduction)

## Bugs / Errors Found
- **No runtime script referenced** — SKILL.md describes architecture but never names a script to run or manage. Is `ha-bridge.js` (in home-presence) the runtime? If so, this skill is documentation-only and should state that explicitly.
- **No health check** — no way to verify the voice bridge pipeline is working end-to-end.
