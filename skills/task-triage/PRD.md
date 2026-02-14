# PRD: Auto-Triage & Prioritization Skill

## 1. Goal
Transform the user's task list from a "write-only" graveyard into an actionable, high-signal feed. The agent will autonomously review, tag, and prioritize tasks based on context, deadlines, and user goals ("North Stars"), ensuring the user is nudged only about what truly matters.

## 2. Problem Statement
*   **Volume:** The user adds tasks frequently but rarely reviews the full list.
*   **Noise:** High-value tasks get buried under low-value ideas or "someday" items.
*   **Static:** Tasks don't age out or escalate automatically.
*   **Blindness:** The current agent behavior ("here are a few tasks") lacks intelligence on *which* tasks to show.

## 3. Core Features

### 3.1. The "Triage Officer" (Batch Job)
*   **Function:** A daily (or on-demand) sub-agent run that reads *all* tasks.
*   **Analysis:** It evaluates each task against a rubric:
    *   **Urgency:** Is there a hard deadline?
    *   **Strategic Fit:** Does this align with current active projects (e.g., Solar, WearOS Rower)?
    *   **Quick Win:** Is this a <5 min task?
    *   **Stale:** Has this sat for >30 days with no movement?
*   **Action:** It updates the task title/notes with tags:
    *   `[P0]` (Critical/Today)
    *   `[P1]` (This Week)
    *   `[P2]` (Backlog)
    *   `[Stale]` (Candidate for deletion/archive)

### 3.2. Context-Aware Nudges (Heartbeat)
*   Instead of random reminders, the agent checks the `[P0]` and `[P1]` tags.
*   **Morning Briefing:** "Here are your 3 Priority goals for today."
*   **Focus Mode:** If the user is working on "Solar", the agent suppresses "Rower" tasks but highlights "Order Solar Inverter".

### 3.3. The "Graveyard" Protocol
*   If a task is marked `[Stale]` for >2 cycles, the agent proposes: "Move these 5 stale tasks to Obsidian Archive?"
*   This keeps the active Google Tasks list clean (under ~50 items).

## 4. Technical Architecture
*   **Skill Name:** `task-triage`
*   **Inputs:** Google Tasks API (Personal & Work lists).
*   **Context:** `1-Projects` folders in Obsidian (to understand what is "Active").
*   **Logic:** LLM-based classification (Gemini Flash for cost efficiency).
*   **Output:** Updates to Google Task fields (adding prefixes/tags) + Chat Report.

## 5. Success Criteria
*   **Review Rate:** User engages with the "Morning Briefing" >50% of the time.
*   **List Hygiene:** Active Google Tasks list stays under 50 items.
*   **Alignment:** Nudges match the user's current project focus.

## Review Notes (2026-02-14)

- **Structure:** Weak — missing technical architecture, CLI/API design, implementation phases.
- **Missing:** Schema for priority rules (how is "urgency" evaluated?). Conflict resolution for parallel user edits. Concrete success criteria.
- **Recommendation:** Should merge INTO google-tasks as a `triage` subcommand. Define priority evaluation algorithm. Add concrete schema for P0/P1/P2 classification rules. Strengthen success criteria.
