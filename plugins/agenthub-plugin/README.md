# AgentHub Plugin for Claude Code

Integrate [AgentHub](https://github.com/JohnPitter/agenthub) directly into Claude Code. Manage AI agents, tasks, and projects without leaving the terminal.

## Install

```bash
claude plugins install JohnPitter/agenthub-plugin
```

## Commands

| Command | Description |
|---------|-------------|
| `/agenthub` | Open AgentHub dashboard and manage tasks |
| `/scan` | Scan current directory for projects to import |
| `/task` | Create a new task from current project context |
| `/usage` | Show Claude usage stats and AgentHub consumption |

## Features

- **Project Scanner** — Detects Node.js, Python, Go, Rust, Java, .NET projects in your workspace
- **Task Creation** — Create tasks from current project context with auto-detected metadata
- **Usage Dashboard** — View Claude Code usage + AgentHub plan/storage/cost stats
- **No Authentication Required** — Uses existing Claude Code session

## Usage Examples

```
> /agenthub
# Opens interactive menu: dashboard, scan, tasks, agents

> /scan
# Scans ~/Projects for importable repos
# Shows table: name, stack, git remote
# Import selected projects to AgentHub

> /task
# Creates task in current project
# Auto-detects project from git remote
# Asks for title, description, priority

> /usage
# Shows Claude Code account status
# Shows AgentHub plan usage
# Shows cost analytics
```

## Requirements

- Claude Code CLI installed
- AgentHub server running (default: https://agenthub.luxview.cloud)
- GitHub account (for project import)
