---
description: Start AgentHub Local — AI development orchestration running on your machine
allowed-tools: Bash(*), Read, Glob, Grep
---

# AgentHub Local

Start the local AgentHub server and open the dashboard. Runs entirely on your machine — no cloud, no auth.

## Your Task

### Step 1: Check if server is running
```bash
curl -s http://localhost:4200/api/health 2>/dev/null || echo "NOT_RUNNING"
```

### Step 2: If NOT_RUNNING, start the server
```bash
cd "${CLAUDE_PLUGIN_ROOT}/../../server" && nohup npx tsx src/index.ts > /dev/null 2>&1 & sleep 2 && curl -s http://localhost:4200/api/health
```

### Step 3: Open dashboard
```bash
start http://localhost:4200 2>/dev/null || open http://localhost:4200 2>/dev/null || xdg-open http://localhost:4200 2>/dev/null || echo "Open in browser: http://localhost:4200"
```

### Step 4: Show status
```bash
echo "⚡ AgentHub Local — http://localhost:4200"
echo ""
echo "Agents:"
curl -s http://localhost:4200/api/agents 2>/dev/null | python3 -c "
import sys,json
try:
  data = json.load(sys.stdin)
  for a in data.get('agents',[]):
    status = '🟢' if a.get('isActive') else '⚪'
    print(f'  {status} {a[\"name\"]} ({a[\"role\"]})')
except: print('  (error reading agents)')
"
echo ""
echo "Projects:"
curl -s http://localhost:4200/api/projects 2>/dev/null | python3 -c "
import sys,json
try:
  data = json.load(sys.stdin)
  projects = data.get('projects',[])
  if not projects: print('  (none — use /scan to import)')
  for p in projects:
    stack = json.loads(p.get('stack','[]'))[:3]
    print(f'  📁 {p[\"name\"]} — {', '.join(stack) if stack else 'unknown'}')
except: print('  (error reading projects)')
"
echo ""
echo "Use /scan to import projects, /task to create tasks"
```

Tell the user the server is running and the dashboard is open. Mention the available commands: `/scan`, `/task`, `/usage`.
