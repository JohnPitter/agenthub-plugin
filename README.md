# AgentHub Local — Claude Code Plugin

AI development orchestration that runs entirely on your machine. No cloud, no auth, no external dependencies.

## Install

```bash
claude plugins add https://github.com/JohnPitter/agenthub-plugin.git
```

## Quick Start

Inside any Claude Code session:

```
/start
```

This starts the local server, seeds 8 AI agents, and opens the dashboard in your browser.

## Features

- **Dashboard** with real-time stats, project overview, and Claude CLI usage monitoring
- **8 AI Agents** pre-configured: Architect, Tech Lead, Frontend Dev, Backend Dev, QA, Doc Writer, Team Lead, Support
- **Project Management** — import local or GitHub repos, create new (local or GitHub+local) with tech stack selection (17 technologies)
- **Task Orchestration** — full lifecycle with enforced state machine + auto-commit/PR on task completion
- **GitHub Integration** — connect via Personal Access Token in Settings for auto-commit, push, and PR creation
- **Agent Memories** — persistent learnings accumulated during task execution, injected into agent context
- **Documentation** — built-in markdown editor with auto-generated API docs (51 endpoints)
- **Git Integration** — status, config, init, sync from the dashboard project settings
- **File Browser** — browse project files and read content with path traversal protection
- **Claude Usage Widget** — Opus 5h rolling, Sonnet 7d, All models 7d with cache fallback
- **WhatsApp/Telegram Integration** — messaging directly from settings
- **Factory Reset** — clean slate option in Settings > About
- **Auto-login on token expiry** — detects 401 and triggers `claude login`

## Architecture

```
agenthub-plugin/
├── plugins/agenthub-plugin/
│   ├── commands/start.md           # /start slash command
│   ├── skills/agenthub-context.md  # Context for AI assistance
│   └── README.md                   # Plugin marketplace description
├── server/
│   ├── src/
│   │   ├── index.ts               # Express 5 server + inline API routes
│   │   ├── db.ts                  # SQLite schema + Drizzle ORM + migrations
│   │   ├── seed.ts                # 8 default agents with system prompts + souls
│   │   ├── e2e.test.ts            # 102 E2E tests (Vitest)
│   │   ├── routes/
│   │   │   ├── projects.ts        # Project CRUD + disk deletion
│   │   │   ├── tasks.ts           # Task CRUD + state machine (65 transitions validated)
│   │   │   ├── agents.ts          # Agent CRUD
│   │   │   ├── files.ts           # File tree + content reader
│   │   │   └── integrations.ts    # WhatsApp/Telegram endpoints
│   │   └── lib/
│   │       ├── claude-token.ts    # Reads ~/.claude/.credentials.json
│   │       ├── scanner.ts         # Local project detection (15+ languages)
│   │       └── whatsapp-service.ts # WPPConnect WhatsApp client
│   ├── web/dist/                  # Pre-built React 19 SPA
│   ├── package.json
│   └── tsconfig.json
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Express 5, Socket.io 4 |
| Database | SQLite via better-sqlite3 + Drizzle ORM |
| Frontend | React 19, Vite, Tailwind CSS 4, Zustand (pre-built) |
| AI | Claude Code CLI OAuth token (Anthropic API) |
| WhatsApp | @wppconnect-team/wppconnect |
| Tests | Vitest — 102 E2E tests |

## Default Agents

| Agent | Role | Model | Thinking |
|-------|------|-------|----------|
| Architect | architect | Claude Opus 4.6 | 32K tokens |
| Tech Lead | tech_lead | Claude Sonnet 4.6 | 16K tokens |
| Frontend Dev | frontend_dev | Claude Sonnet 4.6 | - |
| Backend Dev | backend_dev | Claude Sonnet 4.6 | - |
| QA Engineer | qa | Claude Sonnet 4.6 | - |
| Doc Writer | doc_writer | Claude Sonnet 4.6 | - |
| Team Lead | receptionist | Claude Haiku 4.5 | - |
| Support | support | Claude Opus 4.6 | 65K tokens |

## Task State Machine

```
created -> pending -> assigned -> in_progress -> review -> done

Reject:      review -> assigned (QA rejected, fix and resubmit)
Fail:        in_progress -> failed -> pending/assigned (retry)
Cancel:      any -> cancelled -> pending (recover)
```

65 transition scenarios validated (16 valid, 40 invalid blocked, 8 no-op, 1 field update on done).

## Data Storage

All data is stored locally — nothing leaves your machine.

| Item | Path |
|------|------|
| Database | `~/.agenthub-local/db.sqlite` |
| Server port | `~/.agenthub-local/port` |
| Server logs | `~/.agenthub-local/server.log` |
| WhatsApp tokens | `~/.agenthub-local/whatsapp-tokens/` |
| Created projects | `~/Projects/` |

## API Reference

51 endpoints. Key ones:

### Projects
- `GET /api/projects` — List projects
- `POST /api/projects/create` — Create with tech stack selection
- `POST /api/projects/import` — Import by path
- `DELETE /api/projects/:id` — Delete project + files from disk

### Tasks
- `GET /api/tasks?projectId=&status=` — List with filters
- `POST /api/tasks` — Create task
- `PATCH /api/tasks/:id` — Update (status transitions enforced)
- `GET /api/tasks/:id/logs` — Audit log

### Agents & Memories
- `GET /api/agents` — List all (8 default + custom)
- `GET /api/agents/:id/context` — Agent + memories for prompt injection
- `POST /api/agents/:id/memories` — Save memory `{ content, type, source }`

### Docs
- `GET/POST/PATCH/DELETE /api/docs` — Documentation CRUD
- `GET /api/docs-gen/api` — Auto-generated API docs (51 endpoints)

### Git
- `GET /api/projects/:id/git/status` — Branch, staged, unstaged, remote
- `POST /api/projects/:id/git/init` — Initialize repo
- `POST /api/projects/:id/git/sync` — Pull + push

### System
- `GET /api/health` — Server health + Claude token check
- `GET /api/claude-usage` — Usage data with cache fallback
- `POST /api/admin/factory-reset` — Reset all data (preserves agents)

## Running Tests

```bash
cd server
npm run dev      # Start server first (tests run against live server)
npm test         # 102 E2E tests
```

## Development

```bash
cd server
npm install
npm run dev      # Start with tsx
```

The frontend is pre-built in `server/web/dist/`. To rebuild it, use the AgentHub cloud project with `VITE_LOCAL_MODE=true`.

## Requirements

- Claude Code CLI authenticated (`claude login`)
- Node.js 18+

## License

MIT
