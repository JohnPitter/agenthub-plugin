---
description: Show Claude Code usage stats and Anthropic API consumption
allowed-tools: Bash(*), Read
---

# Claude Code Usage & AgentHub Stats

Show the user their Claude Code usage statistics and AgentHub consumption.

## Your Task

### 1. Claude Code CLI Credentials

Read the Claude Code credentials file to get account info:

```bash
cat ~/.claude/.credentials.json 2>/dev/null || echo "No Claude credentials found"
```

Parse the JSON and show:
- Account type (from the OAuth data)
- Session status

### 2. AgentHub Usage

If the user has an `AGENTHUB_TOKEN`, fetch their usage:

```bash
curl -s -H "Cookie: agenthub_token=$AGENTHUB_TOKEN" https://agenthub.luxview.cloud/api/plans/my-usage 2>/dev/null
```

Display:
- Plan name and price
- Projects used / max
- Tasks this month / max
- Storage used / max

```bash
curl -s -H "Cookie: agenthub_token=$AGENTHUB_TOKEN" https://agenthub.luxview.cloud/api/storage/usage 2>/dev/null
```

Display:
- Storage MB used / limit
- Repos count
- TTL days

### 3. AgentHub Cost Analytics

```bash
curl -s -H "Cookie: agenthub_token=$AGENTHUB_TOKEN" "https://agenthub.luxview.cloud/api/analytics/summary?period=30d" 2>/dev/null
```

Display:
- Total cost USD this month
- Total tokens consumed
- Tasks completed / failed
- Cost per model breakdown

### Display Format

Show everything in a clean, terminal-friendly format:

```
╔══════════════════════════════════════════╗
║          AgentHub Usage Report           ║
╠══════════════════════════════════════════╣
║ Plan: Pro ($29/month)                    ║
║ Projects: 3/10                           ║
║ Tasks: 45/200 this month                 ║
║ Storage: 1.2GB / 5GB                     ║
╠══════════════════════════════════════════╣
║ Cost This Month: $12.34                  ║
║ Tokens Used: 2.4M                        ║
║ Tasks: 42 completed, 3 failed            ║
╚══════════════════════════════════════════╝
```

If credentials or token are not available, guide the user to authenticate.
