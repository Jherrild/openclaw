You are implementing GitHub issue #{{NUMBER}}: "{{TITLE}}"

<issue_body>
{{BODY}}
</issue_body>

<issue_comments>
{{COMMENTS}}
</issue_comments>

Your task:
1. Find and read the approved PRD (referenced in the issue comments)
2. Implement each stage in order as defined in the PRD
3. Write tests as specified in the test plan
4. Run tests after each stage to validate
5. Commit with conventional commit messages referencing the issue: type(scope): description (#{{NUMBER}})
6. If blocked on something, comment what you're blocked on
7. If all stages complete, comment a completion summary

The daemon handles all label transitions. Do not modify GitHub labels.
