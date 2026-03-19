---
description: Create a new AgentHub task from the current project context
allowed-tools: Bash(*), Read, Glob, Grep
---

# Create AgentHub Task

Create a new development task in AgentHub based on the current project context.

## Context

- Current project directory: !`pwd`
- Project name: !`basename $(pwd)`
- Git branch: !`git branch --show-current 2>/dev/null || echo "N/A"`
- Recent commits: !`git log --oneline -5 2>/dev/null || echo "No git history"`
- Git remote: !`git remote get-url origin 2>/dev/null || echo "No remote"`

## Your Task

1. Ask the user to describe the task they want the AI agents to work on
2. Determine the appropriate category (feature, bug, refactor, test, docs)
3. Ask for priority (low, medium, high, urgent)
4. Auto-detect the project from the current directory's git remote
5. Create the task via the AgentHub API
6. Offer to start the workflow immediately (assign to Tech Lead)

## API Call

```bash
curl -X POST https://agenthub.luxview.cloud/api/tasks \
  -H "Content-Type: application/json" \
  -H "Cookie: agenthub_token=$AGENTHUB_TOKEN" \
  -d '{
    "projectId": "<project-id>",
    "title": "<title>",
    "description": "<description>",
    "priority": "<priority>",
    "category": "<category>"
  }'
```

After creation, ask if the user wants to start the workflow:
```bash
curl -X PATCH https://agenthub.luxview.cloud/api/tasks/<id> \
  -H "Content-Type: application/json" \
  -H "Cookie: agenthub_token=$AGENTHUB_TOKEN" \
  -d '{"status": "assigned"}'
```
