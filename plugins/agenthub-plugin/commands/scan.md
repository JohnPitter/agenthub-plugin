---
description: Scan current directory for projects and import to AgentHub
allowed-tools: Bash(*), Read, Glob, Grep
---

# Scan & Import Projects to AgentHub

Scan the current working directory for development projects and offer to import them to AgentHub.

## Current Directory

- Path: !`pwd`
- Contents: !`ls -la`

## Your Task

1. **Scan** each subdirectory for project markers:
   - `package.json` → detect React/Vue/Angular/Next/Express/etc from dependencies
   - `go.mod` → Go project
   - `Cargo.toml` → Rust project
   - `requirements.txt` / `pyproject.toml` → Python
   - `pom.xml` / `build.gradle` → Java
   - `.sln` / `.csproj` → .NET
   - `Dockerfile` → Docker

2. **Display** a formatted table showing:
   ```
   ┌─────────────────────┬──────────────────────┬─────────────────────────┐
   │ Project             │ Stack                │ Git Remote              │
   ├─────────────────────┼──────────────────────┼─────────────────────────┤
   │ my-app              │ React, TypeScript    │ github.com/user/my-app  │
   │ api-server          │ Express, PostgreSQL  │ github.com/user/api     │
   │ ml-pipeline         │ Python, PyTorch      │ (no remote)             │
   └─────────────────────┴──────────────────────┴─────────────────────────┘
   ```

3. **Ask** the user which projects to import to AgentHub

4. For each selected project, check if it has a GitHub remote:
   - If yes: import via `POST /api/projects/import` with owner/repo
   - If no: inform the user they need to push to GitHub first

5. Show results: imported projects with their AgentHub IDs

## Implementation

For each directory, read the relevant config file to detect the stack. Use `git remote -v` to get the GitHub URL. Parse the owner/repo from the remote URL.

Do NOT import:
- Hidden directories (starting with .)
- `node_modules`, `dist`, `build`, `.git`
- Directories without any project marker

Show the scan results and ask for confirmation before importing.
