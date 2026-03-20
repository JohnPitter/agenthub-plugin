# Napkin

## Corrections
| Date | Source | What Went Wrong | What To Do Instead |
|------|--------|----------------|-------------------|
| 2026-03-19 | self | Used `require("child_process")` in ESM module | Use top-level `import { execFileSync } from "child_process"` — this project is ESM |
| 2026-03-19 | self | `process.exit(0)` + `fetch` AbortController causes UV_HANDLE_CLOSING on Windows | Replace `fetch` with native `https.request` — no AbortController handles to leak. `process._exit(0)` was a band-aid that didn't work |
| 2026-03-19 | self | Added closing brackets wrong in minified JS settings | Count bracket nesting carefully — the `dl` ends with `]})` then siblings follow |
| 2026-03-20 | self | IIFE with useState in JSX causes React #310 (invalid hook call) | NEVER use `(()=>{useState(...)...})()` inline — extract as named function component (e.g. `_Fr`) before the parent component |
| 2026-03-19 | user | Plugin name = command name causes CLI to always show full form | When plugin=agenthub and command=agenthub.md, CLI shows `agenthub:agenthub` not `/agenthub`. Command name MUST differ from plugin name for shorthand to work. Final: plugin=agenthub, command=start.md → `/start` |
| 2026-03-19 | self | analytics/costs returned `{data:[]}` but frontend stores response directly | Frontend does `costByAgent: response` — must return raw array `[]` not wrapped |
| 2026-03-19 | self | Agent memories effect used `L` (selectedAgentId) but it starts null | Use fallback: `L || (v.length>0 ? v[0].id : null)` since `m` derives from `v[0]` |

## User Preferences
- Responds in Portuguese (pt-BR)
- Prefers direct fixes over explanations
- Wants features to work in both standalone server AND plugin mode
- Frontend source is NOT in this repo — only compiled dist assets
- Edits to minified JS are acceptable and expected
- Commits should include all changes, push immediately when asked
- `python` not `python3` on Windows
- Uses agent teams for parallel work — dispatch subagents for independent files
- Prefers Claude Agent SDK over raw API calls for task execution
- Prefers Anthropic SDK over raw https for simple API calls (auto retry)

## Patterns That Work
- Edit minified JS by finding unique string anchors (e.g. specific className + text)
- Use `\xe3o` for ã, `\xed` for í in minified JS strings
- Test endpoints with curl after restart to verify
- `netstat -ano | grep :PORT | grep LISTENING` + `taskkill //PID` to kill server on Windows
- `npx tsc --noEmit 2>&1 | grep -v "routes/projects.ts"` to skip pre-existing error
- Server port is dynamic — always read from `~/.agenthub-local/port`
- `NO_OPEN=1 nohup npx tsx src/index.ts` to start without opening browser

## Patterns That Don't Work
- `lsof` doesn't exist on Windows — use `netstat -ano`
- `python3` doesn't exist on Windows — use `python`
- Emoji in Python print on Windows causes charmap encoding errors
- `require()` in ESM files — always use `import`
- `process.exit(0)` with pending AbortController handles on Windows
- NEVER `taskkill //IM claude.exe //F` — kills the current Claude Code session too. Only kill specific PIDs or node.exe orphans

## Domain Notes
- Plugin marketplace: folder name in `plugins/` = plugin name for CLI
- `marketplace.json` plugin `name` + `source` must match actual folder
- `.claude-plugin/plugin.json` required for marketplace discovery
- Frontend uses `S()` or `U()` for API calls (varies by file — check imports)
- Socket.io `io` is created after routes — use `req.app.get("io")` in route handlers
- Claude usage cache at `~/.claude/.usage-cache.json` — read on startup as fallback
- Agent SDK exports: `query`, `Options`, `SDKResultMessage`, `SDKAssistantMessage`, `SDKMessage` — NOT `ClaudeAgentOptions` or `ResultMessage`
- Agent SDK `Options` type has: `cwd`, `allowedTools`, `systemPrompt`, `model`, `permissionMode`, `maxTurns`
- Anthropic SDK (`@anthropic-ai/sdk`): `new Anthropic({ apiKey: token })` + `client.messages.create()` — has auto retry for 429/5xx
- WhatsApp auto-reconnect: must be inside `httpServer.listen()` callback so `io` is available
- Task execution auto-triggers when status moves to `assigned` (via dynamic import in tasks.ts PATCH handler)
- Board kanban columns: created, assigned, in_progress, review, done, failed, cancelled — NO `pending` column
