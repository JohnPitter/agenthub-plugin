---
description: Start AgentHub Local — AI development orchestration running on your machine
allowed-tools: Bash(*), Read, Glob, Grep
---

# AgentHub Local

Start the local AgentHub server and open the dashboard. Runs entirely on your machine — no cloud, no auth. Port is assigned dynamically.

## Your Task

### Step 1: Check if server is already running (read port from ~/.agenthub-local/port)
```bash
PORT_FILE="$HOME/.agenthub-local/port"
if [ -f "$PORT_FILE" ]; then
  PORT=$(cat "$PORT_FILE")
  HEALTH=$(curl -s "http://localhost:$PORT/api/health" 2>/dev/null)
  if echo "$HEALTH" | grep -q '"ok"'; then
    echo "RUNNING:$PORT"
  else
    echo "NOT_RUNNING"
  fi
else
  echo "NOT_RUNNING"
fi
```

### Step 2: If NOT_RUNNING, start the server
```bash
cd "${CLAUDE_PLUGIN_ROOT}/../../server" && NO_OPEN=1 nohup npx tsx src/index.ts > "$HOME/.agenthub-local/server.log" 2>&1 & sleep 3 && cat "$HOME/.agenthub-local/port"
```

### Step 3: Read the assigned port and open dashboard
```bash
PORT=$(cat "$HOME/.agenthub-local/port" 2>/dev/null)
start "http://localhost:$PORT" 2>/dev/null || open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null || echo "Open in browser: http://localhost:$PORT"
```

### Step 4: Show status
```bash
PORT=$(cat "$HOME/.agenthub-local/port" 2>/dev/null || echo "?")
echo "⚡ AgentHub Local — http://localhost:$PORT"
echo ""
echo "Agents:"
curl -s "http://localhost:$PORT/api/agents" 2>/dev/null | python3 -c "
import sys,json
try:
  data = json.load(sys.stdin)
  agents = data if isinstance(data, list) else data.get('agents',[])
  for a in agents:
    status = '🟢' if a.get('isActive') else '⚪'
    print(f'  {status} {a[\"name\"]} ({a[\"role\"]})')
except: print('  (error)')
"
echo ""
echo "Projects:"
curl -s "http://localhost:$PORT/api/projects" 2>/dev/null | python3 -c "
import sys,json
try:
  data = json.load(sys.stdin)
  projects = data if isinstance(data, list) else data.get('projects',[])
  if not projects: print('  (nenhum — use /scan para importar)')
  for p in projects:
    stack = json.loads(p.get('stack','[]'))[:3]
    s = ', '.join(stack) if stack else 'unknown'
    print(f'  📁 {p[\"name\"]} — {s}')
except: print('  (error)')
"
echo ""
echo "Comandos: /scan, /task, /usage"
```

Tell the user the server is running and the dashboard is open. Mention the port and available commands.
