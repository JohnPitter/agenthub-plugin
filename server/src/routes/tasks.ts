import { Router } from "express";
import { db, tasks, taskLogs, projects, integrations } from "../db.js";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { execFileSync } from "child_process";
import { existsSync, readFileSync as fsReadFileSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
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

// ─── Cleanup task workspace (tmp folder + git branch + GitHub PR) ─────

async function cleanupTaskWorkspace(
  task: { id: string; projectId: string; branch: string | null },
  reason: "done" | "cancelled",
) {
  const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
  if (!project) return;

  const projectPath = project.path;

  // 1. Delete tmp folder (non-git projects)
  const tmpDir = join(homedir(), "Projects", ".agenthub-tasks", task.id);
  if (existsSync(tmpDir)) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  // 2. Handle git branch based on reason
  if (task.branch && existsSync(join(projectPath, ".git"))) {
    if (reason === "cancelled") {
      // Cancelled → delete branch immediately (work is discarded)
      try { execFileSync("git", ["branch", "-D", task.branch], { cwd: projectPath, timeout: 5000, stdio: "pipe" }); } catch { /* ignore */ }
      try { execFileSync("git", ["push", "origin", "--delete", task.branch], { cwd: projectPath, timeout: 30000, stdio: "pipe" }); } catch { /* ignore */ }
    }
    // done → keep branch alive until PR is merged (GitHub needs it for the diff)
    // Branch cleanup happens via GitHub's auto-delete after merge setting
  }

  // 3. Close GitHub PR if cancelled
  if (reason === "cancelled" && task.branch) {
    const ghIntegration = db.select().from(integrations).where(eq(integrations.type, "github")).get();
    const ghToken = ghIntegration?.config ? JSON.parse(ghIntegration.config).token : null;
    if (!ghToken) return;

    // Get remote URL to extract owner/repo
    let remoteUrl = "";
    try {
      remoteUrl = execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: projectPath, timeout: 5000, encoding: "utf-8" }).trim();
    } catch { return; }

    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (!match) return;
    const [, owner, repo] = match;

    // Find open PR for this branch
    const prSearch = await githubApi("GET", `/repos/${owner}/${repo}/pulls?head=${owner}:${task.branch}&state=open`, ghToken);
    if (prSearch.status === 200 && Array.isArray(prSearch.data) && prSearch.data.length > 0) {
      const prNumber = (prSearch.data[0] as { number: number }).number;
      // Close the PR
      await githubApi("PATCH", `/repos/${owner}/${repo}/pulls/${prNumber}`, ghToken, { state: "closed" });
    }
  }
}

const router: ReturnType<typeof Router> = Router();

// Valid status transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  created: ["pending", "assigned", "cancelled"],
  pending: ["assigned", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["review", "failed", "cancelled"],
  review: ["done", "assigned", "failed", "cancelled"],
  failed: ["pending", "assigned", "cancelled"],
  done: [],
  cancelled: ["pending", "assigned"],
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

  // Emit socket events for real-time updates on any status change
  if (status && status !== task.status) {
    const io = req.app.get("io");
    if (io) {
      const agentForActivity = assignedAgentId ?? task.assignedAgentId ?? "";
      io.emit("task:status", { taskId: req.params.id, status, agentId: agentForActivity });
      io.emit("task:updated", { task: updated });
      io.emit("board:activity", {
        agentId: agentForActivity,
        action: `task:${status}`,
        detail: `${task.title}: ${task.status} → ${status}`,
      });
    }
  }

  // Auto-execute when task moves to assigned (skip in test/CI environments)
  if (status === "assigned" && status !== task.status && !process.env.DISABLE_AUTO_EXECUTE) {
    const taskIdForExec = req.params.id;
    const ioExec = req.app.get("io") ?? null;
    res.json({ task: updated });

    // Check execution mode: v1 (workflow) or v2 (agent teams)
    const modeRow = db.select().from(integrations)
      .where(eq(integrations.type, "execution_mode")).get();
    const isV2 = modeRow?.config === "v2";

    if (isV2) {
      import("../lib/task-executor-v2.js").then(({ executeTaskV2 }) => {
        executeTaskV2(taskIdForExec, ioExec).catch((err: Error) => {
          console.error(`[TaskExecutorV2] Auto-execute failed: ${err.message}`);
        });
      }).catch(() => {});
    } else {
      import("../lib/task-executor.js").then(({ executeTask }) => {
        executeTask(taskIdForExec, ioExec).catch((err: Error) => {
          console.error(`[TaskExecutor] Auto-execute failed: ${err.message}`);
        });
      }).catch(() => {});
    }
    return;
  }

  // Auto-commit + PR when task reaches done (async, non-blocking, after response)
  if (status === "done" && status !== task.status) {
    const taskIdForGit = req.params.id;
    const ioGit = req.app.get("io") ?? null;
    res.json({ task: updated });
    autoCommitAndPR(taskIdForGit, ioGit).then(() => {
      cleanupTaskWorkspace(task, "done");
    }).catch(() => {});
    return;
  }

  // Cleanup when task is cancelled
  if (status === "cancelled" && status !== task.status) {
    res.json({ task: updated });
    cleanupTaskWorkspace(task, "cancelled").catch(() => {});
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

// ─── Language map for syntax highlighting ────────────────
const LANG_MAP: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  py: "python", rs: "rust", go: "go", java: "java", rb: "ruby",
  css: "css", html: "html", json: "json", md: "markdown", yml: "yaml", yaml: "yaml",
  sh: "bash", sql: "sql", xml: "xml", toml: "toml", env: "bash",
};

/** Normalize path to forward slashes (git on Windows needs this) */
function toGitPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

/** Detect language from file extension */
function detectLang(filePath: string): string {
  const ext = filePath.split(".").pop() || "";
  return LANG_MAP[ext] || ext;
}

/** Check if a commit is the initial (root) commit (has no parent) */
function isRootCommit(hash: string, cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", `${hash}^`], { cwd, timeout: 3000, encoding: "utf-8", stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
}

// GET /:id/changes — get git changes for task
router.get("/:id/changes", (req, res) => {
  const task = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
  if (!task) return res.status(404).json({ error: "task not found" });

  const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();
  if (!project) return res.json({ commits: [] });

  const projectPath = project.path;
  if (!existsSync(join(projectPath, ".git"))) return res.json({ commits: [] });

  try {
    // Get recent commits (last 10)
    const logOutput = execFileSync("git", [
      "log", "--format=%H%n%h%n%s%n%an%n%aI", "-10"
    ], { cwd: projectPath, timeout: 5000, encoding: "utf-8" });

    const lines = logOutput.trim().split("\n");
    const commits: { hash: string; shortHash: string; message: string; author: string; date: string; files: { path: string; original: string; modified: string; language: string }[] }[] = [];

    for (let i = 0; i < lines.length; i += 5) {
      if (!lines[i]) continue;
      const hash = lines[i];
      const shortHash = lines[i + 1];
      const message = lines[i + 2];
      const author = lines[i + 3];
      const date = lines[i + 4];

      // Get changed files for this commit (--root handles initial commits with no parent)
      let changedFiles: string[] = [];
      try {
        const diffOutput = execFileSync("git", [
          "diff-tree", "--no-commit-id", "--root", "-r", "--name-only", hash
        ], { cwd: projectPath, timeout: 5000, encoding: "utf-8" });
        changedFiles = diffOutput.trim().split("\n").filter(Boolean).map(toGitPath);
      } catch { /* ignore */ }

      // Check once whether this is the root commit (no parent)
      const rootCommit = isRootCommit(hash, projectPath);

      const files = changedFiles.slice(0, 20).map(filePath => {
        let original = "";
        let modified = "";
        const gitPath = toGitPath(filePath);

        // For root commits there is no parent, so original stays empty
        if (!rootCommit) {
          try {
            original = execFileSync("git", ["show", `${hash}^:${gitPath}`], { cwd: projectPath, timeout: 3000, encoding: "utf-8" });
          } catch { original = ""; }
        }

        try {
          modified = execFileSync("git", ["show", `${hash}:${gitPath}`], { cwd: projectPath, timeout: 3000, encoding: "utf-8" });
        } catch { modified = ""; }

        return { path: gitPath, original, modified, language: detectLang(gitPath) };
      });

      commits.push({ hash, shortHash, message, author, date, files });
    }

    // Also add uncommitted changes if any
    try {
      // Use git diff for tracked changes + git ls-files for untracked
      // This avoids -uall which lists thousands of node_modules files
      const trackedOutput = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: projectPath, timeout: 5000, encoding: "utf-8" });
      const untrackedOutput = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: projectPath, timeout: 5000, encoding: "utf-8" });
      const allChangedPaths = [
        ...trackedOutput.trim().split("\n").filter(Boolean),
        ...untrackedOutput.trim().split("\n").filter(Boolean),
      ].filter(p => !p.startsWith("node_modules/") && !p.startsWith(".git/"));

      const uncommittedFiles = allChangedPaths.map(fp => {
        // Remove surrounding quotes (git quotes paths with special chars/spaces)
        let filePath = fp;
        if (filePath.startsWith('"') && filePath.endsWith('"')) {
          filePath = filePath.slice(1, -1).replace(/\\"/g, '"');
        }
        return toGitPath(filePath);
      });

      if (uncommittedFiles.length > 0) {
        const files = uncommittedFiles.slice(0, 20).map(filePath => {
          let original = "";
          let modified = "";
          const gitPath = toGitPath(filePath);

          try {
            original = execFileSync("git", ["show", `HEAD:${gitPath}`], { cwd: projectPath, timeout: 3000, encoding: "utf-8" });
          } catch { /* new file */ }

          try {
            const fullPath = join(projectPath, filePath);
            if (existsSync(fullPath)) {
              modified = fsReadFileSync(fullPath, "utf-8");
            }
          } catch { /* deleted file */ }

          return { path: gitPath, original, modified, language: detectLang(gitPath) };
        });

        commits.unshift({ hash: "uncommitted", shortHash: "uncommitted", message: "Uncommitted changes", author: "", date: new Date().toISOString(), files });
      }
    } catch { /* no uncommitted changes */ }

    res.json({ commits });
  } catch {
    res.json({ commits: [] });
  }
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

// POST /:id/review-chat — chat with Tech Lead about a task in review
router.post("/:id/review-chat", async (req, res) => {
  const task = db.select().from(tasks).where(eq(tasks.id, req.params.id)).get();
  if (!task) return res.status(404).json({ error: "task not found" });

  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: "message required" });

  // Find Tech Lead agent
  const { agents } = await import("../db.js");
  const techLead = db.select().from(agents).where(eq(agents.role, "tech_lead")).get();
  if (!techLead) return res.json({ reply: "Tech Lead não encontrado." });

  // Get project context
  const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get();

  // Build context with task info
  const systemPrompt = `${techLead.systemPrompt}

## Review Context
You are reviewing a completed task. Respond concisely.

Task: ${task.title}
Description: ${task.description || "N/A"}
Status: ${task.status}
Result: ${task.result?.slice(0, 500) || "N/A"}
Project: ${project?.name ?? "Unknown"}

The user is asking about this task's review. Help them decide whether to approve or reject.`;

  // Get previous messages for this task
  const { messages } = await import("../db.js");
  const prevMessages = db.select().from(messages)
    .where(eq(messages.taskId, req.params.id))
    .all()
    .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

  // Add current message
  const allMessages = [...prevMessages, { role: "user" as const, content: message.trim() }];

  // Call Claude via Anthropic SDK
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const { readFileSync: rfs } = await import("fs");
    const { join: pathJoin } = await import("path");
    const { homedir: hd } = await import("os");

    const credPath = pathJoin(hd(), ".claude", ".credentials.json");
    const token = JSON.parse(rfs(credPath, "utf-8"))?.claudeAiOauth?.accessToken;
    if (!token) return res.json({ reply: "Token Claude não encontrado. Execute /login." });

    const client = new Anthropic({
      apiKey: token,
      defaultHeaders: { "Authorization": `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
    });

    const response = await client.messages.create({
      model: techLead.model,
      max_tokens: 512,
      system: systemPrompt,
      messages: allMessages,
    });

    const reply = response.content.filter(b => b.type === "text").map(b => b.type === "text" ? b.text : "").join("");

    // Save both messages to DB
    const { nanoid: nid } = await import("nanoid");
    const now = Date.now();
    db.insert(messages).values({ id: nid(), projectId: task.projectId, taskId: task.id, agentId: null, role: "user", content: message.trim(), createdAt: now }).run();
    db.insert(messages).values({ id: nid(), projectId: task.projectId, taskId: task.id, agentId: techLead.id, role: "assistant", content: reply, createdAt: now + 1 }).run();

    res.json({ reply });
  } catch (err) {
    res.json({ reply: "Erro ao comunicar com o Tech Lead. Tente novamente." });
  }
});

export default router;
