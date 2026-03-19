---
description: Scan current directory for projects and import to AgentHub Local
allowed-tools: Bash(*), Read, Glob, Grep
---

# Scan & Import Projects to AgentHub Local

Scan the current working directory for development projects and import them to the local AgentHub server.

## Current Directory

- Path: !`pwd`

## Your Task

### Step 1: Ensure server is running
```bash
curl -s http://localhost:4200/api/health 2>/dev/null || echo "Server not running. Use /agenthub to start it first."
```

### Step 2: Use the scan API
```bash
curl -s -X POST http://localhost:4200/api/projects/scan -H "Content-Type: application/json" -d "{\"path\": \"$(pwd)\"}"
```

### Step 3: Show results as a table
Parse the JSON response and show each project with: Name, Stack, Git Remote.

### Step 4: Ask which projects to import
For each project the user wants to import, call:
```bash
curl -s -X POST http://localhost:4200/api/projects -H "Content-Type: application/json" -d '{"name": "<name>", "path": "<path>", "stack": "<stack_json>", "githubUrl": "<remote_or_null>"}'
```

### Step 5: Confirm imported projects
Show the list of imported projects with their IDs.

If the scan returns no projects, explain what project markers are looked for (package.json, go.mod, Cargo.toml, requirements.txt, etc.) and suggest checking the directory path.
