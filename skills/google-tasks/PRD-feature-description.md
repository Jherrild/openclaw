# PRD: Google Tasks Description Support

## Goal
Update the `google-tasks` skill (`tasks.js`) to support adding descriptions (notes) to tasks.

## Requirements

1.  **Update `tasks.js`**:
    -   Modify the `add` command to accept an optional `notes` argument.
    -   Modify the `add-base64` command to accept an optional `notes` argument (also base64 encoded to avoid shell issues).
    -   Update the `addTask` function to include the `notes` field in the Google Tasks API request body.

2.  **Command Signatures**:
    -   `add`: `node tasks.js add <title> [listId] [due] [notes]`
    -   `add-base64`: `node tasks.js add-base64 <base64_title> [listId] [due] [base64_notes]`

3.  **Implementation Details**:
    -   In `addTask(auth, title, listId, due, notes)`:
        -   Add `notes: notes` to `requestBody`.
    -   In `main()`:
        -   Parse the new `notes` argument from `process.argv` for both `add` and `add-base64`.
        -   For `add-base64`, decode the notes from Base64 before passing to `addTask`.

4.  **Verification**:
    -   Ensure existing functionality (adding without notes) still works.
    -   Ensure `listTasks` displays notes if present (optional but helpful for verification).

## Constraints
-   Maintain backward compatibility with existing calls that omit the notes argument.
-   Use standard `process.argv` parsing as currently implemented.
