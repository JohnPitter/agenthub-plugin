import { Router } from "express";
import { db, tasks, taskLogs, projects, integrations } from "../db.js";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import https from "https";

// ─── GitHub API helper (native https, no external deps) ─────

function githubApi(method: string, path: string, token: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = https.request({
      hostname: "api.github.com",
      path,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "agenthub-local/1.0.0",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode ?? 500, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode ?? 500, data: null }); }
      });
    });
    req.on("error", () => resolve({ status: 500, data: null }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 408, data: null }); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Auto-commit + Auto-PR on task done ─────────────────────

async function autoCommitAndPR(taskId: string, io: { emit: (event: string, data: unknown) => void } | null) {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return;

  const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
  if (!project) return;

  const projectPath = project.path;
  const isGitRepo = existsSync(join(projectPath, ".git"));

  if (!isGitRepo) {
    if (io) io.emit("agent:notification", {
      id: `git_skip_${Date.now()}`, projectId: project.id, type: "info",
      title: "Auto-commit ignorado",
      body: `Projeto "${project.name}" não tem repositório git inicializado.`,
      link: null, createdAt: new Date().toISOString(),
    });
    return;
  }

  // Check if there are changes to commit
  let hasChanges = false;
  try {
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: projectPath, timeout: 5000 }).toString().trim();
    hasChanges = status.length > 0;
  } catch { return; }

  if (!hasChanges) return;

  // Auto-commit
  const commitMsg = `feat: ${task.title}\n\nTask: ${task.id}\nAgent: ${task.assignedAgentId ?? "unassigned"}`;
  try {
    execFileSync("git", ["add", "-A"], { cwd: projectPath, timeout: 5000 });
    execFileSync("git", ["commit", "-m", commitMsg], { cwd: projectPath, timeout: 10000 });

    db.insert(taskLogs).values({
      id: nanoid(), taskId: task.id, agentId: task.assignedAgentId,
      action: "git_commit", detail: `Auto-commit: ${task.title}`, createdAt: Date.now(),
    }).run();

    if (io) io.emit("task:git_commit", { taskId: task.id, projectId: project.id, message: commitMsg });
  } catch {
    if (io) io.emit("agent:notification", {
      id: `git_err_${Date.now()}`, projectId: project.id, type: "agent_error",
      title: "Auto-commit falhou",
      body: `Não foi possível fazer commit no projeto "${project.name}".`,
      link: null, createdAt: new Date().toISOString(),
    });
    return;
  }

  // Check if remote exists
  let remoteUrl = "";
  try {
    remoteUrl = execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: projectPath, timeout: 5000 }).toString().trim();
  } catch { /* no remote */ }

  if (!remoteUrl) {
    if (io) io.emit("agent:notification", {
      id: `pr_skip_${Date.now()}`, projectId: project.id, type: "info",
      title: "PR ignorado — sem remote",
      body: `Commit feito localmente. Configure um remote git para PRs automáticos.`,
      link: null, createdAt: new Date().toISOString(),
    });
    return;
  }

  // Extract owner/repo from remote URL
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) return;
  const [, owner, repo] = match;

  // Get GitHub token from integrations config
  const ghIntegration = db.select().from(integrations)
    .where(eq(integrations.type, "github")).get();

  const ghToken = ghIntegration?.config ? JSON.parse(ghIntegration.config).token : null;

  if (!ghToken) {
    if (io) io.emit("agent:notification", {
      id: `pr_notoken_${Date.now()}`, projectId: project.id, type: "agent_error",
      title: "PR ignorado — GitHub não configurado",
      body: "Configure o token do GitHub em Configurações > Integrações para PRs automáticos.",
      link: null, createdAt: new Date().toISOString(),
    });
    return;
  }

  // Push branch
  let currentBranch = "main";
  try {
    currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectPath, timeout: 5000 }).toString().trim();
    execFileSync("git", ["push", "-u", "origin", currentBranch], { cwd: projectPath, timeout: 60000 });
  } catch {
    if (io) io.emit("agent:notification", {
      id: `push_err_${Date.now()}`, projectId: project.id, type: "agent_error",
      title: "Push falhou", body: "Não foi possível enviar as alterações para o remote.",
      link: null, createdAt: new Date().toISOString(),
    });
    return;
  }

  // Get default branch
  let defaultBranch = "main";
  try {
    const { data } = await githubApi("GET", `/repos/${owner}/${repo}`, ghToken);
    if (data && typeof data === "object" && "default_branch" in data) {
      defaultBranch = (data as { default_branch: string }).default_branch;
    }
  } catch { /* use main */ }

  // Don't create PR if pushing to default branch
  if (currentBranch === defaultBranch) {
    if (io) io.emit("agent:notification", {
      id: `pr_default_${Date.now()}`, projectId: project.id, type: "info",
      title: "Commit enviado",
      body: `Push feito diretamente na branch ${defaultBranch}. PR não necessário.`,
      link: null, createdAt: new Date().toISOString(),
    });
    return;
  }

  // Create PR
  const prResult = await githubApi("POST", `/repos/${owner}/${repo}/pulls`, ghToken, {
    title: task.title,
    body: `## Task\n- **ID:** ${task.id}\n- **Prioridade:** ${task.priority}\n- **Agente:** ${task.assignedAgentId ?? "N/A"}\n\n## Resultado\n${task.result ?? "_Sem descrição._"}`,
    head: currentBranch,
    base: defaultBranch,
  });

  if (prResult.status === 201) {
    const prData = prResult.data as { html_url: string; number: number };
    db.insert(taskLogs).values({
      id: nanoid(), taskId: task.id, agentId: task.assignedAgentId,
      action: "pr_created", detail: `PR #${prData.number}: ${prData.html_url}`, createdAt: Date.now(),
    }).run();

    if (io) io.emit("task:pr_created", {
      taskId: task.id, projectId: project.id, prUrl: prData.html_url, prNumber: prData.number,
    });
  } else {
    if (io) io.emit("agent:notification", {
      id: `pr_err_${Date.now()}`, projectId: project.id, type: "agent_error",
      title: "PR falhou",
      body: `Não foi possível criar o PR. Status: ${prResult.status}`,
      link: null, createdAt: new Date().toISOString(),
    });
  }
}

const router: ReturnType<typeof Router> = Router();

// Valid status transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  created: ["pending", "assigned", "cancelled"],
  pending: ["assigned", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["review", "failed", "cancelled"],
  review: ["done", "assigned", "failed"],
  failed: ["pending", "assigned"],
  done: [],
  cancelled: ["pending"],
};

// GET / — list tasks with optional filters
router.get("/", (req, res) => {
  const { projectId, status } = req.query;

  let query = db.select().from(tasks);

  const conditions = [];
  if (projectId && typeof projectId === "string") {
    conditions.push(eq(tasks.projectId, projectId));
  }
  if (status && typeof status === "string") {
    conditions.push(eq(tasks.status, status));
  }

  if (conditions.length === 1) {
    query = query.where(conditions[0]) as typeof query;
  } else if (conditions.length > 1) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const rows = query.orderBy(desc(tasks.createdAt)).all();
  res.json({ tasks: rows });
});

// POST / — create task
router.post("/", (req, res) => {
  const { projectId, title, description, priority, category, assignedAgentId } = req.body;

  if (!projectId || !title) {
    res.status(400).json({ error: "projectId and title are required" });
    return;
  }

  const now = Date.now();
  const task = {
    id: nanoid(),
    projectId,
    assignedAgentId: assignedAgentId ?? null,
    title,
    description: description ?? null,
    status: "created",
    priority: priority ?? "medium",
    category: category ?? "feature",
    branch: null,
    result: null,
    costUsd: "0",
    tokensUsed: 0,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };

  db.insert(tasks).values(task).run();

  // Log creation
  db.insert(taskLogs).values({
    id: nanoid(),
    taskId: task.id,
    agentId: null,
    action: "created",
    detail: `Task created: ${title}`,
    createdAt: now,
  }).run();

  res.status(201).json({ task });
});

// GET /:id — get single task
router.get("/:id", (req, res) => {
  const task = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
  if (!task) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  res.json({ task });
});

// PATCH /:id — update task
router.patch("/:id", (req, res) => {
  const task = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
  if (!task) {
    res.status(404).json({ error: "task not found" });
    return;
  }

  const { status, title, description, priority, category, assignedAgentId, branch, result, costUsd, tokensUsed } = req.body;
  const now = Date.now();

  // Validate status transition only if status is actually changing
  if (status && status !== task.status) {
    const allowed = VALID_TRANSITIONS[task.status];
    if (!allowed || !allowed.includes(status)) {
      res.status(400).json({
        error: `Invalid transition from '${task.status}' to '${status}'`,
        allowed: allowed ?? [],
      });
      return;
    }
  }
  // Skip status update if same as current (no-op)
  if (status === task.status) {
    delete req.body.status;
  }

  const updates: Record<string, unknown> = { updatedAt: now };

  if (status !== undefined) updates.status = status;
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (priority !== undefined) updates.priority = priority;
  if (category !== undefined) updates.category = category;
  if (assignedAgentId !== undefined) updates.assignedAgentId = assignedAgentId;
  if (branch !== undefined) updates.branch = branch;
  if (result !== undefined) updates.result = result;
  if (costUsd !== undefined) updates.costUsd = costUsd;
  if (tokensUsed !== undefined) updates.tokensUsed = tokensUsed;

  if (status === "done") {
    updates.completedAt = now;
  }

  db.update(tasks).set(updates).where(eq(tasks.id, req.params.id)).run();

  // Log status change
  if (status && status !== task.status) {
    db.insert(taskLogs).values({
      id: nanoid(),
      taskId: task.id,
      agentId: assignedAgentId ?? task.assignedAgentId ?? null,
      action: "status_change",
      detail: `${task.status} → ${status}`,
      createdAt: now,
    }).run();
  }

  const updated = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();

  // Auto-commit + PR when task reaches done (async, non-blocking, after response)
  if (status === "done" && status !== task.status) {
    const taskIdForGit = req.params.id;
    const io = req.app.get("io") ?? null;
    res.json({ task: updated });
    autoCommitAndPR(taskIdForGit, io).catch(() => {});
    return;
  }

  res.json({ task: updated });
});

// DELETE /:id — delete task
router.delete("/:id", (req, res) => {
  const task = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
  if (!task) {
    res.status(404).json({ error: "task not found" });
    return;
  }

  // Delete associated logs first
  db.delete(taskLogs).where(eq(taskLogs.taskId, req.params.id)).run();
  db.delete(tasks).where(eq(tasks.id, req.params.id)).run();
  res.json({ success: true });
});

// GET /:id/logs — get task logs
router.get("/:id/logs", (req, res) => {
  const task = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
  if (!task) {
    res.status(404).json({ error: "task not found" });
    return;
  }

  const logs = db.select().from(taskLogs)
    .where(eq(taskLogs.taskId, req.params.id))
    .orderBy(desc(taskLogs.createdAt))
    .all();

  res.json({ logs });
});

export default router;
