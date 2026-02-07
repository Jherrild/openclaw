# USER.md - About Your Human

- **Name:** Jesten
- **What to call them:** Jesten
- **Pronouns:** He/Him
- **Timezone:** America/Los_Angeles
- **Location:** Freeland, Whidbey Island, WA (House on 5 acres).
- **Physical Traits:** 5'11", red hair.
- **Neurodiversity:** ADHD, likely Autistic (self-identified).
- **Accounts:**
  - `jestenh@gmail.com` (Personal - Primary for Magnus use)
  - `jesten.herrild@gmail.com` (Professional - Rarely/never used by Magnus)
- **Career:**
  - Current: Software Engineer at GitHub.
  - History: Expedia -> Microsoft -> VMware (Broadcom) -> GitHub.
  - Education: Western Washington University (WWU), 2012-2016.
- **Community:** Member of the Home Owners Board for "Ridge View Estates". 
  - **Filing Rule:** Categorize Ridge View Estates items under 'Home'.
- **Notes:** Connected via Telegram (id:5918274686).
- **Preferences:** limited token budget; prefers efficient, concise, but complete communication.
- **Organization:** Uses PARA (Projects, Areas, Resources, Archive) structure.
- **Notes:**
  - Always add relevant tags to new notes.
  - Use tags as an extra dimension when searching.
  - **Distraction Graveyard:** When Jesten mentions an idea or task to "put in the graveyard," log it to `2-Areas/Distraction Graveyard.md` in Obsidian with tags `#work`, `#ADHD`, `#focus`. This allows him to stay on his current deep work without losing the thought.
- **Auto-Save Rule:** If Jesten says "Save this for me" or "Remember this for me," create/update an Obsidian note. 
  - **Tooling:** MUST use the `obsidian-scribe` skill (`scribe_save`, `scribe_append`, `scribe_move`, `scribe_archive`) for all file operations. Do not use generic `write` or `edit`.
  - Use PARA structure (1-Projects, 2-Areas, 3-Resources, 4-Archives) to determine the best location.
  - **Search First:** Always use the `local-rag` skill to try and find existing relevant notes before creating a new one.
  - **Confirmation:** 
    - If a relevant note exists, ASK if it should be updated or if a new note should be created- propose the location of the new note in case the user picks that, so they know where it will go.
    - If no relevant note exists, create the new one and notify Jesten.
  - **Safety:** NEVER delete notes or content within a note without explicit permission.
  - **Knowledge Preservation:** Obsidian is a repository for knowledge. Knowledge should not be deleted, just organized.
    - **Never Delete:** Do not delete notes to "clean up."
    - **Archive Instead:** If a note is obsolete, move it to `4-Archive/`.
    - **Refactor > Overwrite:** When information changes, append updates or refactor the note to preserve history. Do not blow away old context unless it is strictly incorrect/harmful, and you confirm with Jesten first.
  - **Organization:** When updating, don't just append. Choose an appropriate section, header, and format. Propose structural improvements if the existing organization is getting messy.
  - Use message context for naming, location, and tags.
  - Include any attached images.
  - Ask for clarification if the destination or metadata is ambiguous.
- **Time-Sensitive Files (Bills/Deadlines):**
  - **Trigger:** When filing a document (via `obsidian-scribe`) that has a due date or deadline (e.g., Bills, RSVP, Forms).
  - **Action:** Create a Google Task for the deadline.
  - **Target List:** Use the "Personal" list (ID: `MDk1NTEwMDE1MDAxMTI5NTQxNjQ6MDow`) by default. If you can't find that list, ask the user which one you should use, and update this document.

- **Silent Document Trigger:**
  - **Trigger:** Jesten sends an image (or file) with **no text** (or minimal text).
  - **Exception (ZIP Files):**
    - If the file is a `.zip`:
      1.  **Unpack & Inspect:** Unpack to a temp dir and list contents (structure/types) in the Main Session.
      2.  **STOP:** Do NOT auto-file or delegate yet.
      3.  **ASK:** Report the contents and ask for instructions (e.g., "File in Obsidian", "Extract to Repos", "Analyze code").
  - **Assumption (Non-ZIP):** He wants it filed.
  - **Action (Non-ZIP):**
    1.  **STOP:** Do not call `image` or `read` in the Main Session.
    2.  **DELEGATE:** Immediately `sessions_spawn` a sub-agent. Pass the file path(s) to the sub-agent.
    3.  **Instruct:** Tell the sub-agent to:
        *   Analyze the document (OCR/Read).
        *   Determine the PARA destination.
        *   Draft the `scribe_save` content (with tags/metadata).
    4.  **Execute:** Use the sub-agent's response to file the note (or let the sub-agent do it if capable).
    5.  If it has a deadline, execute the **Time-Sensitive Files** rule (offer task).

- **Tasks:**
  - `Personal`: Personal priorities (Default).
  - `Work`: Job-related items.

## Context

-Addressed me as "Magnus" immediately.

---
