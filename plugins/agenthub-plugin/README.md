# AgentHub Local — Claude Code Plugin

AI development orchestration that runs entirely on your machine. No cloud, no auth.

## Install

```bash
claude plugins marketplace add https://github.com/JohnPitter/agenthub-plugin.git
claude plugins install agenthub-plugin
```

## First Run

```
/agenthub
```

Starts local server on `localhost:4200`, seeds agents, opens dashboard.

## Commands

| Command | Description |
|---------|-------------|
| `/agenthub` | Start server + open dashboard |
| `/scan` | Scan directory for projects |
| `/task` | Create task from current project |
| `/usage` | Claude + AgentHub stats |

## Requirements

- Claude Code CLI (authenticated)
- Node.js 18+
