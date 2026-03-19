---
name: agenthub-context
description: Provides AgentHub Local context. Activates when user mentions AgentHub, AI agents, task orchestration, or managing dev tasks via AI.
---

# AgentHub Local

AgentHub Local is a **standalone AI development orchestration** tool that runs entirely on the developer's machine. No cloud, no auth, no external dependencies.

## How it works
- Express 5 server on **dynamic port** (written to ~/.agenthub-local/port)
- SQLite database via better-sqlite3 + Drizzle ORM at ~/.agenthub-local/db.sqlite
- Uses **Claude Code CLI token** (from ~/.claude/.credentials.json) for AI
- Scans local project directories to import (~/Projects, ~/Development, ~/dev, ~/repos, ~/code)
- Pre-built React SPA served as static files
- Socket.io for real-time events (WhatsApp QR codes, status updates)

## 8 Default Agents

| Agent | Role | Model |
|-------|------|-------|
| Architect | architect | Claude Opus 4.6 (thinking: 32K) |
| Tech Lead | tech_lead | Claude Sonnet 4.6 (thinking: 16K) |
| Frontend Dev | frontend_dev | Claude Sonnet 4.6 |
| Backend Dev | backend_dev | Claude Sonnet 4.6 |
| QA Engineer | qa | Claude Sonnet 4.6 |
| Doc Writer | doc_writer | Claude Sonnet 4.6 |
| Team Lead | receptionist | Claude Haiku 4.5 |
| Support | support | Claude Opus 4.6 (thinking: 65K) |

## Task State Machine
```
created -> pending -> assigned -> in_progress -> review -> done
                                                  review -> assigned (reject)
                    assigned <- failed <- in_progress
cancelled <- (any)     pending <- cancelled
```

## Available Commands
- `/start` — Start server + open dashboard

## API Endpoints (dynamic port)
- `GET /api/health` — Server status + Claude token check
- `GET /api/auth/me` — Local admin user
- `GET/POST /api/projects` — Project CRUD
- `POST /api/projects/create` — Create local project (~/Projects/<name>)
- `POST /api/projects/import` — Import existing local path
- `GET /api/projects/local-scan` — Scan directories for projects
- `GET/POST/PATCH/DELETE /api/tasks` — Task CRUD with state machine
- `GET /api/tasks/:id/logs` — Task audit log
- `GET/POST/PATCH/DELETE /api/agents` — Agent CRUD
- `GET /api/projects/:id/files` — File tree
- `GET /api/projects/:id/files/content?path=...` — File content (path traversal protected)
- `GET/POST /api/integrations/whatsapp/*` — WhatsApp connect/disconnect/status
- `GET /api/dashboard/stats` — Aggregated stats
- `GET /api/claude-usage` — Claude Code CLI usage data
- `GET /api/plans/models` — Available AI models
- `GET /api/agents/:id/context` — Agent config + memories for prompt injection
- `GET /api/agents/:id/memories` — List agent memories
- `POST /api/agents/:id/memories` — Save memory `{ content, type, source?, taskId? }`
- `DELETE /api/agents/:id/memories/:memoryId` — Remove a memory
- `GET/POST/PATCH/DELETE /api/docs` — Documentation CRUD
- `GET /api/docs-gen/api` — Auto-generated API documentation (51 endpoints)
- `GET/PUT /api/projects/:id/git/status|config` — Git status and config
- `POST /api/projects/:id/git/init|sync` — Git init and sync
- `POST /api/admin/factory-reset` — Reset all data (preserves agents)
- `POST /api/auth/claude-login` — Trigger Claude OAuth login

## Data Storage
- Database: `~/.agenthub-local/db.sqlite`
- Port file: `~/.agenthub-local/port`
- Server logs: `~/.agenthub-local/server.log`
- WhatsApp tokens: `~/.agenthub-local/whatsapp-tokens/`
- Created projects: `~/Projects/`
