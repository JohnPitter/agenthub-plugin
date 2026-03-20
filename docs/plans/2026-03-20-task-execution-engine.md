# Task Execution Engine — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the core task execution engine that picks up tasks in `assigned` status, runs the appropriate agent via Claude API, streams progress to the dashboard, and advances the task through the state machine.

**Architecture:** A new `TaskExecutor` service in `server/src/lib/task-executor.ts` that orchestrates the agent workflow. When a task moves to `assigned`, the executor picks it up, calls the agent's enriched prompt via Claude API (with memories), streams socket events for real-time UI updates, executes tool calls (Read/Write/Bash on the project directory), tracks token usage, and advances the task through `in_progress → review → done`. The Tech Lead triages first, then delegates to the appropriate dev agent.

**Tech Stack:** Node.js native `https` module (same as whatsapp-service), Socket.io for streaming, SQLite/Drizzle for persistence, existing agent context endpoint for prompt enrichment.

---

### Task 1: Create TaskExecutor service — callClaude with streaming support

**Files:**
- Create: `server/src/lib/task-executor.ts`

**Step 1: Create the file with Claude API call supporting tool_use**

```typescript
import https from "https";
import { readFileSync, existsSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execFileSync } from "child_process";
import { nanoid } from "nanoid";
import { db, schema } from "../db.js";
import { eq } from "drizzle-orm";

function getToken(): string | null {
  try {
    const raw = readFileSync(join(homedir(), ".claude", ".credentials.json"), "utf-8");
    return JSON.parse(raw)?.claudeAiOauth?.accessToken ?? null;
  } catch { return null; }
}

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface ClaudeResponse {
  id: string;
  content: ContentBlock[];
  model: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
  usage: { input_tokens: number; output_tokens: number };
}

function callClaudeAPI(
  model: string,
  system: string,
  messages: ClaudeMessage[],
  tools?: unknown[],
  maxTokens = 4096,
  thinkingTokens?: number | null,
): Promise<ClaudeResponse> {
  return new Promise((resolve, reject) => {
    const token = getToken();
    if (!token) return reject(new Error("No Claude token"));

    const bodyObj: Record<string, unknown> = { model, max_tokens: maxTokens, system, messages };
    if (tools && tools.length > 0) bodyObj.tools = tools;
    if (thinkingTokens && thinkingTokens > 0) {
      bodyObj.thinking = { type: "enabled", budget_tokens: thinkingTokens };
    }

    const body = JSON.stringify(bodyObj);
    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || "API error"));
          resolve(parsed as ClaudeResponse);
        } catch { reject(new Error("Failed to parse response")); }
      });
    });
    req.on("error", (err) => reject(err));
    req.setTimeout(120000, () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(body);
    req.end();
  });
}
```

**Step 2: Verify file compiles**
Run: `cd server && npx tsc --noEmit 2>&1 | grep task-executor`
Expected: No errors for task-executor.ts

---

### Task 2: Define tool schemas for agent execution

**Files:**
- Modify: `server/src/lib/task-executor.ts`

**Step 1: Add tool definitions that match what agents can do**

```typescript
// Append to task-executor.ts

const TOOLS = [
  {
    name: "read_file",
    description: "Read a file from the project directory",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from project root" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file in the project directory",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from project root" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_files",
    description: "List files and directories in a path",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from project root (default: '.')" },
      },
    },
  },
  {
    name: "run_command",
    description: "Execute a shell command in the project directory",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to execute" },
        args: { type: "array", items: { type: "string" }, description: "Command arguments" },
      },
      required: ["command"],
    },
  },
  {
    name: "search_files",
    description: "Search for a pattern in files using grep",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        path: { type: "string", description: "Directory to search in (default: '.')" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "task_complete",
    description: "Signal that the task is complete with a result summary",
    input_schema: {
      type: "object",
      properties: {
        result: { type: "string", description: "Summary of what was done" },
        status: { type: "string", enum: ["review", "failed"], description: "Next status: review (success) or failed (error)" },
      },
      required: ["result", "status"],
    },
  },
];
```

---

### Task 3: Implement tool execution functions

**Files:**
- Modify: `server/src/lib/task-executor.ts`

**Step 1: Add tool execution with project directory sandboxing**

```typescript
function executeTool(toolName: string, input: Record<string, unknown>, projectPath: string): string {
  try {
    switch (toolName) {
      case "read_file": {
        const filePath = join(projectPath, input.path as string);
        if (!filePath.startsWith(projectPath)) return "Error: path traversal blocked";
        if (!existsSync(filePath)) return `Error: file not found: ${input.path}`;
        return readFileSync(filePath, "utf-8");
      }
      case "write_file": {
        const filePath = join(projectPath, input.path as string);
        if (!filePath.startsWith(projectPath)) return "Error: path traversal blocked";
        const dir = join(filePath, "..");
        if (!existsSync(dir)) {
          const { mkdirSync } = require("fs");
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(filePath, input.content as string);
        return `File written: ${input.path}`;
      }
      case "list_files": {
        const dirPath = join(projectPath, (input.path as string) || ".");
        if (!dirPath.startsWith(projectPath)) return "Error: path traversal blocked";
        if (!existsSync(dirPath)) return `Error: directory not found: ${input.path}`;
        return readdirSync(dirPath).join("\n");
      }
      case "run_command": {
        const cmd = input.command as string;
        const args = (input.args as string[]) || [];
        const result = execFileSync(cmd, args, {
          cwd: projectPath,
          timeout: 30000,
          maxBuffer: 1024 * 1024,
          encoding: "utf-8",
        });
        return result.slice(0, 5000); // limit output
      }
      case "search_files": {
        const pattern = input.pattern as string;
        const searchPath = join(projectPath, (input.path as string) || ".");
        try {
          const result = execFileSync("grep", ["-rn", "--include=*.*", pattern, searchPath], {
            timeout: 10000, encoding: "utf-8", maxBuffer: 1024 * 1024,
          });
          return result.slice(0, 5000);
        } catch (e) {
          return (e as { stdout?: string }).stdout?.slice(0, 5000) || "No matches found";
        }
      }
      case "task_complete": {
        return `TASK_COMPLETE:${input.status}:${input.result}`;
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
  }
}
```

**Note:** Use `import { mkdirSync } from "fs"` at top instead of `require("fs")` (ESM project).

---

### Task 4: Build the main execution loop

**Files:**
- Modify: `server/src/lib/task-executor.ts`

**Step 1: Create the executeTask function with agentic tool loop**

```typescript
interface ExecutionIO {
  emit: (event: string, data: unknown) => void;
}

export async function executeTask(taskId: string, io: ExecutionIO): Promise<void> {
  const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
  if (!task) throw new Error("Task not found");

  const project = db.select().from(schema.projects).where(eq(schema.projects.id, task.projectId)).get();
  if (!project) throw new Error("Project not found");

  // Get assigned agent or default to Tech Lead for triage
  let agentId = task.assignedAgentId;
  if (!agentId) {
    const techLead = db.select().from(schema.agents).where(eq(schema.agents.role, "tech_lead")).get();
    if (!techLead) throw new Error("No Tech Lead agent found");
    agentId = techLead.id;
    db.update(schema.tasks).set({ assignedAgentId: agentId, updatedAt: Date.now() })
      .where(eq(schema.tasks.id, taskId)).run();
  }

  // Get agent context (enriched with memories)
  const agent = db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
  if (!agent || !agent.isActive) throw new Error("Agent not active");

  const memories = db.select().from(schema.agentMemories)
    .where(eq(schema.agentMemories.agentId, agentId)).all();

  let systemPrompt = agent.systemPrompt;
  if (memories.length > 0) {
    const memLines = memories.map(m => `- [${m.type}] ${m.content}`).join("\n");
    systemPrompt += `\n\n## Your Memories\n${memLines}`;
  }

  // Add task context
  systemPrompt += `\n\n## Current Task
- Title: ${task.title}
- Description: ${task.description || "N/A"}
- Priority: ${task.priority}
- Category: ${task.category}
- Project: ${project.name} (${project.path})

When done, call the task_complete tool with a summary of what you did and status "review" (success) or "failed" (error).`;

  // Advance to in_progress
  db.update(schema.tasks).set({ status: "in_progress", updatedAt: Date.now() })
    .where(eq(schema.tasks.id, taskId)).run();
  io.emit("task:status", { taskId, status: "in_progress", agentId });
  io.emit("agent:status", { agentId, status: "running", taskId, progress: 0 });

  db.insert(schema.taskLogs).values({
    id: nanoid(), taskId, agentId, action: "status_change",
    detail: "assigned → in_progress", createdAt: Date.now(),
  }).run();

  // Determine tools based on agent allowedTools
  const allowedTools: string[] = agent.allowedTools ? JSON.parse(agent.allowedTools) : [];
  const agentTools = TOOLS.filter(t => {
    if (t.name === "task_complete") return true; // always available
    if (t.name === "read_file" && allowedTools.includes("Read")) return true;
    if (t.name === "write_file" && (allowedTools.includes("Write") || allowedTools.includes("Edit"))) return true;
    if (t.name === "list_files" && (allowedTools.includes("Glob") || allowedTools.includes("Read"))) return true;
    if (t.name === "run_command" && allowedTools.includes("Bash")) return true;
    if (t.name === "search_files" && allowedTools.includes("Grep")) return true;
    return false;
  });

  // Build initial messages
  const messages: ClaudeMessage[] = [
    { role: "user", content: `Execute this task:\n\nTitle: ${task.title}\nDescription: ${task.description || "No description"}\n\nProject directory: ${project.path}\n\nUse the available tools to complete the task. When finished, call task_complete.` },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let iteration = 0;
  const MAX_ITERATIONS = 20;
  let taskComplete = false;

  while (iteration < MAX_ITERATIONS && !taskComplete) {
    iteration++;
    io.emit("agent:status", {
      agentId, status: "running", taskId,
      progress: Math.min(90, (iteration / MAX_ITERATIONS) * 100),
    });

    let response: ClaudeResponse;
    try {
      response = await callClaudeAPI(
        agent.model, systemPrompt, messages, agentTools,
        4096, agent.maxThinkingTokens,
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "API error";
      io.emit("agent:status", { agentId, status: "error", taskId });
      db.update(schema.tasks).set({ status: "failed", result: errMsg, updatedAt: Date.now() })
        .where(eq(schema.tasks.id, taskId)).run();
      io.emit("task:status", { taskId, status: "failed", agentId });
      return;
    }

    totalInputTokens += response.usage.input_tokens;
    totalOutputTokens += response.usage.output_tokens;

    // Process response content blocks
    const assistantContent: ContentBlock[] = [];
    const toolResults: ContentBlock[] = [];

    for (const block of response.content) {
      if (block.type === "text" && block.text) {
        assistantContent.push(block);
        io.emit("agent:message", { agentId, taskId, content: block.text });

        // Log the message
        db.insert(schema.messages).values({
          id: nanoid(), projectId: project.id, taskId, agentId,
          role: "assistant", content: block.text, createdAt: Date.now(),
        }).run();
      }

      if (block.type === "tool_use" && block.name && block.id) {
        assistantContent.push(block);

        io.emit("agent:tool_use", {
          agentId, taskId, tool: block.name, input: block.input,
        });

        // Execute tool
        const toolResult = executeTool(block.name, block.input || {}, project.path);

        // Check for task_complete signal
        if (toolResult.startsWith("TASK_COMPLETE:")) {
          const [, status, ...resultParts] = toolResult.split(":");
          const result = resultParts.join(":");
          const nextStatus = status === "review" ? "review" : "failed";

          db.update(schema.tasks).set({
            status: nextStatus,
            result,
            costUsd: String(((totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000).toFixed(4)),
            tokensUsed: totalInputTokens + totalOutputTokens,
            updatedAt: Date.now(),
            ...(nextStatus === "done" ? { completedAt: Date.now() } : {}),
          }).where(eq(schema.tasks.id, taskId)).run();

          io.emit("task:status", { taskId, status: nextStatus, agentId });
          io.emit("agent:status", { agentId, status: "idle", taskId });
          io.emit("agent:result", { agentId, taskId, result, status: nextStatus });

          db.insert(schema.taskLogs).values({
            id: nanoid(), taskId, agentId, action: "status_change",
            detail: `in_progress → ${nextStatus}: ${result.slice(0, 200)}`,
            createdAt: Date.now(),
          }).run();

          taskComplete = true;
          break;
        }

        io.emit("agent:result", { agentId, taskId, tool: block.name, result: toolResult.slice(0, 500) });

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: toolResult.slice(0, 10000),
        });
      }
    }

    // Add assistant turn to messages
    messages.push({ role: "assistant", content: assistantContent });

    // If there were tool calls, add results and continue loop
    if (toolResults.length > 0 && !taskComplete) {
      messages.push({ role: "user", content: toolResults });
    }

    // If stop_reason is end_turn (no tool calls), task is done
    if (response.stop_reason === "end_turn" && !taskComplete) {
      const textContent = response.content
        .filter(b => b.type === "text" && b.text)
        .map(b => b.text)
        .join("\n");

      db.update(schema.tasks).set({
        status: "review",
        result: textContent.slice(0, 5000),
        costUsd: String(((totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000).toFixed(4)),
        tokensUsed: totalInputTokens + totalOutputTokens,
        updatedAt: Date.now(),
      }).where(eq(schema.tasks.id, taskId)).run();

      io.emit("task:status", { taskId, status: "review", agentId });
      io.emit("agent:status", { agentId, status: "idle", taskId });
      taskComplete = true;
    }
  }

  // Max iterations reached without completion
  if (!taskComplete) {
    db.update(schema.tasks).set({
      status: "failed", result: "Max iterations reached",
      costUsd: String(((totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000).toFixed(4)),
      tokensUsed: totalInputTokens + totalOutputTokens,
      updatedAt: Date.now(),
    }).where(eq(schema.tasks.id, taskId)).run();
    io.emit("task:status", { taskId, status: "failed", agentId });
    io.emit("agent:status", { agentId, status: "idle", taskId });
  }
}
```

---

### Task 5: Create the execute endpoint and wire it up

**Files:**
- Modify: `server/src/index.ts`

**Step 1: Add POST /api/tasks/:id/execute endpoint**

In `index.ts`, before the `projectsRouter`, add:

```typescript
import { executeTask } from "./lib/task-executor.js";

// Task execution — triggers agent workflow
app.post("/api/tasks/:id/execute", async (req, res) => {
  const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, req.params.id)).get();
  if (!task) return res.status(404).json({ error: "Task not found" });

  if (task.status !== "assigned") {
    return res.status(400).json({ error: `Task must be in 'assigned' status to execute (current: ${task.status})` });
  }

  const io = req.app.get("io");
  res.json({ status: "executing", taskId: task.id });

  // Execute async (non-blocking)
  executeTask(task.id, io).catch((err) => {
    console.error(`[TaskExecutor] Failed: ${err.message}`);
    db.update(schema.tasks).set({
      status: "failed", result: err.message, updatedAt: Date.now(),
    }).where(eq(schema.tasks.id, task.id)).run();
    if (io) io.emit("task:status", { taskId: task.id, status: "failed" });
  });
});
```

**Step 2: Auto-trigger execution when task moves to assigned**

In `tasks.ts` PATCH handler, after the status update, add:

```typescript
// Auto-trigger execution when task moves to assigned
if (status === "assigned" && status !== task.status) {
  // Dynamically import to avoid circular deps
  import("../lib/task-executor.js").then(({ executeTask }) => {
    const io = req.app.get("io") ?? null;
    executeTask(req.params.id, io).catch((err) => {
      console.error(`[TaskExecutor] Auto-execute failed: ${err.message}`);
    });
  }).catch(() => {});
}
```

---

### Task 6: Add API docs entry and update tests

**Files:**
- Modify: `server/src/index.ts` (API docs generation)
- Modify: `server/src/e2e.test.ts`

**Step 1: Add to API docs**

In the `routeDescriptions` object in index.ts:
```typescript
"POST /api/tasks/:id/execute": { desc: "Execute task with assigned agent", group: "Tasks", params: [
  { name: "id", in: "path", type: "string", required: true },
]},
```

**Step 2: Add E2E test for execution endpoint**

```typescript
describe("Task Execution", () => {
  it("POST /tasks/:id/execute — 400 if not assigned", async () => {
    const proj = await api<{ project: Record<string, unknown> }>("/projects/create", {
      method: "POST", body: JSON.stringify({ name: `exec-test-${Date.now()}` }),
    });
    const task = await api<{ task: Record<string, unknown> }>("/tasks", {
      method: "POST",
      body: JSON.stringify({ projectId: proj.project.id, title: "Exec test" }),
    });
    const res = await api<{ error: string; _status: number }>(`/tasks/${task.task.id}/execute`, {
      method: "POST",
    });
    expect(res._status).toBe(400);
    expect(res.error).toContain("assigned");
  });

  it("POST /tasks/:id/execute — 404 for non-existent", async () => {
    const res = await api<{ _status: number }>("/tasks/non-existent/execute", {
      method: "POST",
    });
    expect(res._status).toBe(404);
  });
});
```

---

### Task 7: Commit and verify

**Step 1: Type check**
Run: `cd server && npx tsc --noEmit`

**Step 2: Run tests**
Run: `cd server && npx vitest run src/e2e.test.ts`

**Step 3: Commit**
```bash
git add server/src/lib/task-executor.ts server/src/index.ts server/src/routes/tasks.ts server/src/e2e.test.ts
git commit -m "feat: task execution engine — agents can execute tasks with tool use

- TaskExecutor service with Claude API agentic loop (max 20 iterations)
- Tool execution: read_file, write_file, list_files, run_command, search_files, task_complete
- Path traversal protection for all file operations
- Token usage tracking (input + output → costUsd)
- Real-time socket events: agent:status, agent:message, agent:tool_use, agent:result, task:status
- Auto-trigger execution when task moves to 'assigned'
- POST /api/tasks/:id/execute endpoint
- Agent memories injected into system prompt
- Max iteration safety (20 turns)

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
