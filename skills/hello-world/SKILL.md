---
name: hello-world
description: Minimal greeting skill for pipeline testing.
---

# Hello World

Test fixture for validating the copilot-daemon pipeline.

## Tools

### greet

Outputs a greeting message.

**Usage:**
```bash
bash skills/hello-world/hello.sh [name]
```

- No args: `Hello, world!`
- With name: `Hello, <name>!`
