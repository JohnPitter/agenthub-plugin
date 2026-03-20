import {
  db,
  schema
} from "./chunk-5B52KKSZ.js";

// src/lib/task-executor.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
async function executeTask(taskId, io) {
  const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
  if (!task) throw new Error("Task not found");
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, task.projectId)).get();
  if (!project) throw new Error("Project not found");
  let agentId = task.assignedAgentId;
  if (!agentId) {
    const techLead = db.select().from(schema.agents).where(eq(schema.agents.role, "tech_lead")).get();
    if (!techLead) throw new Error("No Tech Lead agent found");
    agentId = techLead.id;
    db.update(schema.tasks).set({ assignedAgentId: agentId, updatedAt: Date.now() }).where(eq(schema.tasks.id, taskId)).run();
  }
  const agent = db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
  if (!agent || !agent.isActive) throw new Error("Agent not active");
  const memories = db.select().from(schema.agentMemories).where(eq(schema.agentMemories.agentId, agentId)).all();
  let systemPrompt = agent.systemPrompt;
  if (agent.soul) systemPrompt += `

${agent.soul}`;
  if (memories.length > 0) {
    const memLines = memories.map((m) => `- [${m.type}] ${m.content}`).join("\n");
    systemPrompt += `

## Your Memories
${memLines}`;
  }
  systemPrompt += `

## Current Task
- Title: ${task.title}
- Description: ${task.description || "N/A"}
- Priority: ${task.priority}
- Category: ${task.category}
- Project: ${project.name} (${project.path})

Complete this task using the available tools. Work in the project directory.`;
  const allowedTools = agent.allowedTools ? JSON.parse(agent.allowedTools) : [];
  const SDK_TOOL_NAMES = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"];
  const sdkTools = allowedTools.filter((t) => SDK_TOOL_NAMES.includes(t));
  const permissionMode = agent.permissionMode || "acceptEdits";
  const isBypass = permissionMode === "bypassPermissions";
  db.update(schema.tasks).set({ status: "in_progress", updatedAt: Date.now() }).where(eq(schema.tasks.id, taskId)).run();
  io.emit("task:status", { taskId, status: "in_progress", agentId });
  io.emit("agent:status", { agentId, status: "running", taskId, progress: 0 });
  io.emit("board:activity", { agentId, action: "status:running", detail: `${agent.name} started: ${task.title}` });
  db.insert(schema.taskLogs).values({
    id: nanoid(),
    taskId,
    agentId,
    action: "status_change",
    detail: "assigned \u2192 in_progress",
    createdAt: Date.now()
  }).run();
  let resultText = "";
  let finalStatus = "review";
  let costUsd = 0;
  let tokensUsed = 0;
  try {
    const options = {
      cwd: project.path,
      tools: sdkTools,
      allowedTools: sdkTools,
      systemPrompt,
      model: agent.model,
      permissionMode,
      maxTurns: 20,
      persistSession: false,
      ...isBypass ? { allowDangerouslySkipPermissions: true } : {}
    };
    for await (const message of query({ prompt: buildPrompt(task, project), options })) {
      handleMessage(message, agentId, taskId, project.id, io);
      if (message.type === "result") {
        const result = message;
        costUsd = result.total_cost_usd ?? 0;
        tokensUsed = (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0);
        if (result.subtype === "success" && "result" in result) {
          resultText = result.result;
        } else if (result.is_error) {
          finalStatus = "failed";
          resultText = "errors" in result ? result.errors.join("; ") : "Execution failed";
        }
      }
    }
  } catch (err) {
    resultText = err instanceof Error ? err.message : "Execution failed";
    finalStatus = "failed";
    io.emit("agent:status", { agentId, status: "error", taskId });
  }
  db.update(schema.tasks).set({
    status: finalStatus,
    result: resultText.slice(0, 5e3),
    costUsd: costUsd.toFixed(4),
    tokensUsed,
    updatedAt: Date.now()
  }).where(eq(schema.tasks.id, taskId)).run();
  io.emit("task:status", { taskId, status: finalStatus, agentId });
  io.emit("task:updated", { task: db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get() });
  io.emit("agent:status", { agentId, status: "idle", taskId });
  io.emit("agent:result", { agentId, taskId, result: resultText.slice(0, 500), status: finalStatus });
  io.emit("board:activity", { agentId, action: `task:${finalStatus}`, detail: `${task.title} \u2192 ${finalStatus}` });
  db.insert(schema.taskLogs).values({
    id: nanoid(),
    taskId,
    agentId,
    action: "status_change",
    detail: `in_progress \u2192 ${finalStatus}: ${resultText.slice(0, 200)}`,
    createdAt: Date.now()
  }).run();
}
function buildPrompt(task, project) {
  return [
    "Execute this task:",
    "",
    `Title: ${task.title}`,
    `Description: ${task.description || "No description"}`,
    "",
    `Project directory: ${project.path}`,
    "",
    "Use the available tools to complete the task. When done, summarize what you did."
  ].join("\n");
}
function handleMessage(message, agentId, taskId, projectId, io) {
  if (message.type === "assistant") {
    const assistantMsg = message;
    for (const block of assistantMsg.message.content) {
      if (block.type === "text") {
        io.emit("agent:message", { agentId, taskId, content: block.text.slice(0, 500) });
        db.insert(schema.messages).values({
          id: nanoid(),
          projectId,
          taskId,
          agentId,
          role: "assistant",
          content: block.text.slice(0, 2e3),
          createdAt: Date.now()
        }).run();
      }
    }
  }
}
export {
  executeTask
};
