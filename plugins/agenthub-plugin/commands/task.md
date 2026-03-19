---
description: Create a new AgentHub Local task from the current project context
allowed-tools: Bash(*), Read, Glob, Grep
---

# Create Task in AgentHub Local

Create a development task for the AI agents to execute on the current project.

## Context

- Project directory: !`pwd`
- Project name: !`basename $(pwd)`
- Git branch: !`git branch --show-current 2>/dev/null || echo "N/A"`
- Recent commits: !`git log --oneline -5 2>/dev/null || echo "No git history"`

## Your Task

1. **Check server is running:**
```bash
curl -s http://localhost:4200/api/health 2>/dev/null || echo "NOT_RUNNING"
```

2. **Find or create the project** in AgentHub Local. Check if current directory is already imported:
```bash
curl -s "http://localhost:4200/api/projects" 2>/dev/null
```
Look for a project with the matching path. If not found, import it first.

3. **Ask the user** what they want the agents to build/fix. Get:
   - Title (short description)
   - Description (detailed context)
   - Priority (low/medium/high/urgent)
   - Category (feature/bug/refactor/test/docs)

4. **Create the task:**
```bash
curl -s -X POST http://localhost:4200/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "<project-id>",
    "title": "<title>",
    "description": "<description>",
    "priority": "<priority>",
    "category": "<category>"
  }'
```

5. **Show the created task** and ask if the user wants to start the workflow (assign to Tech Lead):
```bash
curl -s -X PATCH http://localhost:4200/api/tasks/<id> \
  -H "Content-Type: application/json" \
  -d '{"status": "assigned"}'
```

Always confirm the task details before creating.
