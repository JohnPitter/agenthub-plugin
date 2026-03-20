# Migrate to Claude SDKs — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all raw `https.request` calls to Anthropic API with official SDKs — Agent SDK for task execution (built-in tools, retry, rate limit handling) and Anthropic SDK for WhatsApp (simple messages with auto-retry).

**Architecture:** The task-executor.ts gets completely rewritten using `@anthropic-ai/claude-agent-sdk` which provides built-in tools (Read, Write, Edit, Bash, Glob, Grep), automatic retry with backoff, rate limit handling, and streaming. The whatsapp-service.ts switches from raw https to `@anthropic-ai/sdk` (Anthropic SDK) which has built-in retry for 429/5xx. The usage endpoint in index.ts stays as-is (OAuth endpoint, not Messages API).

**Tech Stack:** `@anthropic-ai/claude-agent-sdk` (Agent SDK), `@anthropic-ai/sdk` (Anthropic SDK), existing better-sqlite3 + Drizzle ORM

---

### Task 1: Install SDKs

**Files:**
- Modify: `server/package.json`

**Step 1: Install Agent SDK and verify Anthropic SDK**

Run: `cd server && npm install @anthropic-ai/claude-agent-sdk`

**Step 2: Verify both packages installed**

Run: `cat package.json | grep claude-agent-sdk && cat package.json | grep @anthropic-ai/sdk`
Expected: Both packages in dependencies

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add @anthropic-ai/claude-agent-sdk for task execution"
```

---

### Task 2: Rewrite task-executor.ts with Agent SDK

**Files:**
- Rewrite: `server/src/lib/task-executor.ts`

**Step 1: Rewrite the entire file**

The Agent SDK handles tools, retry, rate limits, and streaming automatically. The `query()` function runs an agent with built-in tools. Replace the entire 500+ line file with this:

```typescript
import { query, ClaudeAgentOptions, ResultMessage, SystemMessage, AssistantMessage, TextBlock } from "@anthropic-ai/claude-agent-sdk";
import { nanoid } from "nanoid";
import { db, schema } from "../db.js";
import { eq } from "drizzle-orm";

interface ExecutionIO {
  emit: (event: string, data: unknown) => void;
}

export async function executeTask(taskId: string, io: ExecutionIO): Promise<void> {
  const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
  if (!task) throw new Error("Task not found");

  const project = db.select().from(schema.projects).where(eq(schema.projects.id, task.projectId)).get();
  if (!project) throw new Error("Project not found");

  // Get assigned agent or default to Tech Lead
  let agentId = task.assignedAgentId;
  if (!agentId) {
    const techLead = db.select().from(schema.agents).where(eq(schema.agents.role, "tech_lead")).get();
    if (!techLead) throw new Error("No Tech Lead agent found");
    agentId = techLead.id;
    db.update(schema.tasks).set({ assignedAgentId: agentId, updatedAt: Date.now() })
      .where(eq(schema.tasks.id, taskId)).run();
  }

  const agent = db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
  if (!agent || !agent.isActive) throw new Error("Agent not active");

  // Build enriched system prompt with memories
  const memories = db.select().from(schema.agentMemories)
    .where(eq(schema.agentMemories.agentId, agentId)).all();

  let systemPrompt = agent.systemPrompt;
  if (agent.soul) systemPrompt += `\n\n${agent.soul}`;
  if (memories.length > 0) {
    const memLines = memories.map(m => `- [${m.type}] ${m.content}`).join("\n");
    systemPrompt += `\n\n## Your Memories\n${memLines}`;
  }

  systemPrompt += `\n\n## Current Task
- Title: ${task.title}
- Description: ${task.description || "N/A"}
- Priority: ${task.priority}
- Category: ${task.category}
- Project: ${project.name} (${project.path})

Complete this task using the available tools. Work in the project directory.`;

  // Map agent's allowed tools to SDK tool names
  const allowedTools: string[] = agent.allowedTools ? JSON.parse(agent.allowedTools) : [];
  // Agent SDK uses the same tool names: Read, Write, Edit, Bash, Glob, Grep
  const sdkTools = allowedTools.filter(t =>
    ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"].includes(t)
  );

  // Advance to in_progress
  db.update(schema.tasks).set({ status: "in_progress", updatedAt: Date.now() })
    .where(eq(schema.tasks.id, taskId)).run();
  io.emit("task:status", { taskId, status: "in_progress", agentId });
  io.emit("agent:status", { agentId, status: "running", taskId, progress: 0 });

  db.insert(schema.taskLogs).values({
    id: nanoid(), taskId, agentId, action: "status_change",
    detail: "assigned → in_progress", createdAt: Date.now(),
  }).run();

  let resultText = "";
  let finalStatus: "review" | "failed" = "review";

  try {
    // Use Agent SDK — handles retry, rate limits, tools automatically
    for await (const message of query({
      prompt: `Execute this task:\n\nTitle: ${task.title}\nDescription: ${task.description || "No description"}\n\nWork in the project directory. When done, summarize what you did.`,
      options: {
        cwd: project.path,
        allowedTools: sdkTools,
        systemPrompt,
        model: agent.model,
        permissionMode: agent.permissionMode as "default" | "acceptEdits" | "bypassPermissions" || "acceptEdits",
        maxTurns: 20,
      } as ClaudeAgentOptions,
    })) {
      if ("result" in message) {
        resultText = (message as ResultMessage).result;
        io.emit("agent:result", { agentId, taskId, result: resultText.slice(0, 500) });
      } else if ("type" in message) {
        const msg = message as Record<string, unknown>;
        if (msg.type === "assistant") {
          const assistantMsg = message as AssistantMessage;
          for (const block of assistantMsg.content) {
            if (block instanceof TextBlock || (block as { type: string }).type === "text") {
              const text = (block as { text: string }).text;
              io.emit("agent:message", { agentId, taskId, content: text.slice(0, 500) });

              db.insert(schema.messages).values({
                id: nanoid(), projectId: project.id, taskId, agentId,
                role: "assistant", content: text.slice(0, 2000), createdAt: Date.now(),
              }).run();
            }
          }
        }
      }
    }
  } catch (err) {
    resultText = err instanceof Error ? err.message : "Execution failed";
    finalStatus = "failed";
    io.emit("agent:status", { agentId, status: "error", taskId });
  }

  // Update task with result
  db.update(schema.tasks).set({
    status: finalStatus,
    result: resultText.slice(0, 5000),
    updatedAt: Date.now(),
  }).where(eq(schema.tasks.id, taskId)).run();

  io.emit("task:status", { taskId, status: finalStatus, agentId });
  io.emit("agent:status", { agentId, status: "idle", taskId });

  db.insert(schema.taskLogs).values({
    id: nanoid(), taskId, agentId, action: "status_change",
    detail: `in_progress → ${finalStatus}: ${resultText.slice(0, 200)}`,
    createdAt: Date.now(),
  }).run();
}
```

**Step 2: Verify compiles**

Run: `cd server && npx tsc --noEmit 2>&1 | grep task-executor`
Expected: No errors

---

### Task 3: Rewrite WhatsApp callClaude with Anthropic SDK

**Files:**
- Modify: `server/src/lib/whatsapp-service.ts`

**Step 1: Replace the callClaude function**

Replace the raw `https.request` callClaude with Anthropic SDK that has built-in retry:

```typescript
// Remove: import https from "https";
// Remove: the entire callClaude function (~60 lines) and getClaudeAccessToken
// Add at top:
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Create client with OAuth token
function createAnthropicClient(): Anthropic | null {
  try {
    const raw = readFileSync(join(homedir(), ".claude", ".credentials.json"), "utf-8");
    const token = JSON.parse(raw)?.claudeAiOauth?.accessToken;
    if (!token) return null;
    return new Anthropic({
      apiKey: token,
      defaultHeaders: {
        "Authorization": `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
    });
  } catch { return null; }
}

// Replace callClaude
async function callClaude(
  systemPrompt: string,
  messages: { role: string; content: string }[],
  model: string
): Promise<string> {
  const client = createAnthropicClient();
  if (!client) return "Erro: token Claude não encontrado. Execute /login no Claude Code.";

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    });

    const textParts = response.content.filter(b => b.type === "text");
    if (textParts.length > 0) {
      return textParts.map(b => b.type === "text" ? b.text : "").join("");
    }
    return "Desculpe, não consegui processar sua mensagem.";
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return "Rate limit atingido. Tente novamente em alguns segundos.";
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return "Token expirado. Execute /login no Claude Code.";
    }
    console.error("[WhatsApp] Claude API error:", err);
    return "Erro na API. Tente novamente.";
  }
}
```

The Anthropic SDK automatically retries 429 and 5xx with exponential backoff (default: 2 retries).

**Step 2: Remove old imports**

Remove `import https from "https"` and the old `getClaudeAccessToken` function from whatsapp-service.ts. Keep the `https` import ONLY in `executeAction` for GitHub API calls.

**Step 3: Verify compiles**

Run: `cd server && npx tsc --noEmit 2>&1 | grep whatsapp`
Expected: No errors

---

### Task 4: Clean up claude-token.ts usage

**Files:**
- Check: `server/src/lib/claude-token.ts`
- Check: `server/src/index.ts`

**Step 1: Verify claude-token.ts is still needed**

`claude-token.ts` exports `getClaudeToken()` which is used in `index.ts` for:
1. Health check (line ~462) — reports if token exists
2. Usage endpoint (line ~936) — calls OAuth usage API

Both are NOT Messages API calls, so they stay as-is. `claude-token.ts` remains.

The whatsapp-service.ts no longer imports it (uses Anthropic SDK client instead).
The task-executor.ts no longer imports it (uses Agent SDK instead).

**Step 2: Verify no broken imports**

Run: `cd server && npx tsc --noEmit`
Expected: No errors (except known routes/projects.ts)

---

### Task 5: Run tests and commit

**Step 1: Restart server and test**

Run: `cd server && NO_OPEN=1 npx tsx src/index.ts`
Expected: Server starts without errors

**Step 2: Run E2E tests**

Run: `cd server && npx vitest run src/e2e.test.ts`
Expected: All tests pass

**Step 3: Commit everything**

```bash
git add -A
git commit -m "feat: migrate to Claude SDKs — Agent SDK for tasks, Anthropic SDK for WhatsApp

- task-executor.ts: rewritten with @anthropic-ai/claude-agent-sdk
  - Built-in tools (Read, Write, Edit, Bash, Glob, Grep)
  - Automatic retry with exponential backoff
  - Rate limit handling (no more 429 failures)
  - Streaming support
  - Permission modes from agent config
  - Max 20 turns safety limit

- whatsapp-service.ts: replaced raw https with @anthropic-ai/sdk
  - Built-in retry for 429/5xx (2 retries)
  - Typed error handling (RateLimitError, AuthenticationError)
  - Cleaner code (~60 lines removed)

- index.ts: usage endpoint stays as-is (OAuth endpoint, not Messages API)
- claude-token.ts: kept for health check and usage monitoring

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

**Step 4: Push**

```bash
git push origin master
```
