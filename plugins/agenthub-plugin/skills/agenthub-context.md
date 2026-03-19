---
name: agenthub-context
description: Provides AgentHub Local context. Activates when user mentions AgentHub, AI agents, task orchestration, or managing dev tasks via AI.
---

# AgentHub Local

AgentHub Local is a **standalone AI development orchestration** tool that runs entirely on the developer's machine. No cloud, no auth, no external dependencies.

## How it works
- Express server on **localhost:4200** with SQLite database
- Uses **Claude Code CLI token** (from ~/.claude/.credentials.json) for AI
- Scans local project directories to import
- Multi-agent workflow: Tech Lead → Developer → QA

## Task Lifecycle
```
created → assigned → in_progress → review → done
                                    review → assigned (reject)
                                    * → failed
```

## Available Commands
- `/agenthub` — Start server + open dashboard
- `/scan` — Scan directory for projects to import
- `/task` — Create a new task from current project
- `/usage` — Show Claude usage + AgentHub stats

## API Endpoints (localhost:4200)
- `GET /api/health` — Server status
- `GET/POST /api/projects` — Project CRUD
- `POST /api/projects/scan` — Scan directory
- `GET/POST/PATCH/DELETE /api/tasks` — Task CRUD
- `GET/POST/PATCH/DELETE /api/agents` — Agent CRUD
- `GET /api/projects/:id/files` — File tree
- `GET /api/projects/:id/files/content?path=...` — File content

## Data
- Database: `~/.agenthub-local/db.sqlite`
- Default agents seeded on first run (Tech Lead, Developer, QA)
