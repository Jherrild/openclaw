# PRD: Hello World Skill

> **Last updated:** 2026-02-15
> **Status:** Draft
> **GitHub Issue:** Jherrild/openclaw#1

## Problem Statement

The copilot-daemon pipeline needs a minimal, trivial skill to validate the full issue-to-implementation workflow. No existing skill is simple enough to serve as a pipeline test fixture without risking side effects.

## Proposed Approach

Create a `hello-world` skill with the absolute minimum footprint:
- `SKILL.md` with proper YAML frontmatter (so OpenClaw discovers it)
- A single shell script that outputs `Hello, world!`
- A smoke test that verifies the script runs and produces expected output

This skill has no dependencies, no auth, no external APIs, and no state. It exists purely to validate that:
1. A skill can be created with correct structure
2. The agent can discover and invoke it
3. The copilot-daemon pipeline can process an issue end-to-end

## Implementation Stages

### Stage 1: SKILL.md with Frontmatter

Create `skills/hello-world/SKILL.md` with:
- YAML frontmatter (`name: hello-world`, `description: ...`)
- H1 title
- Single tool definition (`greet`) with usage example

**Test:** Verify frontmatter parses correctly:
```bash
head -5 skills/hello-world/SKILL.md | grep -q "^name: hello-world"
```

### Stage 2: Greeting Script

Create `skills/hello-world/hello.sh`:
- Outputs `Hello, world!` to stdout
- Exits 0
- Accepts an optional name argument: `hello.sh [name]` → `Hello, [name]!`

**Test:** Run script and verify output:
```bash
bash skills/hello-world/hello.sh
# Expected: Hello, world!
bash skills/hello-world/hello.sh Magnus
# Expected: Hello, Magnus!
```

### Stage 3: Smoke Test

Create `skills/hello-world/test.sh`:
- Runs `hello.sh` with no args, verifies output is `Hello, world!`
- Runs `hello.sh` with a name arg, verifies output contains the name
- Exits 0 on pass, 1 on failure

**Test:** Run the test itself:
```bash
bash skills/hello-world/test.sh
```

## Alternatives Considered

| Alternative | Verdict | Rationale |
|-------------|---------|-----------|
| Use an existing skill as test fixture | Rejected | All existing skills have external dependencies (APIs, auth, Obsidian vault). Too complex for pipeline validation. |
| GitHub Actions-only test (no skill) | Rejected | Doesn't validate the skill discovery/frontmatter path which is the main thing being tested. |
| Node.js script instead of shell | Rejected | Shell is simpler, zero dependencies. This skill is throwaway — no need for Node.js consistency. |
| Python script | Rejected | Same reasoning as Node.js. Shell is the simplest option for `echo`. |
| MCP server integration | Rejected | Massive overkill for a greeting. MCP servers are for real tool integration. |

## Dependencies

None. This skill is fully self-contained.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Skill pollutes agent context | Low | Description is one line; minimal token cost. Can remove after pipeline validation. |
| Frontmatter format wrong | Low | Follow exact format from OPENCLAW_SKILL_DEV_GUIDE.md. Verified by smoke test. |

## Design Decisions

**Q: Should this skill persist after pipeline validation?**
A: It can be archived or removed once the daemon pipeline is confirmed working. It has no ongoing value beyond testing.

**Q: Shell vs Node.js?**
A: Shell. The codebase convention is Node.js for real skills, but this is a test fixture. `echo` is the right tool for `echo`.

## Still TODO

- [ ] Implement Stage 1 (SKILL.md)
- [ ] Implement Stage 2 (hello.sh)
- [ ] Implement Stage 3 (test.sh)
- [ ] Validate pipeline end-to-end
- [ ] Decide whether to keep or archive post-validation
