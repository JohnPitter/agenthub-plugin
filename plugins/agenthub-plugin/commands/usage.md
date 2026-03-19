---
description: Show Claude Code usage stats and AgentHub Local stats
allowed-tools: Bash(*), Read
---

# Usage Stats — Claude Code + AgentHub Local

Show usage statistics from Claude Code CLI and the local AgentHub server.

## Your Task

### 1. Claude Code Token Status
```bash
cat ~/.claude/.credentials.json 2>/dev/null || echo "NO_CREDENTIALS"
```
Parse the `claudeAiOauth` key. Show:
- Token exists: yes/no
- Has scopes: list them

### 2. AgentHub Local Stats
```bash
curl -s http://localhost:4200/api/health 2>/dev/null || echo "SERVER_NOT_RUNNING"
```

If running, get stats:
```bash
echo "Projects:" && curl -s http://localhost:4200/api/projects 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  {len(d.get(\"projects\",[]))} project(s)')"
echo "Tasks:" && curl -s http://localhost:4200/api/tasks 2>/dev/null | python3 -c "
import sys,json
d=json.load(sys.stdin)
tasks=d.get('tasks',[])
by_status={}
for t in tasks:
  s=t.get('status','unknown')
  by_status[s]=by_status.get(s,0)+1
total_cost=sum(float(t.get('costUsd','0') or '0') for t in tasks)
total_tokens=sum(t.get('tokensUsed',0) or 0 for t in tasks)
print(f'  {len(tasks)} total task(s)')
for s,c in sorted(by_status.items()):
  print(f'    {s}: {c}')
print(f'  Cost: \${total_cost:.4f}')
print(f'  Tokens: {total_tokens:,}')
"
echo "Agents:" && curl -s http://localhost:4200/api/agents 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'  {len(d.get(\"agents\",[]))} agent(s)')"
```

### Display Format

Present as a clean terminal report:

```
⚡ AgentHub Local — Usage Report
════════════════════════════════
Claude Token: ✓ detected
Server: http://localhost:4200

Projects: 3
Tasks: 12 total
  created: 2
  in_progress: 1
  done: 9
Cost: $0.4523
Tokens: 245,000
Agents: 3
```

If server is not running, tell the user to run `/agenthub` first.
