# label-printer Efficiency PRD

## Problem
SKILL.md is 800 chars but ~60% is placeholder boilerplate. The printer IP is `TO_BE_CONFIGURED`, the setup steps are generic, and there are no real usage examples beyond a single hardcoded command. The skill appears minimally implemented.

## Proposed Changes
1. **Remove `TO_BE_CONFIGURED` placeholder** — either populate the real IP from the network or add a discovery command: `brother_ql discover`.
2. **Consolidate Configuration + Setup + Usage into Quick Start** — reduce from 3 sections to 1: printer model, label size, venv path, and a single usage example.
3. **Replace generic setup with actionable commands** — the current "Install dependencies" and "Connect printer" steps are too vague. Either provide the exact setup script or link to brother_ql docs.
4. **Add practical examples** — address labels, inventory labels, QR code labels (if supported). Without examples, Magnus doesn't know what's possible.
5. **Keep minimal if unused** — if the printer isn't actively used, reduce to ~400 chars: frontmatter + model + one usage command.

## Expected Impact
- Current: 800 chars (~200 tokens)
- Option A (expand): ~800 chars with useful content replacing boilerplate
- Option B (minimize): ~400 chars (~100 tokens, 50% reduction)
- Recommendation: Option B until printer IP is configured and skill is actively used.

## Bugs / Errors Found
- **`TO_BE_CONFIGURED` in production SKILL.md** — Magnus will read this every time and can't actually use the skill. Either configure or disable.
- **Hardcoded IP in usage example (`192.168.1.50`)** contradicts the "TO_BE_CONFIGURED" in Configuration — inconsistent state.
- **No `config.json` exists** — Setup step 3 says "Update `config.json` with Printer IP" but no config.json file is referenced or created anywhere.
- **venv may not exist** — usage references `skills/label-printer/venv/bin/python3` but no setup verification step confirms the venv was created.
