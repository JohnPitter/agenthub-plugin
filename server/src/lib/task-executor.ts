import { query, type Options, type SDKResultMessage, type SDKAssistantMessage, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { nanoid } from "nanoid";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, cpSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { db, schema } from "../db.js";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Workflow types (mirrors shared AgentWorkflow)
// ---------------------------------------------------------------------------

interface WorkflowStepData {
  id: string;
  agentId: string;
  label: string;
  nextSteps: string[];
  nextStepLabels?: string[];
}

interface WorkflowData {
  id: string;
  name: string;
  entryStepId: string;
  steps: WorkflowStepData[];
  isDefault?: boolean;
}

const WORKFLOW_FILE = join(homedir(), ".agenthub-local", "workflow.json");

function readWorkflows(): WorkflowData[] {
  try {
    if (!existsSync(WORKFLOW_FILE)) return [];
    const raw = readFileSync(WORKFLOW_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Find the default workflow (or first available) */
function getDefaultWorkflow(): WorkflowData | null {
  const workflows = readWorkflows();
  if (workflows.length === 0) return null;
  return workflows.find((w) => w.isDefault) ?? workflows[0];
}

/** Find the workflow step for a given agentId */
function findStepByAgentId(workflow: WorkflowData, agentId: string): WorkflowStepData | null {
  return workflow.steps.find((s) => s.agentId === agentId) ?? null;
}

/** Get the next agent step in the workflow chain */
function getNextStep(workflow: WorkflowData, currentAgentId: string): WorkflowStepData | null {
  const currentStep = findStepByAgentId(workflow, currentAgentId);
  if (!currentStep || currentStep.nextSteps.length === 0) return null;
  const nextStepId = currentStep.nextSteps[0]; // take the first/primary next step
  return workflow.steps.find((s) => s.id === nextStepId) ?? null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExecutionIO {
  emit: (event: string, data: unknown) => void;
}

// ---------------------------------------------------------------------------
// Main execution
// ---------------------------------------------------------------------------

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
    db.update(schema.tasks)
      .set({ assignedAgentId: agentId, updatedAt: Date.now() })
      .where(eq(schema.tasks.id, taskId))
      .run();
  }

  const agent = db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
  if (!agent || !agent.isActive) throw new Error("Agent not active");

  // Build enriched system prompt with soul + memories
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
- Project: ${project.name} (${project.path})`;

  // Map agent's allowed tools to SDK tool names
  const allowedTools: string[] = agent.allowedTools ? JSON.parse(agent.allowedTools) : [];
  const SDK_TOOL_NAMES = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"];
  const sdkTools = allowedTools.filter(t => SDK_TOOL_NAMES.includes(t));

  // Resolve permission mode
  const permissionMode = (agent.permissionMode as Options["permissionMode"]) || "acceptEdits";
  const isBypass = permissionMode === "bypassPermissions";

  // ─── Task Isolation: branch (git) or tmp folder (no git) ───
  const isGitRepo = existsSync(join(project.path, ".git"));
  const branchName = `task/${taskId.slice(0, 12)}`;
  let workDir = project.path;
  let tmpDir: string | null = null;
  let originalBranch: string | null = null;

  if (isGitRepo) {
    // Git project → create branch for this task
    try {
      originalBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: project.path, timeout: 5000, encoding: "utf-8" }).trim();
      // Stash any uncommitted work
      try { execFileSync("git", ["stash", "--include-untracked"], { cwd: project.path, timeout: 5000 }); } catch { /* nothing to stash */ }
      // Create and checkout task branch
      try {
        execFileSync("git", ["checkout", "-b", branchName], { cwd: project.path, timeout: 5000 });
      } catch {
        // Branch may already exist (re-execution), just checkout
        execFileSync("git", ["checkout", branchName], { cwd: project.path, timeout: 5000 });
      }
      db.update(schema.tasks).set({ branch: branchName, updatedAt: Date.now() }).where(eq(schema.tasks.id, taskId)).run();
    } catch (err) {
      console.error(`[TaskExecutor] Branch creation failed: ${err}`);
      // Fall back to working on current branch
    }
  } else {
    // No git → create temporary copy of project
    const tasksDir = join(homedir(), "Projects", ".agenthub-tasks");
    tmpDir = join(tasksDir, taskId);
    if (!existsSync(tasksDir)) mkdirSync(tasksDir, { recursive: true });
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
    try {
      cpSync(project.path, tmpDir, {
        recursive: true,
        filter: (src) => !src.includes("node_modules") && !src.includes(".git"),
      });
      workDir = tmpDir;
    } catch (err) {
      console.error(`[TaskExecutor] Temp copy failed: ${err}`);
      // Fall back to original directory
    }
  }

  // Add workspace info to prompt
  if (isGitRepo) {
    systemPrompt += `\n- Branch: ${branchName} (isolated from main branch)`;
  } else if (tmpDir) {
    systemPrompt += `\n- Workspace: isolated copy at ${tmpDir}`;
  }
  systemPrompt += `\n\nComplete this task using the available tools. Your changes are isolated and won't affect the main project until approved.`;

  // Advance to in_progress
  db.update(schema.tasks)
    .set({ status: "in_progress", updatedAt: Date.now() })
    .where(eq(schema.tasks.id, taskId))
    .run();
  io.emit("task:status", { taskId, status: "in_progress", agentId });
  io.emit("agent:status", { agentId, status: "running", taskId, progress: 0 });
  io.emit("board:activity", { agentId, action: "status:running", detail: `${agent.name} started: ${task.title}` });

  db.insert(schema.taskLogs).values({
    id: nanoid(), taskId, agentId, action: "status_change",
    detail: "assigned → in_progress", createdAt: Date.now(),
  }).run();

  let resultText = "";
  let finalStatus: "review" | "failed" = "review";
  let costUsd = 0;
  let tokensUsed = 0;

  try {
    const options: Options = {
      cwd: workDir,
      tools: sdkTools,
      allowedTools: sdkTools,
      systemPrompt,
      model: agent.model,
      permissionMode,
      maxTurns: 20,
      persistSession: false,
      ...(isBypass ? { allowDangerouslySkipPermissions: true } : {}),
    };

    for await (const message of query({ prompt: buildPrompt(task, project), options })) {
      handleMessage(message, agentId, taskId, project.id, io);

      // Extract result from final message
      if (message.type === "result") {
        const result = message as SDKResultMessage;
        costUsd = result.total_cost_usd ?? 0;
        tokensUsed = (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0);

        if (result.subtype === "success" && "result" in result) {
          resultText = result.result;
        } else if (result.is_error) {
          finalStatus = "failed";
          resultText = "errors" in result
            ? (result.errors as string[]).join("; ")
            : "Execution failed";
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
    costUsd: costUsd.toFixed(4),
    tokensUsed,
    updatedAt: Date.now(),
  }).where(eq(schema.tasks.id, taskId)).run();

  io.emit("task:status", { taskId, status: finalStatus, agentId });
  io.emit("task:updated", { task: db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get() });
  io.emit("agent:status", { agentId, status: "idle", taskId });
  io.emit("agent:result", { agentId, taskId, result: resultText.slice(0, 500), status: finalStatus });
  io.emit("board:activity", { agentId, action: `task:${finalStatus}`, detail: `${task.title} → ${finalStatus}` });

  db.insert(schema.taskLogs).values({
    id: nanoid(), taskId, agentId, action: "status_change",
    detail: `in_progress → ${finalStatus}: ${resultText.slice(0, 200)}`,
    createdAt: Date.now(),
  }).run();

  // ─── Cleanup: switch back to original branch or handle tmp dir ───
  if (isGitRepo && originalBranch) {
    try {
      // Commit any changes on the task branch
      try {
        execFileSync("git", ["add", "-A"], { cwd: project.path, timeout: 5000 });
        execFileSync("git", ["commit", "-m", `task: ${task.title}`], { cwd: project.path, timeout: 10000 });
      } catch { /* nothing to commit */ }
      // Switch back to original branch
      execFileSync("git", ["checkout", originalBranch], { cwd: project.path, timeout: 5000 });
      // Restore stashed work
      try { execFileSync("git", ["stash", "pop"], { cwd: project.path, timeout: 5000 }); } catch { /* no stash */ }
    } catch (err) {
      console.error(`[TaskExecutor] Branch cleanup failed: ${err}`);
    }
  } else if (tmpDir && existsSync(tmpDir)) {
    // For non-git projects, keep the tmp dir as the task workspace
    // Log the location for reference
    db.insert(schema.taskLogs).values({
      id: nanoid(), taskId, agentId, action: "workspace",
      detail: `Task workspace: ${tmpDir}`, createdAt: Date.now(),
    }).run();
  }

  // ─── Workflow chaining: check if there's a next agent to run ───
  if (finalStatus === "review") {
    try {
      const workflow = getDefaultWorkflow();
      if (workflow) {
        const nextStep = getNextStep(workflow, agentId);
        if (nextStep && nextStep.agentId) {
          const nextAgent = db.select().from(schema.agents).where(eq(schema.agents.id, nextStep.agentId)).get();
          if (nextAgent && nextAgent.isActive) {
            console.log(`[TaskExecutor] Workflow chain: ${agent.name} → ${nextAgent.name} for task ${taskId}`);

            db.insert(schema.taskLogs).values({
              id: nanoid(), taskId, agentId: nextAgent.id, action: "workflow_chain",
              detail: `Workflow chain: ${agent.name} → ${nextAgent.name}`,
              createdAt: Date.now(),
            }).run();

            // Determine if this is a QA step (agent role is "qa")
            const isQaStep = nextAgent.role === "qa";

            if (isQaStep) {
              await executeWorkflowQaStep(taskId, nextAgent, task, project, resultText, io, workflow);
            } else {
              // Generic chain: assign to next agent and re-execute
              db.update(schema.tasks).set({
                assignedAgentId: nextAgent.id,
                status: "assigned",
                updatedAt: Date.now(),
              }).where(eq(schema.tasks.id, taskId)).run();
              io.emit("task:status", { taskId, status: "assigned", agentId: nextAgent.id });
              io.emit("task:updated", { task: db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get() });
              // Re-execute with the next agent
              await executeTask(taskId, io);
            }
          }
        }
      }
    } catch (err) {
      console.error(`[TaskExecutor] Workflow chain failed: ${err}`);
      // Graceful degradation — task stays at "review" for manual handling
    }
  }
}

// ---------------------------------------------------------------------------
// Workflow QA step — runs a QA agent, checks for QA_APPROVED / QA_REJECTED
// ---------------------------------------------------------------------------

async function executeWorkflowQaStep(
  taskId: string,
  qaAgent: { id: string; name: string; model: string; systemPrompt: string; soul: string | null; allowedTools: string | null; permissionMode: string | null },
  task: { title: string; description: string | null; assignedAgentId: string | null; priority: string; category: string | null },
  project: { id: string; name: string; path: string },
  devResult: string,
  io: ExecutionIO,
  workflow: WorkflowData,
): Promise<void> {
  const qaAgentId = qaAgent.id;

  // Build QA system prompt
  const qaMemories = db.select().from(schema.agentMemories)
    .where(eq(schema.agentMemories.agentId, qaAgentId)).all();

  let qaSystemPrompt = qaAgent.systemPrompt;
  if (qaAgent.soul) qaSystemPrompt += `\n\n${qaAgent.soul}`;
  if (qaMemories.length > 0) {
    const memLines = qaMemories.map(m => `- [${m.type}] ${m.content}`).join("\n");
    qaSystemPrompt += `\n\n## Your Memories\n${memLines}`;
  }

  qaSystemPrompt += `\n\n## QA Review Task
- Title: ${task.title}
- Description: ${task.description || "N/A"}
- Priority: ${task.priority}
- Category: ${task.category}
- Project: ${project.name} (${project.path})

## Developer Result
${devResult.slice(0, 3000)}

## Instructions
Review the developer's work. Check for correctness, code quality, and completeness.
- If the work is acceptable, respond with QA_APPROVED at the end of your response.
- If the work needs fixes, respond with QA_REJECTED at the end of your response and explain what needs to change.`;

  // Update task status
  db.update(schema.tasks).set({
    assignedAgentId: qaAgentId,
    status: "in_progress",
    updatedAt: Date.now(),
  }).where(eq(schema.tasks.id, taskId)).run();

  io.emit("task:status", { taskId, status: "in_progress", agentId: qaAgentId });
  io.emit("agent:status", { agentId: qaAgentId, status: "running", taskId, progress: 0 });
  io.emit("board:activity", { agentId: qaAgentId, action: "status:running", detail: `${qaAgent.name} reviewing: ${task.title}` });

  db.insert(schema.taskLogs).values({
    id: nanoid(), taskId, agentId: qaAgentId, action: "status_change",
    detail: "review → in_progress (QA)", createdAt: Date.now(),
  }).run();

  const allowedTools: string[] = qaAgent.allowedTools ? JSON.parse(qaAgent.allowedTools) : [];
  const SDK_TOOL_NAMES = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"];
  const sdkTools = allowedTools.filter(t => SDK_TOOL_NAMES.includes(t));
  const permissionMode = (qaAgent.permissionMode as Options["permissionMode"]) || "acceptEdits";
  const isBypass = permissionMode === "bypassPermissions";

  let qaResultText = "";
  let qaStatus: "done" | "assigned" | "failed" = "failed";
  let qaCost = 0;
  let qaTokens = 0;

  try {
    const qaOptions: Options = {
      cwd: project.path,
      tools: sdkTools,
      allowedTools: sdkTools,
      systemPrompt: qaSystemPrompt,
      model: qaAgent.model,
      permissionMode,
      maxTurns: 10,
      persistSession: false,
      ...(isBypass ? { allowDangerouslySkipPermissions: true } : {}),
    };

    const qaPrompt = [
      "Review the developer's work on this task:",
      "",
      `Title: ${task.title}`,
      `Description: ${task.description || "No description"}`,
      "",
      "Developer's result summary:",
      devResult.slice(0, 2000),
      "",
      "Review the changes and respond with QA_APPROVED or QA_REJECTED.",
    ].join("\n");

    for await (const message of query({ prompt: qaPrompt, options: qaOptions })) {
      handleMessage(message, qaAgentId, taskId, project.id, io);

      if (message.type === "result") {
        const result = message as SDKResultMessage;
        qaCost = result.total_cost_usd ?? 0;
        qaTokens = (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0);

        if (result.subtype === "success" && "result" in result) {
          qaResultText = result.result;
        } else if (result.is_error) {
          qaResultText = "errors" in result
            ? (result.errors as string[]).join("; ")
            : "QA execution failed";
        }
      }
    }

    // Determine QA verdict
    if (qaResultText.includes("QA_APPROVED")) {
      qaStatus = "done";
    } else if (qaResultText.includes("QA_REJECTED")) {
      qaStatus = "assigned"; // back to dev for rework
    } else {
      // No clear verdict — default to review for manual handling
      qaStatus = "done"; // assume approved if no explicit rejection
    }
  } catch (err) {
    qaResultText = err instanceof Error ? err.message : "QA execution failed";
    qaStatus = "failed";
    io.emit("agent:status", { agentId: qaAgentId, status: "error", taskId });
  }

  // Determine the original dev agent for re-assignment on rejection
  const originalDevAgentId = task.assignedAgentId;

  // Update task with QA result
  const finalAssignedAgent = qaStatus === "assigned" && originalDevAgentId ? originalDevAgentId : qaAgentId;
  db.update(schema.tasks).set({
    status: qaStatus,
    result: qaResultText.slice(0, 5000),
    assignedAgentId: finalAssignedAgent,
    costUsd: qaCost.toFixed(4),
    tokensUsed: qaTokens,
    updatedAt: Date.now(),
  }).where(eq(schema.tasks.id, taskId)).run();

  io.emit("task:status", { taskId, status: qaStatus, agentId: qaAgentId });
  io.emit("task:updated", { task: db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get() });
  io.emit("agent:status", { agentId: qaAgentId, status: "idle", taskId });
  io.emit("agent:result", { agentId: qaAgentId, taskId, result: qaResultText.slice(0, 500), status: qaStatus });
  io.emit("board:activity", { agentId: qaAgentId, action: `task:${qaStatus}`, detail: `${task.title} → QA ${qaStatus === "done" ? "approved" : qaStatus === "assigned" ? "rejected" : "failed"}` });

  db.insert(schema.taskLogs).values({
    id: nanoid(), taskId, agentId: qaAgentId, action: "status_change",
    detail: `in_progress → ${qaStatus} (QA): ${qaResultText.slice(0, 200)}`,
    createdAt: Date.now(),
  }).run();

  // If QA rejected, re-trigger dev agent execution
  if (qaStatus === "assigned" && originalDevAgentId) {
    console.log(`[TaskExecutor] QA rejected — re-assigning to dev agent for task ${taskId}`);
    db.insert(schema.taskLogs).values({
      id: nanoid(), taskId, agentId: originalDevAgentId, action: "workflow_chain",
      detail: `QA rejected → re-assigned to dev agent`,
      createdAt: Date.now(),
    }).run();

    // Re-execute with the original dev agent
    await executeTask(taskId, io);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPrompt(
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
    "Use the available tools to complete the task. When done, summarize what you did.",
  ].join("\n");
}

function handleMessage(
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
