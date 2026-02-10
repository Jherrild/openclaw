# Priority Check Skill - Product Requirements Document (PRD)

## 1. Vision

A centralized, reusable service for evaluating the "semantic importance" of arbitrary text streams (Email, RSS, Logs, Discord) against a user-defined set of high-priority topics.

It decouples **collection** (dumb scripts) from **evaluation** (semantic filtering) and **action** (interrupts).

## 2. Core Components

### A. The Evaluator (`check.js`)
- **Input:** Text blob (e.g., "Email Subject: Nvidia Interview", "RSS: New CUDA Release").
- **Process:** Implements a "Filter Pyramid" strategy:
  1.  **Fast Layer (Keyword/Regex):** Checks for explicit string matches. Best for proper nouns/entities ("Nvidia", "Bitcoin"). Cost: 0.
  2.  **Semantic Layer (Embeddings):** Computes embedding of input text and compares cosine similarity against stored "Priority Interests". Best for concepts/intent ("Health", "Social", "Urgent"). Cost: Low (local model).
  3.  **Hybrid Layer:** Combines both signals (e.g., "Job Hunt" matches "Recruiter" keyword OR conceptually similar emails).
- **Output:** JSON object:
  ```json
  {
    "isPriority": true,
    "topic": "Nvidia",
    "score": 0.88,
    "matchType": "keyword", // or "semantic"
    "matched_keywords": ["nvidia"]
  }
  ```

### B. The Configuration (`priorities.json`)
- Stores user-defined interests with metadata for matching.
- **Structure:**
  ```json
  [
    {
      "id": "p-1",
      "topic": "Nvidia",
      "description": "News about Nvidia GPUs, stock, jobs, or Jensen Huang",
      "mode": "keyword", // "keyword", "semantic", or "hybrid"
      "keywords": ["nvidia", "geforce", "cuda", "jensen"],
      "embedding": [ ... ] // Pre-computed vector (null if mode=keyword)
    },
    {
      "id": "p-2",
      "topic": "Urgent Bills",
      "description": "Invoices, overdue notices, or payment confirmations",
      "mode": "hybrid",
      "keywords": ["invoice", "overdue", "payment", "bill"],
      "embedding": [ ... ]
    }
  ]
  ```

### C. The Manager (`manage.js`)
- **Add:** `add <topic> <description> --mode <mode> --keywords <list>`
  - Auto-generates embedding if mode is semantic/hybrid.
- **Remove:** `remove <topic>`.
- **List:** Show active priorities and their mode.
- **Tune:** Adjust thresholds per topic.

## 3. Integration Patterns

### Email Monitor (Example)
1.  **Collector:** `mail-sentinel.js` (cron) fetches unread headers.
2.  **Filter:** Calls `priority-check evaluate "<subject> <snippet>"`.
3.  **Action:**
    - If `isPriority: true` -> Trigger `interrupt-service` (Generic Interrupt).
    - If `isPriority: false` -> Log & Ignore.

### RSS / Discord / Logs
- Same pattern: Fetch -> Evaluate -> Interrupt.

## 4. Technical Stack
- **Runtime:** Node.js.
- **Embeddings:** Re-use `local-rag` logic (Ollama / `transformers.js` / OpenAI embeddings).
- **Storage:** JSON file (`priorities.json`).
- **Interface:** CLI for management & evaluation.

## 5. Iteration Questions
- **Embedding Source:** Should we rely on a local model (Ollama) for zero-cost, or an API (OpenAI/Gemini) for quality?
- **Feedback Loop:** How do we easily "mark as not important" to improve future filtering?
