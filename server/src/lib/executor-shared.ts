import { nanoid } from "nanoid";
import { db, schema } from "../db.js";
import { eq } from "drizzle-orm";
import { taskLog } from "./task-logger.js";
import type { SDKMessage, SDKAssistantMessage } from "@anthropic-ai/claude-agent-sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionIO {
  emit: (event: string, data: unknown) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SDK_TOOL_NAMES = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"];

// ---------------------------------------------------------------------------
// Shared functions
// ---------------------------------------------------------------------------

/** Parse allowed tools JSON, filter to SDK tools */
export function parseSdkTools(allowedToolsJson: string | null): string[] {
  const tools: string[] = allowedToolsJson ? JSON.parse(allowedToolsJson) : [];
  return tools.filter((t) => SDK_TOOL_NAMES.includes(t));
}

/** Parse project stack from JSON string */
export function parseStack(stackJson: string | null): string[] {
  try {
    return stackJson ? JSON.parse(stackJson) : [];
  } catch {
    return [];
  }
}

/** Build memories prompt with batched agent lookup (avoids N+1) */
export function buildMemoriesPrompt(): string {
  const memories = db.select().from(schema.agentMemories).all();
  if (memories.length === 0) return "";

  // Batch fetch all agent names — O(1) lookup instead of N queries
  const allAgents = db.select().from(schema.agents).all();
  const agentNameMap = new Map(allAgents.map((a) => [a.id, a.name]));

  const memLines = memories.slice(-30).map((m) => {
    const author = m.agentId ? (agentNameMap.get(m.agentId) ?? "unknown") : "system";
    return `- [${m.type}] (by ${author}) ${m.content}`;
  }).join("\n");

  return `\n\n## Team Insights (shared memories from all agents)\n${memLines}`;
}

/** Build the user prompt for agent execution */
export function buildPrompt(
  task: { title: string; description: string | null },
  project: { path: string },
): string {
  return [
    "Execute this task:",
    "",
    `Title: ${task.title}`,
    `Description: ${task.description || "No description"}`,
    "",
    `Project directory: ${project.path}`,
    "",
    "IMPORTANT STRUCTURAL RULES:",
    "- If the task requires BOTH frontend and backend, use a monorepo structure:",
    "  apps/web/ for frontend, apps/server/ for backend, packages/shared/ for shared types",
    "- Initialize with proper tooling (package.json with workspaces, tsconfig references)",
    "- If the project already has a structure, follow it — do NOT reorganize",
    "",
    "Use the available tools to complete the task. When done, summarize what you did.",
    "",
    "At the END of your response, include a MEMORY section with insights you discovered during this task.",
    "These insights are shared with ALL agents on the team — write things that would help others.",
    "Format exactly like this (one per line):",
    "",
    "MEMORY_START",
    "[insight] This project uses PostgreSQL with Prisma ORM, connection string in .env",
    "[discovery] The auth system uses JWT stored in httpOnly cookies, not localStorage",
    "[warning] The /api/users endpoint has no rate limiting — needs fixing",
    "[pattern] All React components follow: feature-name/index.tsx + feature-name.styles.ts",
    "[dependency] Project depends on sharp for image processing — requires native build",
    "MEMORY_END",
    "",
    "Focus on project-specific insights: architecture decisions, hidden dependencies,",
    "non-obvious configurations, gotchas, patterns. Skip generic programming knowledge.",
  ].join("\n");
}

/** Handle SDK message — log to DB and emit socket event */
export function handleMessage(
  message: SDKMessage,
  agentId: string,
  taskId: string,
  projectId: string,
  io: ExecutionIO,
): void {
  if (message.type === "assistant") {
    const assistantMsg = message as SDKAssistantMessage;
    for (const block of assistantMsg.message.content) {
      if (block.type === "text") {
        io.emit("agent:message", { agentId, taskId, content: block.text.slice(0, 500) });
        db.insert(schema.messages).values({
          id: nanoid(), projectId, taskId, agentId,
          role: "assistant", content: block.text.slice(0, 2000), createdAt: Date.now(),
        }).run();
      }
    }
  }
}

/** Extract and save agent memories from result text (N+1 fixed) */
export function extractAndSaveMemories(agentId: string, taskId: string, resultText: string): void {
  const match = resultText.match(/MEMORY_START\n([\s\S]*?)MEMORY_END/);
  if (!match) return;

  // Fetch existing memories ONCE before the loop — avoids N+1 queries
  const existingContent = new Set(
    db.select().from(schema.agentMemories)
      .where(eq(schema.agentMemories.agentId, agentId)).all()
      .map((m) => m.content),
  );

  const lines = match[1].trim().split("\n").filter((l) => l.trim().startsWith("["));
  for (const line of lines) {
    const typeMatch = line.match(/^\[(\w+)\]\s*(.+)/);
    if (!typeMatch) continue;

    const type = typeMatch[1];
    const content = typeMatch[2].trim();
    if (!content || content.length < 10) continue;

    if (existingContent.has(content)) continue;

    db.insert(schema.agentMemories).values({
      id: nanoid(), agentId, taskId, type, content, source: "auto", createdAt: Date.now(),
    }).run();
    existingContent.add(content); // prevent duplicates within same batch
    taskLog(taskId, "shared", `Saved memory for agent ${agentId}: [${type}] ${content.slice(0, 60)}`);
  }
}
