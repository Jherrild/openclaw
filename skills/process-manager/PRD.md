# PRD: Process Manager Skill

## 1. Goal
Provide a reliable, token-efficient mechanism for running long-running or high-output shell commands in the background. The primary goal is to **prevent context pollution** in the Main Session by capturing stdout/stderr to files and notifying the agent only upon completion (or failure) via the `interrupt-service`.

## 2. Problem Statement
Current "heavy" operations (e.g., `npm install`, `find /`, large builds) risk:
1.  **Token Bloat:** Streaming thousands of lines of output directly into the LLM context.
2.  **Timeout:** Long-running commands blocking the agent's execution loop.
3.  **Fragility:** Manual `nohup` / `&` wrapper scripts are prone to syntax errors and losing exit codes.

## 3. Core Features

### 3.1. `run_background`
*   **Purpose:** Execute a shell command detached from the current session.
*   **Inputs:**
    *   `command` (string): The shell command to run.
    *   `label` (string): Human-readable name for the job (e.g., "npm-install").
    *   `notify` (boolean, default=true): Whether to register a one-time interrupt on completion.
*   **Mechanism:**
    1.  Generates a unique `jobId`.
    2.  Wraps the command to redirect `stdout` and `stderr` to `/tmp/openclaw/logs/<jobId>.log`.
    3.  Captures the exit code.
    4.  Writes metadata (pid, start_time, status) to a registry file (`jobs.json`).
    5.  (If notify=true) Calls `interrupt-cli.js add` to wake the agent when the process exits.
*   **Returns:** `{"jobId": "...", "logPath": "...", "pid": 1234}`

### 3.2. `check_job`
*   **Purpose:** safely inspect the status and recent output of a background job.
*   **Inputs:**
    *   `jobId` (string): The ID returned by `run_background`.
    *   `lines` (number, default=20): Number of tail lines to return.
*   **Returns:**
    *   Status: `running` | `success` | `failed`
    *   Exit Code: (if done)
    *   Output: Last N lines of the log file.

### 3.3. `list_jobs`
*   **Purpose:** See what's currently running or recently finished.
*   **Returns:** Array of active/recent jobs with status and timestamps.

### 3.4. `kill_job`
*   **Purpose:** Terminate a runaway process.
*   **Inputs:** `jobId`.

## 4. Technical Architecture
*   **Language:** Node.js (consistent with other skills).
*   **Storage:**
    *   Logs: `/tmp/openclaw/logs/*.log` (auto-cleaned on reboot).
    *   Registry: `/home/jherrild/.openclaw/process-manager/registry.json`.
*   **Dependencies:**
    *   `interrupt-service` (for notifications).
    *   Standard Node `child_process` (spawn/exec).

## 5. Success Criteria
*   **Zero Bloat:** Running a verbose build command adds <200 tokens to the context (just the ack + job ID).
*   **Reliable Alerts:** The agent receives a "Job Complete" message immediately when the background process finishes.
*   **Debuggable:** The agent can retrieve specific error lines (`check_job`) without reading the whole log.

## 6. Integration
*   **Agent Policy:** Update `AGENTS.md` to mandate `process-manager` for any task expected to take >10s or generate >50 lines of output.

## Review Notes (2026-02-14)

- **Structure:** Strong with clean API design.
- **Missing:** Registry cleanup policy (jobs.json unbounded growth). No retry/timeout for failed jobs. Missing log rotation for /tmp/openclaw/logs/.
- **Recommendation:** Should merge INTO task-orchestrator as a `run-bg` subcommand. Add jobs.json max size + rotation policy. Add configurable timeout per job. Define log cleanup strategy.
