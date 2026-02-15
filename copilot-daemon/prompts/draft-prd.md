You are picking up GitHub issue #{{NUMBER}}: "{{TITLE}}"

<issue_body>
{{BODY}}
</issue_body>

Your task:
1. Read the issue description carefully
2. Find or create the relevant skill/project directory in the workspace
3. Draft a PRD in the project's prd/ subdirectory
4. The PRD must include:
   - Problem statement and proposed approach
   - Implementation stages (phased, each independently testable)
   - Test plan for each stage
   - Alternatives considered (existing MCPs, simpler approaches, system daemons, GitHub Actions)
   - Dependencies and risks
5. Comment on the issue with a brief summary of the PRD you created and where it lives
6. Do NOT implement anything — only draft the PRD

The daemon handles all label transitions. Do not modify GitHub labels.
