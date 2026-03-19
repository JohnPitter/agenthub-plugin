# AgentHub Local — Claude Code Plugin

AI development orchestration that runs entirely on your machine. No cloud, no auth, no external dependencies.

## Install

```bash
claude plugins add https://github.com/JohnPitter/agenthub-plugin.git
```

## Quick Start

```
/start
```

Starts the local server, seeds 8 AI agents, and opens the dashboard in your browser.

## Features

- **Dashboard** — Overview of projects, tasks, and agents with real-time stats
- **8 AI Agents** — Architect, Tech Lead, Frontend Dev, Backend Dev, QA, Doc Writer, Team Lead, Support
- **Project Management** — Import local projects or create new ones with tech stack selection
- **Task Orchestration** — Full task lifecycle with enforced state machine
- **Agent Memories** — Persistent learnings accumulated during task execution
- **Documentation** — Built-in docs editor + auto-generated API documentation (51 endpoints)
- **Git Integration** — Status, config, init, sync directly from the dashboard
- **File Browser** — View project files with path traversal protection
- **Claude Usage** — Monitor Claude Code CLI usage with caching fallback
- **WhatsApp/Telegram** — Messaging integrations from settings
- **Factory Reset** — Clean slate option in Settings > About
- **102 E2E Tests** — Full coverage of all API flows

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Start server + open dashboard |

## Requirements

- Claude Code CLI (authenticated via `claude login`)
- Node.js 18+
