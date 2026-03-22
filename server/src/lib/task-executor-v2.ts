import { query, type Options, type SDKResultMessage, type SDKAssistantMessage, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { nanoid } from "nanoid";
import { execFileSync } from "child_process";
import { db, schema } from "../db.js";
import { eq } from "drizzle-orm";
import { triage, reviewMerge, routeQa, type TriageResult } from "./orchestrator.js";
import { createWorkspace, mergeWorkspaces, cleanupWorkspaces, isGitProject } from "./worktree-manager.js";
import { updateAgentState, clearAgentState, setV2TaskState, updateV2PhaseStatus, updateV2AgentProgress, clearV2TaskState } from "./execution-state.js";
import { taskLog, taskError } from "./task-logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExecutionIO {
  emit: (event: string, data: unknown) => void;
}

interface AgentResult {
  agentRole: string;
  agentId: string;
  success: boolean;
  result: string;
  costUsd: number;
  tokensUsed: number;
}

// ---------------------------------------------------------------------------
// Main V2 execution
// ---------------------------------------------------------------------------

export async function executeTaskV2(taskId: string, io: ExecutionIO): Promise<void> {
  try {
    await _executeTaskV2(taskId, io);
  } catch (err) {
    // Global safety net — if ANYTHING crashes, mark task as failed
    taskError(taskId, "V2", `FATAL: ${err}`);
    try {
      db.update(schema.tasks).set({ status: "failed", result: `Execution crashed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 5000), updatedAt: Date.now() })
        .where(eq(schema.tasks.id, taskId)).run();
      io.emit("task:status", { taskId, status: "failed" });
      io.emit("task:updated", { task: db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get() });
      clearV2TaskState(taskId);
    } catch { /* last resort */ }
  }
}

async function _executeTaskV2(taskId: string, io: ExecutionIO): Promise<void> {
  const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
  if (!task) throw new Error("Task not found");

  const project = db.select().from(schema.projects).where(eq(schema.projects.id, task.projectId)).get();
  if (!project) throw new Error("Project not found");

  taskLog(taskId, "V2", `Starting task: "${task.title}" (${taskId})`);

  // ─── Phase 0: Triage ───
  io.emit("task:status", { taskId, status: "in_progress" });
  db.update(schema.tasks).set({ status: "in_progress", updatedAt: Date.now() }).where(eq(schema.tasks.id, taskId)).run();
  io.emit("task:updated", { task: db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get() });

  let triageResult: TriageResult;
  try {
    triageResult = await triage(
      { title: task.title, description: task.description, priority: task.priority, category: task.category },
      { name: project.name, path: project.path, stack: project.stack },
    );
  } catch (err) {
    taskError(taskId, "V2", `Triage failed: ${err}`);
    triageResult = {
      complexity: "moderate",
      plan: task.title,
      phases: [{ agents: ["backend_dev"], parallel: false }],
      maxTurns: { backend_dev: 15 },
      skipQa: false,
    };
  }

  io.emit("v2:triage", {
    taskId,
    complexity: triageResult.complexity,
    phases: triageResult.phases,
    plan: triageResult.plan,
  });
  setV2TaskState(taskId, {
    taskId,
    complexity: triageResult.complexity,
    plan: triageResult.plan,
    phases: triageResult.phases.map((p) => ({ ...p, status: "pending" as const })),
    agentProgress: {},
    startedAt: Date.now(),
  });

  db.insert(schema.taskLogs).values({
    id: nanoid(), taskId, agentId: null, action: "v2_triage",
    detail: `Complexity: ${triageResult.complexity} | Plan: ${triageResult.plan} | Phases: ${triageResult.phases.length}`,
    createdAt: Date.now(),
  }).run();

  taskLog(taskId, "V2", `Triage: complexity=${triageResult.complexity}, phases=${triageResult.phases.length}`);

  // ─── Execute phases sequentially ───
  const allResults: AgentResult[] = [];
  let previousPhaseContext = "";
  let totalCost = 0;
  let totalTokens = 0;
  let hasFailed = false;

  for (let phaseIdx = 0; phaseIdx < triageResult.phases.length; phaseIdx++) {
    const phase = triageResult.phases[phaseIdx];
    const phaseAgents = resolveAgents(phase.agents);

    if (phaseAgents.length === 0) {
      taskLog(taskId, "V2", `Phase ${phaseIdx} has no valid agents, skipping`);
      continue;
    }

    updateV2PhaseStatus(taskId, phaseIdx, "running");
    io.emit("v2:phase_start", {
      taskId,
      phaseIndex: phaseIdx,
      agents: phase.agents,
      parallel: phase.parallel,
    });

    taskLog(taskId, "V2", `Phase ${phaseIdx}: agents=[${phase.agents.join(",")}], parallel=${phase.parallel}`);

    let phaseResults: AgentResult[];

    if (phase.parallel && phaseAgents.length > 1) {
      // ─── Parallel execution ───
      phaseResults = await executeAgentsParallel(
        taskId, task, project, phaseAgents, triageResult, phaseIdx,
        previousPhaseContext, phase.context, io,
      );
    } else {
      // ─── Sequential execution ───
      phaseResults = [];
      for (const agent of phaseAgents) {
        const result = await executeAgent(
          taskId, task, project, agent, triageResult, phaseIdx,
          previousPhaseContext, phase.context, io,
        );
        phaseResults.push(result);
        if (!result.success) break;
      }
    }

    // Collect results
    for (const r of phaseResults) {
      allResults.push(r);
      totalCost += r.costUsd;
      totalTokens += r.tokensUsed;
      if (!r.success) hasFailed = true;
    }

    // Build context for next phase
    previousPhaseContext = phaseResults
      .map((r) => `## ${r.agentRole} result:\n${r.result.slice(0, 3000)}`)
      .join("\n\n");

    updateV2PhaseStatus(taskId, phaseIdx, "done");
    io.emit("v2:phase_complete", {
      taskId,
      phaseIndex: phaseIdx,
      results: phaseResults.map((r) => ({ agentRole: r.agentRole, success: r.success })),
    });

    if (hasFailed) {
      taskError(taskId, "V2", `Phase ${phaseIdx} had failures, stopping execution`);
      break;
    }

    // ─── Merge ALL phase results back to project (both single and parallel) ───
    {
      const agentRolesToMerge = phase.agents.filter((role) => phaseAgents.some((a) => a.role === role));
      if (agentRolesToMerge.length > 0) {
        try {
          if (isGitProject(project.path)) {
            // Commit changes in each worktree before merging
            const os = await import("os");
            const pathMod = await import("path");
            for (const role of agentRolesToMerge) {
              const wtDir = pathMod.join(os.homedir(), "Projects", ".agenthub-tasks", taskId, role);
              try {
                execFileSync("git", ["add", "-A"], { cwd: wtDir, timeout: 15000, stdio: "pipe" });
                execFileSync("git", ["commit", "-m", `${role}: ${task.title}`], { cwd: wtDir, timeout: 15000, stdio: "pipe" });
                taskLog(taskId, "V2", `Committed ${role} worktree changes`);
              } catch { /* nothing to commit or not a git dir */ }
            }

            // Git: merge worktree branches into project
            const mergeResult = mergeWorkspaces(taskId, agentRolesToMerge, project.path);
            io.emit("v2:merge", { taskId, success: mergeResult.success, conflicts: mergeResult.conflicts });

            if (!mergeResult.success) {
              const review = await reviewMerge(mergeResult.conflicts, task.title);
              if (!review.approved) {
                taskError(taskId, "V2", `Merge conflicts: ${review.issues.join(", ")}`);
                db.insert(schema.taskLogs).values({
                  id: nanoid(), taskId, agentId: null, action: "v2_merge_conflict",
                  detail: `Conflicts: ${mergeResult.conflicts.map((c) => c.file).join(", ")}`,
                  createdAt: Date.now(),
                }).run();
              }
            }
            taskLog(taskId, "V2", `Git merge phase ${phaseIdx}: ${agentRolesToMerge.join(", ")}`);
          } else {
            // Non-git: copy files from each agent workspace back to project
            const { existsSync: fileExists, cpSync } = await import("fs");
            const path = await import("path");
            const os = await import("os");
            for (const role of agentRolesToMerge) {
              const agentWorkDir = path.join(os.homedir(), "Projects", ".agenthub-tasks", taskId, role);
              if (fileExists(agentWorkDir)) {
                cpSync(agentWorkDir, project.path, {
                  recursive: true,
                  force: true,
                  filter: (src: string) => !src.includes("node_modules") && !src.includes(".git"),
                });
                taskLog(taskId, "V2", `Copied ${role} results to ${project.path}`);
              }
            }
          }
        } catch (err) {
          taskError(taskId, "V2", `Phase ${phaseIdx} merge failed: ${err}`);
        }
      }
    }
  }

  // ─── Final status ───
  let finalStatus: "review" | "done" | "failed" = hasFailed ? "failed" : "review";
  const resultText = allResults.map((r) => `[${r.agentRole}] ${r.success ? "OK" : "FAILED"}: ${r.result.slice(0, 500)}`).join("\n\n");

  // ─── QA step (if not skipped) ───
  if (!hasFailed && !triageResult.skipQa) {
    const qaResult = await executeQaStep(taskId, task, project, triageResult, resultText, io);
    totalCost += qaResult.costUsd;
    totalTokens += qaResult.tokensUsed;

    if (qaResult.approved) {
      finalStatus = "done";
    } else if (qaResult.rejected) {
      // QA rejected → re-run failed agent or all
      finalStatus = "review"; // stays in review for manual handling in v2
    }
  } else if (!hasFailed && triageResult.skipQa) {
    finalStatus = "done";
    taskLog(taskId, "V2", `QA skipped (skipQa=true)`);
  }

  // ─── Auto-commit + merge to main branch (git projects) ───
  if ((finalStatus === "done" || finalStatus === "review") && isGitProject(project.path)) {
    try {
      // Remove stale index.lock if exists
      const { existsSync: fe, unlinkSync } = await import("fs");
      const path = await import("path");
      const lockFile = path.join(project.path, ".git", "index.lock");
      if (fe(lockFile)) { try { unlinkSync(lockFile); } catch { /* ignore */ } }

      execFileSync("git", ["add", "-A"], { cwd: project.path, timeout: 30000 });
      const coAuthors = allResults.map((r) => r.agentRole).join(", ");
      try {
        execFileSync("git", ["commit", "-m", `task: ${task.title}\n\nAgents: ${coAuthors}`], {
          cwd: project.path, timeout: 30000,
        });
      } catch { /* nothing to commit */ }

      // Detect current branch and main branch
      const currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: project.path, timeout: 10000, encoding: "utf-8" }).trim();
      let mainBranch = "main";
      try {
        const branches = execFileSync("git", ["branch", "--list"], { cwd: project.path, timeout: 10000, encoding: "utf-8" });
        if (branches.includes("main")) mainBranch = "main";
        else if (branches.includes("master")) mainBranch = "master";
      } catch { /* use default */ }

      // Merge task branch into main
      if (currentBranch.startsWith("task/") && currentBranch !== mainBranch) {
        execFileSync("git", ["checkout", mainBranch], { cwd: project.path, timeout: 10000 });
        execFileSync("git", ["merge", "--no-ff", currentBranch, "-m", `Merge task: ${task.title}`], { cwd: project.path, timeout: 30000 });
        // Clean up task branch
        try { execFileSync("git", ["branch", "-D", currentBranch], { cwd: project.path, timeout: 5000 }); } catch { /* ignore */ }
        taskLog(taskId, "V2", `Merged ${currentBranch} into ${mainBranch}`);
      }

      taskLog(taskId, "V2", `Auto-committed with co-authors: ${coAuthors}`);
      db.insert(schema.taskLogs).values({
        id: nanoid(), taskId, agentId: null, action: "git_commit",
        detail: `Auto-commit: ${task.title} (agents: ${coAuthors})`,
        createdAt: Date.now(),
      }).run();
      io.emit("task:git_commit", { taskId, projectId: project.id, message: `task: ${task.title}` });
    } catch (err) {
      taskError(taskId, "V2", `Auto-commit failed`, err);
    }
  }

  // ─── Update task ───
  db.update(schema.tasks).set({
    status: finalStatus,
    result: resultText.slice(0, 5000),
    costUsd: String(totalCost),
    tokensUsed: totalTokens,
    completedAt: finalStatus === "done" ? Date.now() : null,
    updatedAt: Date.now(),
  }).where(eq(schema.tasks.id, taskId)).run();

  io.emit("task:status", { taskId, status: finalStatus, agentId: allResults.length > 0 ? allResults[allResults.length - 1].agentId : undefined });
  io.emit("task:updated", { task: db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get() });
  io.emit("board:activity", { agentId: allResults.length > 0 ? allResults[allResults.length - 1].agentId : "", action: `task:${finalStatus}`, detail: `${task.title} → ${finalStatus}` });

  // Emit agent:result for frontend
  if (allResults.length > 0) {
    const lastResult = allResults[allResults.length - 1];
    io.emit("agent:result", { agentId: lastResult.agentId, taskId, result: lastResult.result.slice(0, 500), status: finalStatus });
  }

  // ─── Cleanup workspaces and state ───
  try {
    cleanupWorkspaces(taskId, project.path);
  } catch (err) {
    taskError(taskId, "V2", `Cleanup failed: ${err}`);
  }
  clearV2TaskState(taskId);

  taskLog(taskId, "V2", `Task "${task.title}" completed: status=${finalStatus}, cost=$${totalCost.toFixed(4)}, tokens=${totalTokens}`);
}

// ---------------------------------------------------------------------------
// Agent execution (single agent)
// ---------------------------------------------------------------------------

async function executeAgent(
  taskId: string,
  task: { title: string; description: string | null; priority: string; category: string | null },
  project: { id: string; name: string; path: string; stack: string | null },
  agent: { id: string; name: string; role: string; model: string; systemPrompt: string; soul: string | null; allowedTools: string | null; permissionMode: string | null; maxThinkingTokens: number | null },
  triageResult: TriageResult,
  phaseIndex: number,
  previousContext: string,
  phaseContext: string | undefined,
  io: ExecutionIO,
): Promise<AgentResult> {
  const agentId = agent.id;
  const agentRole = agent.role;
  const maxTurns = triageResult.maxTurns[agentRole] ?? 15;

  taskLog(taskId, "V2", `Executing agent: ${agent.name} (${agentRole}), maxTurns=${maxTurns}`);

  // Update task with current agent so frontend shows who's working
  db.update(schema.tasks).set({ assignedAgentId: agentId, updatedAt: Date.now() }).where(eq(schema.tasks.id, taskId)).run();
  io.emit("task:status", { taskId, status: "in_progress", agentId });
  io.emit("task:updated", { task: db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get() });

  io.emit("v2:agent_progress", { taskId, agentId, agentRole, status: "running", progress: 0, currentFile: "", phaseIndex });
  io.emit("agent:status", { agentId, status: "running", taskId, progress: 0 });
  updateAgentState(agentId, { agentId, agentRole, agentName: agent.name, status: "running", taskId, taskTitle: task.title, progress: 0, currentFile: "", currentTool: "" });
  updateV2AgentProgress(taskId, agentRole, 0, "running", "");

  // Create isolated workspace
  let workDir: string;
  try {
    workDir = createWorkspace(taskId, agentRole, project.path);
  } catch {
    workDir = project.path; // fallback to project dir
  }

  // Build system prompt with shared memories (all agents)
  const memories = db.select().from(schema.agentMemories).all();
  let systemPrompt = agent.systemPrompt;
  if (agent.soul) systemPrompt += `\n\n${agent.soul}`;
  if (memories.length > 0) {
    const memLines = memories.slice(-30).map((m) => {
      const author = m.agentId ? (db.select().from(schema.agents).where(eq(schema.agents.id, m.agentId)).get()?.name ?? "unknown") : "system";
      return `- [${m.type}] (by ${author}) ${m.content}`;
    }).join("\n");
    systemPrompt += `\n\n## Team Insights (shared memories from all agents)\n${memLines}`;
  }
  // Parse project stack
  let stackArr: string[] = [];
  try { stackArr = project.stack ? JSON.parse(project.stack) : []; } catch { /* ignore */ }
  const stackLabel = stackArr.length > 0 ? stackArr.join(", ") : "not specified";

  systemPrompt += `\n\n## Current Task\n- Title: ${task.title}\n- Description: ${task.description || "N/A"}\n- Priority: ${task.priority}\n- Project: ${project.name} (${workDir})\n- Stack/Technologies: ${stackLabel}`;

  if (stackArr.length > 0) {
    systemPrompt += `\n\n## IMPORTANT: Technology Stack
This project uses: ${stackLabel}.
- You MUST use these technologies when implementing. Do NOT use different frameworks.
- If the project directory is empty or has only a basic package.json, initialize it properly with the correct stack (e.g., \`npx @angular/cli new\`, \`npx create-react-app\`, etc.)
- All code, dependencies, and configuration must be consistent with the specified stack.`;
  }

  // If task was previously executed (retry/rejection), include previous result
  const taskRecord = db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
  if (taskRecord?.result) {
    const prevLogs = db.select().from(schema.taskLogs)
      .where(eq(schema.taskLogs.taskId, taskId)).all()
      .slice(-10)
      .map((l) => `[${l.action}] ${l.detail ?? ""}`).join("\n");
    systemPrompt += `\n\n## PREVIOUS EXECUTION (this task was rejected or failed — DO NOT start from scratch)
Previous result:
${taskRecord.result.slice(0, 3000)}

Previous logs:
${prevLogs}

IMPORTANT: The project directory already contains work from the previous attempt.
- Read the existing files first to understand what was already done
- Fix the issues — do NOT rewrite everything from scratch
- Build on top of existing work, only modify what needs to change`;
  }

  if (previousContext) {
    systemPrompt += `\n\n## Previous Phase Results\n${previousContext}`;
  }
  if (phaseContext) {
    systemPrompt += `\n\n## Phase Instructions\n${phaseContext}`;
  }

  systemPrompt += `\n\nComplete your part of this task using the available tools. Your workspace is isolated at: ${workDir}`;

  // SDK options
  const allowedTools: string[] = agent.allowedTools ? JSON.parse(agent.allowedTools) : [];
  const SDK_TOOL_NAMES = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"];
  const sdkTools = allowedTools.filter((t) => SDK_TOOL_NAMES.includes(t));
  const permissionMode = (agent.permissionMode as Options["permissionMode"]) || "acceptEdits";
  const isBypass = permissionMode === "bypassPermissions";

  const options: Options = {
    cwd: workDir,
    tools: sdkTools,
    allowedTools: sdkTools,
    systemPrompt,
    model: agent.model,
    permissionMode,
    maxTurns,
    persistSession: false,
    ...(isBypass ? { allowDangerouslySkipPermissions: true } : {}),
  };

  let resultText = "";
  let costUsd = 0;
  let tokensUsed = 0;
  let success = true;
  let turnCount = 0;

  try {
    const prompt = buildPrompt(task, { path: workDir });

    for await (const message of query({ prompt, options })) {
      turnCount++;
      const progress = Math.min(95, Math.round((turnCount / maxTurns) * 100));

      handleMessage(message, agentId, taskId, project.id, io);

      io.emit("v2:agent_progress", { taskId, agentId, agentRole, status: "running", progress, currentFile: "", phaseIndex });
      updateAgentState(agentId, { progress, status: "running" });
      updateV2AgentProgress(taskId, agentRole, progress, "running", "");

      if (message.type === "result") {
        const result = message as SDKResultMessage;
        costUsd = result.total_cost_usd ?? 0;
        tokensUsed = (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0);

        if (result.subtype === "success" && "result" in result) {
          resultText = result.result;
        } else if (result.is_error) {
          success = false;
          const errResult = result as SDKResultMessage & { errors?: string[]; result?: string };
          resultText = errResult.errors
            ? errResult.errors.join("\n")
            : errResult.result ?? "Unknown error";
        }
      }
    }
  } catch (err) {
    success = false;
    resultText = err instanceof Error ? err.message : String(err);
    taskError(taskId, "V2", `Agent ${agent.name} failed: ${resultText}`);
  }

  io.emit("v2:agent_progress", { taskId, agentId, agentRole, status: success ? "done" : "error", progress: 100, currentFile: "", phaseIndex });
  io.emit("v2:agent_complete", { taskId, agentRole, success, result_summary: resultText.slice(0, 200) });
  io.emit("agent:status", { agentId, status: "idle", taskId });
  clearAgentState(agentId);
  updateV2AgentProgress(taskId, agentRole, 100, success ? "done" : "error", "");

  db.insert(schema.taskLogs).values({
    id: nanoid(), taskId, agentId, action: "v2_agent_complete",
    detail: `${agent.name}: ${success ? "OK" : "FAILED"} (${turnCount} turns, $${costUsd.toFixed(4)})`,
    createdAt: Date.now(),
  }).run();

  // Extract and save agent learnings
  try { extractAndSaveMemories(agentId, taskId, resultText); } catch { /* non-critical */ }

  return { agentRole, agentId, success, result: resultText, costUsd, tokensUsed };
}

// ---------------------------------------------------------------------------
// Parallel execution
// ---------------------------------------------------------------------------

async function executeAgentsParallel(
  taskId: string,
  task: { title: string; description: string | null; priority: string; category: string | null },
  project: { id: string; name: string; path: string; stack: string | null },
  agents: { id: string; name: string; role: string; model: string; systemPrompt: string; soul: string | null; allowedTools: string | null; permissionMode: string | null; maxThinkingTokens: number | null }[],
  triageResult: TriageResult,
  phaseIndex: number,
  previousContext: string,
  phaseContext: string | undefined,
  io: ExecutionIO,
): Promise<AgentResult[]> {
  taskLog(taskId, "V2", `Parallel execution: ${agents.map((a) => a.name).join(", ")}`);

  const promises = agents.map((agent) =>
    executeAgent(taskId, task, project, agent, triageResult, phaseIndex, previousContext, phaseContext, io),
  );

  return Promise.all(promises);
}

// ---------------------------------------------------------------------------
// QA step
// ---------------------------------------------------------------------------

interface QaStepResult {
  approved: boolean;
  rejected: boolean;
  costUsd: number;
  tokensUsed: number;
}

async function executeQaStep(
  taskId: string,
  task: { title: string; description: string | null; priority: string; category: string | null },
  project: { id: string; name: string; path: string; stack: string | null },
  triageResult: TriageResult,
  devResults: string,
  io: ExecutionIO,
): Promise<QaStepResult> {
  const qaModel = routeQa(triageResult.complexity);
  const qaAgent = db.select().from(schema.agents).where(eq(schema.agents.role, "qa")).get();

  if (!qaAgent) {
    taskLog(taskId, "V2", `No QA agent found, skipping QA`);
    return { approved: true, rejected: false, costUsd: 0, tokensUsed: 0 };
  }

  taskLog(taskId, "V2", `QA step: model=${qaModel}, complexity=${triageResult.complexity}`);

  io.emit("v2:phase_start", { taskId, phaseIndex: triageResult.phases.length, agents: ["qa"], parallel: false });
  io.emit("agent:status", { agentId: qaAgent.id, status: "running", taskId, progress: 0 });

  const qaSystemPrompt = `${qaAgent.systemPrompt}
${qaAgent.soul ? `\n${qaAgent.soul}` : ""}

## Review Task
- Title: ${task.title}
- Description: ${task.description || "N/A"}
- Priority: ${task.priority}
- Project: ${project.name} (${project.path})

## Dev Results
${devResults.slice(0, 4000)}

## Instructions
Review the work done by the development agents. Check for:
1. Code correctness and completeness
2. Security issues
3. Missing edge cases
4. Whether the task requirements are met

At the END of your review, output one of:
- QA_APPROVED — if the work is acceptable
- QA_REJECTED: <reason> — if changes are needed (specify which agent should fix what)`;

  const allowedTools: string[] = qaAgent.allowedTools ? JSON.parse(qaAgent.allowedTools) : [];
  const SDK_TOOL_NAMES = ["Read", "Glob", "Grep", "Bash", "Write", "Edit"];
  const sdkTools = allowedTools.filter((t) => SDK_TOOL_NAMES.includes(t));

  const options: Options = {
    cwd: project.path,
    tools: sdkTools,
    allowedTools: sdkTools,
    systemPrompt: qaSystemPrompt,
    model: qaModel,
    permissionMode: "acceptEdits",
    maxTurns: 10,
    persistSession: false,
  };

  let resultText = "";
  let costUsd = 0;
  let tokensUsed = 0;

  try {
    for await (const message of query({ prompt: "Review the dev agents' work for this task.", options })) {
      handleMessage(message, qaAgent.id, taskId, project.id, io);

      if (message.type === "result") {
        const result = message as SDKResultMessage;
        costUsd = result.total_cost_usd ?? 0;
        tokensUsed = (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0);
        if (result.subtype === "success" && "result" in result) {
          resultText = result.result;
        }
      }
    }
  } catch (err) {
    taskError(taskId, "V2", `QA execution failed: ${err}`);
    io.emit("agent:status", { agentId: qaAgent.id, status: "idle", taskId });
    clearAgentState(qaAgent.id);
    io.emit("v2:agent_complete", { taskId, agentRole: "qa", success: false, result_summary: "QA execution failed" });
    return { approved: false, rejected: false, costUsd, tokensUsed };
  }

  io.emit("agent:status", { agentId: qaAgent.id, status: "idle", taskId });
  io.emit("v2:phase_complete", {
    taskId,
    phaseIndex: triageResult.phases.length,
    results: [{ agentRole: "qa", success: true }],
  });

  const approved = resultText.includes("QA_APPROVED");
  const rejected = resultText.includes("QA_REJECTED");

  db.insert(schema.taskLogs).values({
    id: nanoid(), taskId, agentId: qaAgent.id, action: "v2_qa",
    detail: `QA ${approved ? "APPROVED" : rejected ? "REJECTED" : "NO VERDICT"} ($${costUsd.toFixed(4)})`,
    createdAt: Date.now(),
  }).run();

  taskLog(taskId, "V2", `QA result: approved=${approved}, rejected=${rejected}`);
  return { approved, rejected, costUsd, tokensUsed };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveAgents(roles: string[]): { id: string; name: string; role: string; model: string; systemPrompt: string; soul: string | null; allowedTools: string | null; permissionMode: string | null; maxThinkingTokens: number | null }[] {
  const result: { id: string; name: string; role: string; model: string; systemPrompt: string; soul: string | null; allowedTools: string | null; permissionMode: string | null; maxThinkingTokens: number | null }[] = [];
  for (const role of roles) {
    const agent = db.select().from(schema.agents).where(eq(schema.agents.role, role)).get();
    if (agent && agent.isActive) {
      result.push(agent);
    } else {
      console.warn(`[V2] Agent not found or inactive: ${role}`);
    }
  }
  return result;
}

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

/** Extract learnings from agent result and save to agentMemories table */
function extractAndSaveMemories(agentId: string, taskId: string, resultText: string): void {
  const match = resultText.match(/MEMORY_START\n([\s\S]*?)MEMORY_END/);
  if (!match) return;

  const lines = match[1].trim().split("\n").filter((l) => l.trim().startsWith("["));
  for (const line of lines) {
    const typeMatch = line.match(/^\[(\w+)\]\s*(.+)/);
    if (!typeMatch) continue;

    const type = typeMatch[1];
    const content = typeMatch[2].trim();
    if (!content || content.length < 10) continue;

    const existing = db.select().from(schema.agentMemories)
      .where(eq(schema.agentMemories.agentId, agentId)).all();
    if (existing.some((m) => m.content === content)) continue;

    db.insert(schema.agentMemories).values({
      id: nanoid(), agentId, taskId, type, content, source: "auto", createdAt: Date.now(),
    }).run();
    taskLog(taskId, "V2", `Saved memory for agent ${agentId}: [${type}] ${content.slice(0, 60)}`);
  }
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
