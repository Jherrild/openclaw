# PRD: Kanban Board Integration (Project Tracking)

## 1. Goal
Provide a visual, flow-based view of work-in-progress (WIP) for tasks discussed with or delegated to the agent. Enable the user to see "What is Magnus doing?" and "What is waiting on me?" at a glance.

## 2. Problem Statement
*   **Invisible Work:** Sub-agent tasks, coding delegations, and "later" promises often vanish into the chat history.
*   **No State:** It's unclear if a task is "In Progress", "Blocked", or "Ready for Review" without asking.
*   **Disconnect:** Google Tasks is a flat list; it doesn't represent the *workflow* or *lifecycle* of a complex project.

## 3. Proposed Solution: GitHub Projects (Integration)
*   **Why GitHub?**
    *   User works at GitHub (familiarity).
    *   Robust CLI (`gh`) already installed.
    *   Excellent API for automation.
    *   Supports custom fields (Status, Priority, Size).
    *   Can link to actual code/PRs (unlike Trello/Obsidian).

## 4. Core Features

### 4.1. Board Structure
*   **Columns:**
    1.  **Inbox/Triage:** New ideas or requests from chat.
    2.  **Backlog:** Accepted work, prioritized but not started.
    3.  **In Progress:** Agent or User currently working.
    4.  **Blocked/Waiting:** Waiting on external factor or User reply.
    5.  **In Review:** PRs open or awaiting approval.
    6.  **Done:** Completed.

### 4.2. Agent Interaction
*   **Auto-Create:** When a user says "Plan out the Rower project", the agent creates a "Project" item and breaks it down into "Issues" in the Inbox.
*   **Auto-Move:**
    *   When `copilot-delegate` starts -> Move card to **In Progress**.
    *   When `copilot-delegate` finishes -> Move card to **In Review**.
    *   When user says "I checked it, looks good" -> Move card to **Done**.
*   **Status Report:** "Show me the board" renders a text-based summary of columns.

### 4.3. Bi-Directional Sync (Advanced)
*   If the user drags a card to "Done" in the UI, the agent knows the task is complete.
*   If the agent hits a rate limit, it moves the card to "Blocked".

## 5. Technical Architecture
*   **Tooling:** `gh project` CLI extensions.
*   **Target:** A dedicated private repository (e.g., `jherrild/magnus-tasks`) or a User Project.
*   **Skill Name:** `kanban-sync`
*   **Mapping:** 
    *   Google Tasks = "Personal To-Dos" (buy milk, call mom).
    *   GitHub Board = "Project Work" (code, build solar, research).

## 6. Success Criteria
*   **Visibility:** User stops asking "What are you working on?" and checks the board.
*   **Flow:** Tasks move from Inbox to Done with clear state transitions.
*   **Capture:** No "we discussed this" items are lost; they land in Inbox.

## Review Notes (2026-02-14)

- **Structure:** Moderate — missing implementation phases and technical detail.
- **Missing:** Bi-directional sync conflict resolution. API error handling / rate limit policy. No timeline or phases.
- **Recommendation:** Add phased implementation plan. Define conflict resolution (agent wins? UI wins? merge?). Add GitHub API rate limit handling. Keep separate from task-triage.
