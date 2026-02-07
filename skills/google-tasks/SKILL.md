---
name: google-tasks
description: Manage Google Tasks (add, list, complete) via local CLI.
---

# Google Tasks

Manage personal tasks and to-do lists via the Google Tasks API.

## Configuration
- **Script Path:** `/home/jherrild/.openclaw/workspace/skills/google-tasks/tasks.js`
- **Authentication:** Uses `token.json` and `credentials.json` in the skill directory.
- **Lists:**
  - `Magnus` (Default): `b2xkekpoaGszZzFUNFZ1RA`
  - `Personal`: `MDk1NTEwMDE1MDAxMTI5NTQxNjQ6MDow`
  - `Work`: `V0tyRmRxX3NwTURmb2V2TA`

## Tools

### tasks_add
Create a new task (simple titles only).
For titles with special characters (`$`, `!`, `"`, `'`), use `tasks_add_base64` instead.

**Usage:**
```bash
node /home/jherrild/.openclaw/workspace/skills/google-tasks/tasks.js add "Call Mom" "<listId>"
```

### tasks_add_base64 (Robust)
Create a new task using a Base64-encoded title. Use this for ANY title containing special characters (`$`, `!`, etc.) to avoid shell issues.

**Parameters:**
- `base64_title`: The Base64 encoded title string.
- `listId`: (Optional) List ID.
- `due`: (Optional) RFC 3339 timestamp.

**Usage:**
1. Base64 encode the RAW string (do NOT escape special chars).
2. Call script with `add-base64`.

```bash
# Example: "Pay $100 Bill!"
# 1. Encode
TITLE_B64=$(echo -n "Pay $100 Bill!" | base64 -w 0)
# 2. Add
node /home/jherrild/.openclaw/workspace/skills/google-tasks/tasks.js add-base64 "$TITLE_B64" "<listId>" "<due>"
```

### tasks_list
List pending tasks in a specific task list.

**Parameters:**
- `listId`: The list ID to fetch tasks from.

**Usage:**
```bash
node /home/jherrild/.openclaw/workspace/skills/google-tasks/tasks.js list "<listId>"
```

### tasks_lists
List all available task lists.

**Usage:**
```bash
node /home/jherrild/.openclaw/workspace/skills/google-tasks/tasks.js lists
```

### tasks_complete
Mark a task as completed.

**Parameters:**
- `taskId`: The ID of the task to complete.
- `listId`: The ID of the list containing the task.

**Usage:**
```bash
node /home/jherrild/.openclaw/workspace/skills/google-tasks/tasks.js complete "<taskId>" "<listId>"
```
