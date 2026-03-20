import https from "https";
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve, dirname } from "path";
import { execFileSync } from "child_process";
import { nanoid } from "nanoid";
import { db, schema } from "../db.js";
import { eq } from "drizzle-orm";
import { getClaudeToken } from "./claude-token.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  thinking?: string;
}

interface ClaudeResponse {
  id: string;
  content: ContentBlock[];
  model: string;
  stop_reason: "end_turn" | "tool_use" | "max_tokens";
  usage: { input_tokens: number; output_tokens: number };
}

interface ExecutionIO {
  emit: (event: string, data: unknown) => void;
}

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------

function callClaudeAPI(
  model: string,
  system: string,
  messages: ClaudeMessage[],
  tools?: unknown[],
  maxTokens = 16000,
  thinkingTokens?: number | null,
): Promise<ClaudeResponse> {
  return new Promise((resolve, reject) => {
    const token = getClaudeToken();
    if (!token) return reject(new Error("No Claude token — authenticate with `claude` CLI first"));

    const bodyObj: Record<string, unknown> = { model, max_tokens: maxTokens, system, messages };
    if (tools && tools.length > 0) bodyObj.tools = tools;
    if (thinkingTokens && thinkingTokens > 0) {
      bodyObj.thinking = { type: "enabled", budget_tokens: thinkingTokens };
    }

    const body = JSON.stringify(bodyObj);
    const req = https.request(
      {
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
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error.message || "API error"));
            resolve(parsed as ClaudeResponse);
          } catch {
            reject(new Error("Failed to parse Claude API response"));
          }
        });
      },
    );
    req.on("error", (err) => reject(err));
    req.setTimeout(120_000, () => {
      req.destroy();
      reject(new Error("Claude API request timed out (120s)"));
    });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "read_file",
    description: "Read a file from the project directory",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "Relative path from project root" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file in the project directory",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "Relative path from project root" },
        content: { type: "string" as const, description: "File content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_files",
    description: "List files and directories in a path",
    input_schema: {
      type: "object" as const,
      properties: {
        path: { type: "string" as const, description: "Relative path from project root (default: '.')" },
      },
    },
  },
  {
    name: "run_command",
    description: "Execute a shell command in the project directory",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string" as const, description: "Command to execute" },
        args: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "Command arguments",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "search_files",
    description: "Search for a pattern in files using grep",
    input_schema: {
      type: "object" as const,
      properties: {
        pattern: { type: "string" as const, description: "Regex pattern to search for" },
        path: { type: "string" as const, description: "Directory to search in (default: '.')" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "task_complete",
    description: "Signal that the task is complete with a result summary",
    input_schema: {
      type: "object" as const,
      properties: {
        result: { type: "string" as const, description: "Summary of what was done" },
        status: {
          type: "string" as const,
          enum: ["review", "failed"],
          description: "Next status: review (success) or failed (error)",
        },
      },
      required: ["result", "status"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution (sandboxed to project directory)
// ---------------------------------------------------------------------------

function safePath(projectPath: string, relativePath: string): string | null {
  const resolved = resolve(projectPath, relativePath);
  if (!resolved.startsWith(resolve(projectPath))) return null;
  return resolved;
}

function executeTool(toolName: string, input: Record<string, unknown>, projectPath: string): string {
  try {
    switch (toolName) {
      case "read_file": {
        const filePath = safePath(projectPath, input.path as string);
        if (!filePath) return "Error: path traversal blocked";
        if (!existsSync(filePath)) return `Error: file not found: ${input.path}`;
        return readFileSync(filePath, "utf-8");
      }
      case "write_file": {
        const filePath = safePath(projectPath, input.path as string);
        if (!filePath) return "Error: path traversal blocked";
        const dir = dirname(filePath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(filePath, input.content as string);
        return `File written: ${input.path}`;
      }
      case "list_files": {
        const dirPath = safePath(projectPath, (input.path as string) || ".");
        if (!dirPath) return "Error: path traversal blocked";
        if (!existsSync(dirPath)) return `Error: directory not found: ${input.path}`;
        return readdirSync(dirPath).join("\n");
      }
      case "run_command": {
        const cmd = input.command as string;
        const args = (input.args as string[]) || [];
        const result = execFileSync(cmd, args, {
          cwd: projectPath,
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
          encoding: "utf-8",
        });
        return result.slice(0, 5000);
      }
      case "search_files": {
        const pattern = input.pattern as string;
        const searchDir = safePath(projectPath, (input.path as string) || ".");
        if (!searchDir) return "Error: path traversal blocked";
        try {
          const result = execFileSync("grep", ["-rn", "--include=*.*", pattern, searchDir], {
            timeout: 10_000,
            encoding: "utf-8",
            maxBuffer: 1024 * 1024,
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

// ---------------------------------------------------------------------------
// Main execution loop
// ---------------------------------------------------------------------------

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
    db.update(schema.tasks)
      .set({ assignedAgentId: agentId, updatedAt: Date.now() })
      .where(eq(schema.tasks.id, taskId))
      .run();
  }

  // Get agent + memories
  const agent = db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
  if (!agent || !agent.isActive) throw new Error("Agent not active");

  const memories = db
    .select()
    .from(schema.agentMemories)
    .where(eq(schema.agentMemories.agentId, agentId))
    .all();

  // Build enriched system prompt
  let systemPrompt = agent.systemPrompt;
  if (memories.length > 0) {
    const memLines = memories.map((m) => `- [${m.type}] ${m.content}`).join("\n");
    systemPrompt += `\n\n## Your Memories\n${memLines}`;
  }

  systemPrompt += `\n\n## Current Task
- Title: ${task.title}
- Description: ${task.description || "N/A"}
- Priority: ${task.priority}
- Category: ${task.category}
- Project: ${project.name} (${project.path})

When done, call the task_complete tool with a summary of what you did and status "review" (success) or "failed" (error).`;

  // Advance to in_progress
  db.update(schema.tasks)
    .set({ status: "in_progress", updatedAt: Date.now() })
    .where(eq(schema.tasks.id, taskId))
    .run();
  io.emit("task:status", { taskId, status: "in_progress", agentId });
  io.emit("agent:status", { agentId, status: "running", taskId, progress: 0 });

  db.insert(schema.taskLogs)
    .values({
      id: nanoid(),
      taskId,
      agentId,
      action: "status_change",
      detail: "assigned → in_progress",
      createdAt: Date.now(),
    })
    .run();

  // Filter tools based on agent's allowed tools
  const allowedTools: string[] = agent.allowedTools ? JSON.parse(agent.allowedTools) : [];
  const agentTools = TOOLS.filter((t) => {
    if (t.name === "task_complete") return true;
    if (t.name === "read_file" && allowedTools.includes("Read")) return true;
    if (t.name === "write_file" && (allowedTools.includes("Write") || allowedTools.includes("Edit"))) return true;
    if (t.name === "list_files" && (allowedTools.includes("Glob") || allowedTools.includes("Read"))) return true;
    if (t.name === "run_command" && allowedTools.includes("Bash")) return true;
    if (t.name === "search_files" && allowedTools.includes("Grep")) return true;
    return false;
  });

  // Build initial messages
  const messages: ClaudeMessage[] = [
    {
      role: "user",
      content: `Execute this task:\n\nTitle: ${task.title}\nDescription: ${task.description || "No description"}\n\nProject directory: ${project.path}\n\nUse the available tools to complete the task. When finished, call task_complete.`,
    },
  ];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let iteration = 0;
  const MAX_ITERATIONS = 20;
  let taskComplete = false;

  while (iteration < MAX_ITERATIONS && !taskComplete) {
    iteration++;
    io.emit("agent:status", {
      agentId,
      status: "running",
      taskId,
      progress: Math.min(90, (iteration / MAX_ITERATIONS) * 100),
    });

    let response: ClaudeResponse;
    try {
      response = await callClaudeAPI(
        agent.model,
        systemPrompt,
        messages,
        agentTools,
        16000,
        agent.maxThinkingTokens,
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "API error";
      io.emit("agent:status", { agentId, status: "error", taskId });
      db.update(schema.tasks)
        .set({ status: "failed", result: errMsg, updatedAt: Date.now() })
        .where(eq(schema.tasks.id, taskId))
        .run();
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

        db.insert(schema.messages)
          .values({
            id: nanoid(),
            projectId: project.id,
            taskId,
            agentId,
            role: "assistant",
            content: block.text,
            createdAt: Date.now(),
          })
          .run();
      }

      // Preserve thinking blocks in the conversation
      if (block.type === "thinking") {
        assistantContent.push(block);
      }

      if (block.type === "tool_use" && block.name && block.id) {
        assistantContent.push(block);

        io.emit("agent:tool_use", {
          agentId,
          taskId,
          tool: block.name,
          input: block.input,
        });

        // Execute tool
        const toolResult = executeTool(block.name, block.input || {}, project.path);

        // Check for task_complete signal
        if (toolResult.startsWith("TASK_COMPLETE:")) {
          const [, status, ...resultParts] = toolResult.split(":");
          const result = resultParts.join(":");
          const nextStatus = status === "review" ? "review" : "failed";
          const cost = (totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000;

          db.update(schema.tasks)
            .set({
              status: nextStatus,
              result,
              costUsd: cost.toFixed(4),
              tokensUsed: totalInputTokens + totalOutputTokens,
              updatedAt: Date.now(),
            })
            .where(eq(schema.tasks.id, taskId))
            .run();

          io.emit("task:status", { taskId, status: nextStatus, agentId });
          io.emit("agent:status", { agentId, status: "idle", taskId });
          io.emit("agent:result", { agentId, taskId, result, status: nextStatus });

          db.insert(schema.taskLogs)
            .values({
              id: nanoid(),
              taskId,
              agentId,
              action: "status_change",
              detail: `in_progress → ${nextStatus}: ${result.slice(0, 200)}`,
              createdAt: Date.now(),
            })
            .run();

          taskComplete = true;
          break;
        }

        io.emit("agent:result", {
          agentId,
          taskId,
          tool: block.name,
          result: toolResult.slice(0, 500),
        });

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
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("\n");

      const cost = (totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000;

      db.update(schema.tasks)
        .set({
          status: "review",
          result: textContent.slice(0, 5000),
          costUsd: cost.toFixed(4),
          tokensUsed: totalInputTokens + totalOutputTokens,
          updatedAt: Date.now(),
        })
        .where(eq(schema.tasks.id, taskId))
        .run();

      io.emit("task:status", { taskId, status: "review", agentId });
      io.emit("agent:status", { agentId, status: "idle", taskId });
      taskComplete = true;
    }
  }

  // Max iterations reached without completion
  if (!taskComplete) {
    const cost = (totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000;

    db.update(schema.tasks)
      .set({
        status: "failed",
        result: "Max iterations reached",
        costUsd: cost.toFixed(4),
        tokensUsed: totalInputTokens + totalOutputTokens,
        updatedAt: Date.now(),
      })
      .where(eq(schema.tasks.id, taskId))
      .run();

    io.emit("task:status", { taskId, status: "failed", agentId });
    io.emit("agent:status", { agentId, status: "idle", taskId });

    db.insert(schema.taskLogs)
      .values({
        id: nanoid(),
        taskId,
        agentId,
        action: "status_change",
        detail: "in_progress → failed: Max iterations reached",
        createdAt: Date.now(),
      })
      .run();
  }
}
