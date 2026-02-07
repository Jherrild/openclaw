---
name: google-docs
description: Access and manage Google Documents. Use this skill to create, read, search, and append content to Google Docs.
---

# Google Docs

## Overview
This skill allows Magnus to interact with your Google Docs account using the Google Docs and Drive APIs. It reuses authentication from the `google-tasks` skill.

## Task-Based Usage

### Search for a Document
```bash
export NODE_PATH=$NODE_PATH:/home/jherrild/.openclaw/workspace/skills/google-tasks/node_modules
node scripts/docs.js search "Meeting Notes"
```

### Read a Document (Plain Text)
```bash
export NODE_PATH=$NODE_PATH:/home/jherrild/.openclaw/workspace/skills/google-tasks/node_modules
node scripts/docs.js get <document_id>
```

### Create a New Document
```bash
export NODE_PATH=$NODE_PATH:/home/jherrild/.openclaw/workspace/skills/google-tasks/node_modules
node scripts/docs.js create "New Project Doc"
```

### Append Content to a Document
```bash
export NODE_PATH=$NODE_PATH:/home/jherrild/.openclaw/workspace/skills/google-tasks/node_modules
node scripts/docs.js append <document_id> "Additional notes..."
```

## Resources

### scripts/
- `docs.js`: Main CLI tool for interacting with the Google Docs and Drive APIs.
