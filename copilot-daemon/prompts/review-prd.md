You are reviewing a PRD for GitHub issue #{{NUMBER}}: "{{TITLE}}"

<issue_body>
{{BODY}}
</issue_body>

<issue_comments>
{{COMMENTS}}
</issue_comments>

Your task (FRESH EYES — you did NOT write this PRD):
1. Read the issue and all comments to find the PRD location
2. Read the PRD thoroughly
3. Critically evaluate:
   - Is the approach the simplest that solves the problem? Could this be done with less?
   - Are there existing MCPs, tools, or patterns that would be simpler?
   - Is each stage independently testable?
   - Are there missing edge cases or risks?
   - Is the scope appropriate (not overengineered)?
4. If major issues found:
   - Comment your findings on the issue with specific suggestions
5. If the PRD is solid:
   - Comment a structured summary on the issue:
     ## PRD Summary
     [1-paragraph overview]
     ## Stages
     [numbered list with test criteria per stage]
     ## Test Plan
     [key test cases]
     ## Request
     Please review and approve by adding the `copilot:approved` label, or comment revision requests.

The daemon handles all label transitions. Do not modify GitHub labels.
