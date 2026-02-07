# TOOLS.md - Local Notes

### Obsidian
- Vault Path: `/mnt/c/Users/Jherr/Documents/remote-personal` (WSL)
- Windows Path: `C:\Users\Jherr\Documents\remote-personal`

### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod

### 1Password (Service Account)
- **Identity File:** `/home/jherrild/.openclaw/workspace/.magnus_op_auth`
- **Vault:** "Magnus Agent Vault"
- **Instructions:** Always `source` the identity file to authenticate the `op` CLI in new sessions. Never store the token in plaintext outside this ignored file.
- **Path:** `/home/jherrild/.openclaw/workspace/skills/google-tasks/tasks.js`
- **Lists:**
  - Magnus: `b2xkekpoaGszZzFUNFZ1RA`
  - Personal: `MDk1NTEwMDE1MDAxMTI5NTQxNjQ6MDow`
- **Commands:**
  - `node tasks.js lists`
  - `node tasks.js add "Title" <listId>`
  - `node tasks.js list <listId>`
