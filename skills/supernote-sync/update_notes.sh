#!/bin/bash
SKILL_DIR="/home/jherrild/.openclaw/workspace/skills/supernote-sync"
while IFS= read -r note; do
  fileId=$(echo "$note" | jq -r '.fileId')
  name=$(echo "$note" | jq -r '.name')
  text=$(echo "$note" | jq -r '.text')
  
  # Prepare markdown content
  content="---
tags: [supernote]
source: supernote-sync
fileId: $fileId
---

# $name

![[documents/$name.pdf]]

---

$text"

  # Use store_markdown.js to generate the .md file in the buffer
  node "$SKILL_DIR/store_markdown.js" --file-id "$fileId" --content "$content"

done < <(node "$SKILL_DIR/get_updated_notes.js" | jq -c '.[]')
