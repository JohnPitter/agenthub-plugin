import {
  scanWorkspace
} from "./chunk-EU6O5ZWX.js";
import {
  DATA_DIR,
  agents,
  db,
  integrations,
  projects,
  schema,
  taskLogs,
  tasks
} from "./chunk-5B52KKSZ.js";

// src/index.ts
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import { join as join5, dirname } from "path";
import { fileURLToPath } from "url";
import open from "open";
import { writeFileSync as writeFileSync2, readFileSync as readFileSync4, existsSync as existsSync6, mkdirSync as mkdirSync2, rmSync as rmSync2 } from "fs";
import { execFileSync as execFileSync3 } from "child_process";
import https3 from "https";
import { homedir as homedir3 } from "os";
import { nanoid as nanoid7 } from "nanoid";

// src/routes/projects.ts
import { Router } from "express";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { rmSync, existsSync } from "fs";
var router = Router();
router.get("/", (_req, res) => {
  const rows = db.select().from(projects).all();
  res.json({ projects: rows });
});
router.post("/", (req, res) => {
  const { name, path, stack, description, githubUrl } = req.body;
  if (!name || !path) {
    res.status(400).json({ error: "name and path are required" });
    return;
  }
  const existing = db.select().from(projects).where(eq(projects.path, path)).get();
  if (existing) {
    res.status(409).json({ error: "project with this path already exists", project: existing });
    return;
  }
  const now = Date.now();
  const project = {
    id: nanoid(),
    name,
    path,
    stack: Array.isArray(stack) ? JSON.stringify(stack) : stack ?? null,
    description: description ?? null,
    githubUrl: githubUrl ?? null,
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  db.insert(projects).values(project).run();
  res.status(201).json({ project });
});
router.post("/scan", (req, res) => {
  const { directory } = req.body;
  if (!directory || typeof directory !== "string") {
    res.status(400).json({ error: "directory path is required" });
    return;
  }
  const found = scanWorkspace(directory);
  res.json(found);
});
router.post("/import", (req, res) => {
  const { owner, repo, cloneUrl, htmlUrl, description } = req.body;
  const localPath = cloneUrl || htmlUrl;
  const name = repo || (localPath ? localPath.split("/").pop() : "unknown");
  if (!localPath) {
    res.status(400).json({ error: "cloneUrl or htmlUrl is required" });
    return;
  }
  const existing = db.select().from(projects).where(eq(projects.path, localPath)).get();
  if (existing) {
    res.status(409).json({ error: "errorDuplicate", project: existing });
    return;
  }
  let stack = [];
  try {
    const found = scanWorkspace(localPath + "/..");
    const match = found.find((p) => p.path === localPath || p.name === name);
    if (match) stack = match.stack;
  } catch {
  }
  const now = Date.now();
  const project = {
    id: nanoid(),
    name,
    path: localPath,
    stack: JSON.stringify(stack),
    description: description ?? null,
    githubUrl: null,
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  db.insert(projects).values(project).run();
  res.status(201).json({ project });
});
router.get("/:id", (req, res) => {
  const project = db.select().from(projects).where(eq(projects.id, req.params.id)).get();
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  res.json({ project });
});
router.delete("/:id", (req, res) => {
  const project = db.select().from(projects).where(eq(projects.id, req.params.id)).get();
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  if (project.path && existsSync(project.path)) {
    try {
      rmSync(project.path, { recursive: true, force: true });
    } catch {
    }
  }
  db.delete(projects).where(eq(projects.id, req.params.id)).run();
  res.json({ success: true });
});
var projects_default = router;

// src/routes/tasks.ts
import { Router as Router2 } from "express";
import { eq as eq2, and, desc } from "drizzle-orm";
import { nanoid as nanoid2 } from "nanoid";
import { execFileSync } from "child_process";
import { existsSync as existsSync2, readFileSync as fsReadFileSync } from "fs";
import { join } from "path";
import https from "https";
function githubApi(method, path, token, body) {
  return new Promise((resolve2) => {
    const payload = body ? JSON.stringify(body) : void 0;
    const req = https.request({
      hostname: "api.github.com",
      path,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "agenthub-local/1.0.0",
        "X-GitHub-Api-Version": "2022-11-28",
        ...payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}
      }
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve2({ status: res.statusCode ?? 500, data: JSON.parse(data) });
        } catch {
          resolve2({ status: res.statusCode ?? 500, data: null });
        }
      });
    });
    req.on("error", () => resolve2({ status: 500, data: null }));
    req.setTimeout(15e3, () => {
      req.destroy();
      resolve2({ status: 408, data: null });
    });
    if (payload) req.write(payload);
    req.end();
  });
}
async function autoCommitAndPR(taskId, io2) {
  const task = db.select().from(tasks).where(eq2(tasks.id, taskId)).get();
  if (!task) return;
  const project = db.select().from(projects).where(eq2(projects.id, task.projectId)).get();
  if (!project) return;
  const projectPath = project.path;
  const isGitRepo = existsSync2(join(projectPath, ".git"));
  if (!isGitRepo) {
    if (io2) io2.emit("agent:notification", {
      id: `git_skip_${Date.now()}`,
      projectId: project.id,
      type: "info",
      title: "Auto-commit ignorado",
      body: `Projeto "${project.name}" n\xE3o tem reposit\xF3rio git inicializado.`,
      link: null,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return;
  }
  let hasChanges = false;
  try {
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: projectPath, timeout: 5e3 }).toString().trim();
    hasChanges = status.length > 0;
  } catch {
    return;
  }
  if (!hasChanges) return;
  const commitMsg = `feat: ${task.title}

Task: ${task.id}
Agent: ${task.assignedAgentId ?? "unassigned"}`;
  try {
    execFileSync("git", ["add", "-A"], { cwd: projectPath, timeout: 5e3 });
    execFileSync("git", ["commit", "-m", commitMsg], { cwd: projectPath, timeout: 1e4 });
    db.insert(taskLogs).values({
      id: nanoid2(),
      taskId: task.id,
      agentId: task.assignedAgentId,
      action: "git_commit",
      detail: `Auto-commit: ${task.title}`,
      createdAt: Date.now()
    }).run();
    if (io2) io2.emit("task:git_commit", { taskId: task.id, projectId: project.id, message: commitMsg });
  } catch {
    if (io2) io2.emit("agent:notification", {
      id: `git_err_${Date.now()}`,
      projectId: project.id,
      type: "agent_error",
      title: "Auto-commit falhou",
      body: `N\xE3o foi poss\xEDvel fazer commit no projeto "${project.name}".`,
      link: null,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return;
  }
  let remoteUrl = "";
  try {
    remoteUrl = execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: projectPath, timeout: 5e3 }).toString().trim();
  } catch {
  }
  if (!remoteUrl) {
    if (io2) io2.emit("agent:notification", {
      id: `pr_skip_${Date.now()}`,
      projectId: project.id,
      type: "info",
      title: "PR ignorado \u2014 sem remote",
      body: `Commit feito localmente. Configure um remote git para PRs autom\xE1ticos.`,
      link: null,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return;
  }
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) return;
  const [, owner, repo] = match;
  const ghIntegration = db.select().from(integrations).where(eq2(integrations.type, "github")).get();
  const ghToken = ghIntegration?.config ? JSON.parse(ghIntegration.config).token : null;
  if (!ghToken) {
    if (io2) io2.emit("agent:notification", {
      id: `pr_notoken_${Date.now()}`,
      projectId: project.id,
      type: "agent_error",
      title: "PR ignorado \u2014 GitHub n\xE3o configurado",
      body: "Configure o token do GitHub em Configura\xE7\xF5es > Integra\xE7\xF5es para PRs autom\xE1ticos.",
      link: null,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return;
  }
  let currentBranch = "main";
  try {
    currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectPath, timeout: 5e3 }).toString().trim();
    execFileSync("git", ["push", "-u", "origin", currentBranch], { cwd: projectPath, timeout: 6e4 });
  } catch {
    if (io2) io2.emit("agent:notification", {
      id: `push_err_${Date.now()}`,
      projectId: project.id,
      type: "agent_error",
      title: "Push falhou",
      body: "N\xE3o foi poss\xEDvel enviar as altera\xE7\xF5es para o remote.",
      link: null,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return;
  }
  let defaultBranch = "main";
  try {
    const { data } = await githubApi("GET", `/repos/${owner}/${repo}`, ghToken);
    if (data && typeof data === "object" && "default_branch" in data) {
      defaultBranch = data.default_branch;
    }
  } catch {
  }
  if (currentBranch === defaultBranch) {
    if (io2) io2.emit("agent:notification", {
      id: `pr_default_${Date.now()}`,
      projectId: project.id,
      type: "info",
      title: "Commit enviado",
      body: `Push feito diretamente na branch ${defaultBranch}. PR n\xE3o necess\xE1rio.`,
      link: null,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return;
  }
  const prResult = await githubApi("POST", `/repos/${owner}/${repo}/pulls`, ghToken, {
    title: task.title,
    body: `## Task
- **ID:** ${task.id}
- **Prioridade:** ${task.priority}
- **Agente:** ${task.assignedAgentId ?? "N/A"}

## Resultado
${task.result ?? "_Sem descri\xE7\xE3o._"}`,
    head: currentBranch,
    base: defaultBranch
  });
  if (prResult.status === 201) {
    const prData = prResult.data;
    db.insert(taskLogs).values({
      id: nanoid2(),
      taskId: task.id,
      agentId: task.assignedAgentId,
      action: "pr_created",
      detail: `PR #${prData.number}: ${prData.html_url}`,
      createdAt: Date.now()
    }).run();
    if (io2) io2.emit("task:pr_created", {
      taskId: task.id,
      projectId: project.id,
      prUrl: prData.html_url,
      prNumber: prData.number
    });
  } else {
    if (io2) io2.emit("agent:notification", {
      id: `pr_err_${Date.now()}`,
      projectId: project.id,
      type: "agent_error",
      title: "PR falhou",
      body: `N\xE3o foi poss\xEDvel criar o PR. Status: ${prResult.status}`,
      link: null,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
}
var router2 = Router2();
var VALID_TRANSITIONS = {
  created: ["pending", "assigned", "cancelled"],
  pending: ["assigned", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["review", "failed", "cancelled"],
  review: ["done", "assigned", "failed"],
  failed: ["pending", "assigned"],
  done: [],
  cancelled: ["pending"]
};
router2.get("/", (req, res) => {
  const { projectId, status } = req.query;
  let query = db.select().from(tasks);
  const conditions = [];
  if (projectId && typeof projectId === "string") {
    conditions.push(eq2(tasks.projectId, projectId));
  }
  if (status && typeof status === "string") {
    conditions.push(eq2(tasks.status, status));
  }
  if (conditions.length === 1) {
    query = query.where(conditions[0]);
  } else if (conditions.length > 1) {
    query = query.where(and(...conditions));
  }
  const rows = query.orderBy(desc(tasks.createdAt)).all();
  res.json({ tasks: rows });
});
router2.post("/", (req, res) => {
  const { projectId, title, description, priority, category, assignedAgentId } = req.body;
  if (!projectId || !title) {
    res.status(400).json({ error: "projectId and title are required" });
    return;
  }
  const now = Date.now();
  const task = {
    id: nanoid2(),
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
    completedAt: null
  };
  db.insert(tasks).values(task).run();
  db.insert(taskLogs).values({
    id: nanoid2(),
    taskId: task.id,
    agentId: null,
    action: "created",
    detail: `Task created: ${title}`,
    createdAt: now
  }).run();
  res.status(201).json({ task });
});
router2.get("/:id", (req, res) => {
  const task = db.select().from(tasks).where(eq2(tasks.id, req.params.id)).get();
  if (!task) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  res.json({ task });
});
router2.patch("/:id", (req, res) => {
  const task = db.select().from(tasks).where(eq2(tasks.id, req.params.id)).get();
  if (!task) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  const { status, title, description, priority, category, assignedAgentId, branch, result, costUsd, tokensUsed } = req.body;
  const now = Date.now();
  if (status && status !== task.status) {
    const allowed = VALID_TRANSITIONS[task.status];
    if (!allowed || !allowed.includes(status)) {
      res.status(400).json({
        error: `Invalid transition from '${task.status}' to '${status}'`,
        allowed: allowed ?? []
      });
      return;
    }
  }
  if (status === task.status) {
    delete req.body.status;
  }
  const updates = { updatedAt: now };
  if (status !== void 0) updates.status = status;
  if (title !== void 0) updates.title = title;
  if (description !== void 0) updates.description = description;
  if (priority !== void 0) updates.priority = priority;
  if (category !== void 0) updates.category = category;
  if (assignedAgentId !== void 0) updates.assignedAgentId = assignedAgentId;
  if (branch !== void 0) updates.branch = branch;
  if (result !== void 0) updates.result = result;
  if (costUsd !== void 0) updates.costUsd = costUsd;
  if (tokensUsed !== void 0) updates.tokensUsed = tokensUsed;
  if (status === "done") {
    updates.completedAt = now;
  }
  db.update(tasks).set(updates).where(eq2(tasks.id, req.params.id)).run();
  if (status && status !== task.status) {
    db.insert(taskLogs).values({
      id: nanoid2(),
      taskId: task.id,
      agentId: assignedAgentId ?? task.assignedAgentId ?? null,
      action: "status_change",
      detail: `${task.status} \u2192 ${status}`,
      createdAt: now
    }).run();
  }
  const updated = db.select().from(tasks).where(eq2(tasks.id, req.params.id)).get();
  if (status && status !== task.status) {
    const io2 = req.app.get("io");
    if (io2) {
      const agentForActivity = assignedAgentId ?? task.assignedAgentId ?? "";
      io2.emit("task:status", { taskId: req.params.id, status, agentId: agentForActivity });
      io2.emit("task:updated", { task: updated });
      io2.emit("board:activity", {
        agentId: agentForActivity,
        action: `task:${status}`,
        detail: `${task.title}: ${task.status} \u2192 ${status}`
      });
    }
  }
  if (status === "assigned" && status !== task.status && !process.env.DISABLE_AUTO_EXECUTE) {
    const taskIdForExec = req.params.id;
    const ioExec = req.app.get("io") ?? null;
    res.json({ task: updated });
    import("./task-executor-KODM5MPB.js").then(({ executeTask }) => {
      executeTask(taskIdForExec, ioExec).catch((err) => {
        console.error(`[TaskExecutor] Auto-execute failed: ${err.message}`);
      });
    }).catch(() => {
    });
    return;
  }
  if (status === "done" && status !== task.status) {
    const taskIdForGit = req.params.id;
    const ioGit = req.app.get("io") ?? null;
    res.json({ task: updated });
    autoCommitAndPR(taskIdForGit, ioGit).catch(() => {
    });
    return;
  }
  res.json({ task: updated });
});
router2.delete("/:id", (req, res) => {
  const task = db.select().from(tasks).where(eq2(tasks.id, req.params.id)).get();
  if (!task) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  db.delete(taskLogs).where(eq2(taskLogs.taskId, req.params.id)).run();
  db.delete(tasks).where(eq2(tasks.id, req.params.id)).run();
  res.json({ success: true });
});
var LANG_MAP = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  rb: "ruby",
  css: "css",
  html: "html",
  json: "json",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  sql: "sql",
  xml: "xml",
  toml: "toml",
  env: "bash"
};
function toGitPath(filePath) {
  return filePath.replace(/\\/g, "/");
}
function detectLang(filePath) {
  const ext = filePath.split(".").pop() || "";
  return LANG_MAP[ext] || ext;
}
function isRootCommit(hash, cwd) {
  try {
    execFileSync("git", ["rev-parse", "--verify", `${hash}^`], { cwd, timeout: 3e3, encoding: "utf-8", stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
}
router2.get("/:id/changes", (req, res) => {
  const task = db.select().from(tasks).where(eq2(tasks.id, req.params.id)).get();
  if (!task) return res.status(404).json({ error: "task not found" });
  const project = db.select().from(projects).where(eq2(projects.id, task.projectId)).get();
  if (!project) return res.json({ commits: [] });
  const projectPath = project.path;
  if (!existsSync2(join(projectPath, ".git"))) return res.json({ commits: [] });
  try {
    const logOutput = execFileSync("git", [
      "log",
      "--format=%H%n%h%n%s%n%an%n%aI",
      "-10"
    ], { cwd: projectPath, timeout: 5e3, encoding: "utf-8" });
    const lines = logOutput.trim().split("\n");
    const commits = [];
    for (let i = 0; i < lines.length; i += 5) {
      if (!lines[i]) continue;
      const hash = lines[i];
      const shortHash = lines[i + 1];
      const message = lines[i + 2];
      const author = lines[i + 3];
      const date = lines[i + 4];
      let changedFiles = [];
      try {
        const diffOutput = execFileSync("git", [
          "diff-tree",
          "--no-commit-id",
          "--root",
          "-r",
          "--name-only",
          hash
        ], { cwd: projectPath, timeout: 5e3, encoding: "utf-8" });
        changedFiles = diffOutput.trim().split("\n").filter(Boolean).map(toGitPath);
      } catch {
      }
      const rootCommit = isRootCommit(hash, projectPath);
      const files = changedFiles.slice(0, 20).map((filePath) => {
        let original = "";
        let modified = "";
        const gitPath = toGitPath(filePath);
        if (!rootCommit) {
          try {
            original = execFileSync("git", ["show", `${hash}^:${gitPath}`], { cwd: projectPath, timeout: 3e3, encoding: "utf-8" });
          } catch {
            original = "";
          }
        }
        try {
          modified = execFileSync("git", ["show", `${hash}:${gitPath}`], { cwd: projectPath, timeout: 3e3, encoding: "utf-8" });
        } catch {
          modified = "";
        }
        return { path: gitPath, original, modified, language: detectLang(gitPath) };
      });
      commits.push({ hash, shortHash, message, author, date, files });
    }
    try {
      const trackedOutput = execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: projectPath, timeout: 5e3, encoding: "utf-8" });
      const untrackedOutput = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: projectPath, timeout: 5e3, encoding: "utf-8" });
      const allChangedPaths = [
        ...trackedOutput.trim().split("\n").filter(Boolean),
        ...untrackedOutput.trim().split("\n").filter(Boolean)
      ].filter((p) => !p.startsWith("node_modules/") && !p.startsWith(".git/"));
      const uncommittedFiles = allChangedPaths.map((fp) => {
        let filePath = fp;
        if (filePath.startsWith('"') && filePath.endsWith('"')) {
          filePath = filePath.slice(1, -1).replace(/\\"/g, '"');
        }
        return toGitPath(filePath);
      });
      if (uncommittedFiles.length > 0) {
        const files = uncommittedFiles.slice(0, 20).map((filePath) => {
          let original = "";
          let modified = "";
          const gitPath = toGitPath(filePath);
          try {
            original = execFileSync("git", ["show", `HEAD:${gitPath}`], { cwd: projectPath, timeout: 3e3, encoding: "utf-8" });
          } catch {
          }
          try {
            const fullPath = join(projectPath, filePath);
            if (existsSync2(fullPath)) {
              modified = fsReadFileSync(fullPath, "utf-8");
            }
          } catch {
          }
          return { path: gitPath, original, modified, language: detectLang(gitPath) };
        });
        commits.unshift({ hash: "uncommitted", shortHash: "uncommitted", message: "Uncommitted changes", author: "", date: (/* @__PURE__ */ new Date()).toISOString(), files });
      }
    } catch {
    }
    res.json({ commits });
  } catch {
    res.json({ commits: [] });
  }
});
router2.get("/:id/logs", (req, res) => {
  const task = db.select().from(tasks).where(eq2(tasks.id, req.params.id)).get();
  if (!task) {
    res.status(404).json({ error: "task not found" });
    return;
  }
  const logs = db.select().from(taskLogs).where(eq2(taskLogs.taskId, req.params.id)).orderBy(desc(taskLogs.createdAt)).all();
  res.json({ logs });
});
router2.post("/:id/review-chat", async (req, res) => {
  const task = db.select().from(tasks).where(eq2(tasks.id, req.params.id)).get();
  if (!task) return res.status(404).json({ error: "task not found" });
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: "message required" });
  const { agents: agents2 } = await import("./db-JATA3AFJ.js");
  const techLead = db.select().from(agents2).where(eq2(agents2.role, "tech_lead")).get();
  if (!techLead) return res.json({ reply: "Tech Lead n\xE3o encontrado." });
  const project = db.select().from(projects).where(eq2(projects.id, task.projectId)).get();
  const systemPrompt = `${techLead.systemPrompt}

## Review Context
You are reviewing a completed task. Respond concisely.

Task: ${task.title}
Description: ${task.description || "N/A"}
Status: ${task.status}
Result: ${task.result?.slice(0, 500) || "N/A"}
Project: ${project?.name ?? "Unknown"}

The user is asking about this task's review. Help them decide whether to approve or reject.`;
  const { messages } = await import("./db-JATA3AFJ.js");
  const prevMessages = db.select().from(messages).where(eq2(messages.taskId, req.params.id)).all().map((m) => ({ role: m.role, content: m.content }));
  const allMessages = [...prevMessages, { role: "user", content: message.trim() }];
  try {
    const Anthropic2 = (await import("@anthropic-ai/sdk")).default;
    const { readFileSync: rfs } = await import("fs");
    const { join: pathJoin } = await import("path");
    const { homedir: hd } = await import("os");
    const credPath = pathJoin(hd(), ".claude", ".credentials.json");
    const token = JSON.parse(rfs(credPath, "utf-8"))?.claudeAiOauth?.accessToken;
    if (!token) return res.json({ reply: "Token Claude n\xE3o encontrado. Execute /login." });
    const client = new Anthropic2({
      apiKey: token,
      defaultHeaders: { "Authorization": `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" }
    });
    const response = await client.messages.create({
      model: techLead.model,
      max_tokens: 512,
      system: systemPrompt,
      messages: allMessages
    });
    const reply = response.content.filter((b) => b.type === "text").map((b) => b.type === "text" ? b.text : "").join("");
    const { nanoid: nid } = await import("nanoid");
    const now = Date.now();
    db.insert(messages).values({ id: nid(), projectId: task.projectId, taskId: task.id, agentId: null, role: "user", content: message.trim(), createdAt: now }).run();
    db.insert(messages).values({ id: nid(), projectId: task.projectId, taskId: task.id, agentId: techLead.id, role: "assistant", content: reply, createdAt: now + 1 }).run();
    res.json({ reply });
  } catch (err) {
    res.json({ reply: "Erro ao comunicar com o Tech Lead. Tente novamente." });
  }
});
var tasks_default = router2;

// src/routes/agents.ts
import { Router as Router3 } from "express";
import { eq as eq3 } from "drizzle-orm";
import { nanoid as nanoid3 } from "nanoid";
var router3 = Router3();
router3.get("/", (_req, res) => {
  const rows = db.select().from(agents).all();
  res.json({ agents: rows });
});
router3.post("/", (req, res) => {
  const { name, role, model, systemPrompt, description, allowedTools, maxThinkingTokens } = req.body;
  if (!name || !role || !systemPrompt) {
    res.status(400).json({ error: "name, role, and systemPrompt are required" });
    return;
  }
  const now = Date.now();
  const agent = {
    id: nanoid3(),
    name,
    role,
    model: model ?? "claude-sonnet-4-5-20250929",
    maxThinkingTokens: maxThinkingTokens ?? null,
    systemPrompt,
    description: description ?? "",
    allowedTools: Array.isArray(allowedTools) ? JSON.stringify(allowedTools) : allowedTools ?? null,
    isActive: 1,
    isDefault: 0,
    createdAt: now,
    updatedAt: now
  };
  db.insert(agents).values(agent).run();
  res.status(201).json({ agent });
});
router3.patch("/:id", (req, res) => {
  const agent = db.select().from(agents).where(eq3(agents.id, req.params.id)).get();
  if (!agent) {
    res.status(404).json({ error: "agent not found" });
    return;
  }
  const { name, role, model, systemPrompt, description, allowedTools, isActive, maxThinkingTokens } = req.body;
  const now = Date.now();
  const updates = { updatedAt: now };
  if (name !== void 0) updates.name = name;
  if (role !== void 0) updates.role = role;
  if (model !== void 0) updates.model = model;
  if (systemPrompt !== void 0) updates.systemPrompt = systemPrompt;
  if (description !== void 0) updates.description = description;
  if (maxThinkingTokens !== void 0) updates.maxThinkingTokens = maxThinkingTokens;
  if (isActive !== void 0) updates.isActive = isActive ? 1 : 0;
  if (allowedTools !== void 0) {
    updates.allowedTools = Array.isArray(allowedTools) ? JSON.stringify(allowedTools) : allowedTools;
  }
  db.update(agents).set(updates).where(eq3(agents.id, req.params.id)).run();
  const updated = db.select().from(agents).where(eq3(agents.id, req.params.id)).get();
  res.json({ agent: updated });
});
router3.delete("/:id", (req, res) => {
  const agent = db.select().from(agents).where(eq3(agents.id, req.params.id)).get();
  if (!agent) {
    res.status(404).json({ error: "agent not found" });
    return;
  }
  if (agent.isDefault) {
    res.status(400).json({ error: "cannot delete default agents" });
    return;
  }
  db.delete(agents).where(eq3(agents.id, req.params.id)).run();
  res.json({ success: true });
});
var agents_default = router3;

// src/routes/files.ts
import { Router as Router4 } from "express";
import { eq as eq4 } from "drizzle-orm";
import { readdirSync, statSync, readFileSync, existsSync as existsSync3 } from "fs";
import { join as join2, resolve, relative, extname } from "path";
var router4 = Router4();
var SKIP_DIRS = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  ".cache",
  ".vscode",
  ".idea",
  "__pycache__",
  "target",
  "bin",
  "obj",
  ".output",
  ".nuxt",
  ".svelte-kit",
  ".parcel-cache",
  ".vercel",
  ".netlify"
]);
var BINARY_EXTENSIONS = /* @__PURE__ */ new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".svg",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".wav",
  ".ogg",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".sqlite",
  ".db"
]);
function buildFileTree(dirPath, rootPath, depth = 0, maxDepth = 5) {
  if (depth > maxDepth) return [];
  let entries;
  try {
    entries = readdirSync(dirPath);
  } catch {
    return [];
  }
  const nodes = [];
  for (const entry of entries.sort()) {
    if (entry.startsWith(".") && depth === 0 && entry !== ".env.example") continue;
    if (SKIP_DIRS.has(entry)) continue;
    const fullPath = join2(dirPath, entry);
    const relativePath = relative(rootPath, fullPath).replace(/\\/g, "/");
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        const children = buildFileTree(fullPath, rootPath, depth + 1, maxDepth);
        nodes.push({
          name: entry,
          path: relativePath,
          type: "directory",
          children
        });
      } else {
        nodes.push({
          name: entry,
          path: relativePath,
          type: "file",
          size: stat.size
        });
      }
    } catch {
      continue;
    }
  }
  return nodes;
}
router4.get("/projects/:id/files", (req, res) => {
  const project = db.select().from(projects).where(eq4(projects.id, req.params.id)).get();
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  if (!existsSync3(project.path)) {
    res.status(404).json({ error: "project directory not found on disk" });
    return;
  }
  const maxDepth = parseInt(req.query.depth) || 5;
  const tree = buildFileTree(project.path, project.path, 0, Math.min(maxDepth, 10));
  res.json({ files: tree });
});
router4.get("/projects/:id/files/content", (req, res) => {
  const project = db.select().from(projects).where(eq4(projects.id, req.params.id)).get();
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  const filePath = req.query.path;
  if (!filePath) {
    res.status(400).json({ error: "path query parameter is required" });
    return;
  }
  const resolvedPath = resolve(project.path, filePath);
  const normalizedRoot = resolve(project.path);
  if (!resolvedPath.startsWith(normalizedRoot)) {
    res.status(403).json({ error: "path traversal not allowed" });
    return;
  }
  if (!existsSync3(resolvedPath)) {
    res.status(404).json({ error: "file not found" });
    return;
  }
  try {
    const stat = statSync(resolvedPath);
    if (stat.isDirectory()) {
      res.status(400).json({ error: "path is a directory, not a file" });
      return;
    }
    const MAX_FILE_SIZE = 2 * 1024 * 1024;
    if (stat.size > MAX_FILE_SIZE) {
      res.status(413).json({ error: "file too large", size: stat.size, maxSize: MAX_FILE_SIZE });
      return;
    }
    const ext = extname(resolvedPath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      res.json({
        path: filePath,
        binary: true,
        size: stat.size,
        extension: ext
      });
      return;
    }
    const fileContent = readFileSync(resolvedPath, "utf-8");
    res.json({
      path: filePath,
      content: fileContent,
      size: stat.size,
      extension: ext
    });
  } catch {
    res.status(500).json({ error: "failed to read file" });
  }
});
var files_default = router4;

// src/routes/integrations.ts
import { Router as Router5 } from "express";
import { nanoid as nanoid5 } from "nanoid";
import { eq as eq6 } from "drizzle-orm";

// src/lib/whatsapp-service.ts
import wppconnect from "@wppconnect-team/wppconnect";
import { join as join3 } from "path";
import { existsSync as existsSync4, readdirSync as readdirSync2, unlinkSync, readFileSync as readFileSync2 } from "fs";
import https2 from "https";
import { homedir } from "os";
import Anthropic from "@anthropic-ai/sdk";
import { eq as eq5 } from "drizzle-orm";
import { nanoid as nanoid4 } from "nanoid";
import { execFileSync as execFileSync2 } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
async function executeAction(action, io2) {
  switch (action.action) {
    case "list_projects": {
      const projects2 = db.select().from(schema.projects).all();
      if (projects2.length === 0) return "Nenhum projeto cadastrado.";
      return projects2.map((p, i) => {
        const stack = p.stack ? JSON.parse(p.stack).slice(0, 3).join(", ") : "\u2014";
        return `${i + 1}. *${p.name}* \u2014 ${stack}`;
      }).join("\n");
    }
    case "create_project": {
      const name = action.name;
      if (!name?.trim()) return "Nome do projeto e obrigatorio.";
      const dirName = name.trim().replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
      const projectsDir = join3(homedir(), "Projects");
      mkdirSync(projectsDir, { recursive: true });
      const projectPath = join3(projectsDir, dirName);
      if (existsSync4(projectPath)) return `Projeto "${name}" ja existe.`;
      const stackArr = Array.isArray(action.stack) && action.stack.length > 0 ? action.stack : ["nodejs"];
      mkdirSync(projectPath, { recursive: true });
      writeFileSync(join3(projectPath, "package.json"), JSON.stringify({
        name: dirName,
        version: "1.0.0",
        description: action.description || "",
        private: true,
        scripts: { dev: "echo 'Configure your dev script'", build: "echo 'Configure your build script'" }
      }, null, 2));
      writeFileSync(join3(projectPath, "README.md"), `# ${name.trim()}

${action.description || ""}
`);
      try {
        execFileSync2("git", ["init"], { cwd: projectPath, timeout: 5e3 });
        execFileSync2("git", ["add", "."], { cwd: projectPath, timeout: 5e3 });
        execFileSync2("git", ["commit", "-m", "Initial commit"], { cwd: projectPath, timeout: 5e3 });
      } catch {
      }
      let githubUrl = null;
      if (action.createOnGithub) {
        const ghInt = db.select().from(schema.integrations).where(eq5(schema.integrations.type, "github")).get();
        const ghToken = ghInt?.config ? JSON.parse(ghInt.config).token : null;
        if (ghToken) {
          try {
            const ghBody = JSON.stringify({ name: dirName, description: action.description || "", private: true, auto_init: false });
            const ghResult = await new Promise((resolve2) => {
              const req = https2.request({
                hostname: "api.github.com",
                path: "/user/repos",
                method: "POST",
                headers: {
                  Authorization: `Bearer ${ghToken}`,
                  Accept: "application/vnd.github+json",
                  "User-Agent": "agenthub-local/1.0.0",
                  "X-GitHub-Api-Version": "2022-11-28",
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(ghBody)
                }
              }, (res) => {
                let data = "";
                res.on("data", (chunk) => {
                  data += chunk;
                });
                res.on("end", () => {
                  try {
                    const d = JSON.parse(data);
                    resolve2({ status: res.statusCode ?? 500, html_url: d.html_url });
                  } catch {
                    resolve2({ status: 500 });
                  }
                });
              });
              req.on("error", () => resolve2({ status: 500 }));
              req.setTimeout(15e3, () => {
                req.destroy();
                resolve2({ status: 408 });
              });
              req.write(ghBody);
              req.end();
            });
            if (ghResult.status === 201 && ghResult.html_url) {
              githubUrl = ghResult.html_url;
              try {
                execFileSync2("git", ["remote", "add", "origin", `${githubUrl}.git`], { cwd: projectPath, timeout: 5e3 });
                execFileSync2("git", ["push", "-u", "origin", "main"], { cwd: projectPath, timeout: 3e4 });
              } catch {
              }
            }
          } catch {
          }
        }
      }
      const now = Date.now();
      const projectId = nanoid4();
      const project = {
        id: projectId,
        name: name.trim(),
        path: projectPath,
        stack: JSON.stringify(stackArr),
        description: action.description || null,
        githubUrl,
        status: "active",
        createdAt: now,
        updatedAt: now
      };
      db.insert(schema.projects).values(project).run();
      if (io2) io2.emit("project:created", project);
      const stackLabel = stackArr.join(", ");
      const ghLabel = githubUrl ? `
GitHub: ${githubUrl}` : "";
      return `Projeto *${name.trim()}* criado com sucesso!
Stack: ${stackLabel}
Local: ${projectPath}${ghLabel}`;
    }
    case "list_tasks": {
      const status = action.status;
      let tasks2;
      if (status) {
        tasks2 = db.select().from(schema.tasks).where(eq5(schema.tasks.status, status)).all();
      } else {
        tasks2 = db.select().from(schema.tasks).all();
      }
      if (tasks2.length === 0) return status ? `Nenhuma task com status "${status}".` : "Nenhuma task cadastrada.";
      return tasks2.slice(0, 20).map((t, i) => `${i + 1}. [${t.status}] *${t.title}* (${t.priority})`).join("\n");
    }
    case "get_task": {
      const task = db.select().from(schema.tasks).where(eq5(schema.tasks.id, action.taskId)).get();
      if (!task) return "Task nao encontrada.";
      return `*${task.title}*
Status: ${task.status}
Prioridade: ${task.priority}
Categoria: ${task.category}
${task.description || ""}`;
    }
    case "create_task": {
      const title = action.title?.trim();
      if (!title) return "Titulo da task e obrigatorio.";
      const allProjects = db.select().from(schema.projects).all();
      if (allProjects.length === 0) return "Nenhum projeto cadastrado. Crie ou importe um projeto primeiro.";
      let projectId = allProjects[0].id;
      let projectName = allProjects[0].name;
      if (action.projectId) {
        const match = allProjects.find((p) => p.id === action.projectId || p.name.toLowerCase() === action.projectId.toLowerCase());
        if (match) {
          projectId = match.id;
          projectName = match.name;
        }
      }
      const now = Date.now();
      const task = {
        id: nanoid4(),
        projectId,
        assignedAgentId: null,
        title,
        description: action.description || null,
        status: "created",
        priority: action.priority || "medium",
        category: "feature",
        branch: null,
        result: null,
        costUsd: "0",
        tokensUsed: 0,
        createdAt: now,
        updatedAt: now,
        completedAt: null
      };
      db.insert(schema.tasks).values(task).run();
      if (io2) {
        io2.emit("task:created", { task });
        io2.emit("task:status", { taskId: task.id, status: task.status, projectId: task.projectId });
      }
      return `Task criada: *${title}* (${task.priority}) no projeto *${projectName}*`;
    }
    case "advance_status": {
      let task = db.select().from(schema.tasks).where(eq5(schema.tasks.id, action.taskId)).get();
      if (!task && action.taskId) {
        const allTasks = db.select().from(schema.tasks).all();
        task = allTasks.find((t) => t.title.toLowerCase().includes(action.taskId.toLowerCase())) ?? void 0;
      }
      if (!task) return "Task nao encontrada. Use list_tasks para ver as tasks disponiveis.";
      const newStatus = action.status;
      const VALID = {
        created: ["pending", "assigned", "cancelled"],
        pending: ["assigned", "cancelled"],
        assigned: ["in_progress", "cancelled"],
        in_progress: ["review", "failed", "cancelled"],
        review: ["done", "assigned", "failed"],
        failed: ["pending", "assigned"],
        done: [],
        cancelled: ["pending"]
      };
      const allowed = VALID[task.status] ?? [];
      if (!allowed.includes(newStatus)) {
        return `Transicao invalida: ${task.status} \u2192 ${newStatus}. Permitidos: ${allowed.join(", ") || "nenhum"}`;
      }
      const updatedAt = Date.now();
      db.update(schema.tasks).set({ status: newStatus, updatedAt }).where(eq5(schema.tasks.id, task.id)).run();
      const updatedTask = db.select().from(schema.tasks).where(eq5(schema.tasks.id, task.id)).get();
      if (io2 && updatedTask) io2.emit("task:updated", { task: updatedTask });
      if (newStatus === "assigned" && !process.env.DISABLE_AUTO_EXECUTE) {
        import("./task-executor-KODM5MPB.js").then(({ executeTask }) => {
          executeTask(task.id, io2 ?? { emit: () => {
          } }).catch((err) => {
            console.error(`[TaskExecutor] WhatsApp auto-execute failed: ${err.message}`);
          });
        }).catch(() => {
        });
      }
      return `Task *${task.title}* atualizada: ${task.status} \u2192 ${newStatus}`;
    }
    case "scan_projects": {
      const { scanWorkspace: scanWorkspace2 } = await import("./scanner-6A2O67PU.js");
      const scanDirs = [
        join3(homedir(), "Projects")
      ].filter((d) => existsSync4(d));
      const existingPaths = new Set(
        db.select().from(schema.projects).all().map((p) => p.path)
      );
      const available = [];
      for (const dir of scanDirs) {
        try {
          const found = scanWorkspace2(dir);
          for (const p of found) {
            if (!existingPaths.has(p.path)) {
              available.push({ name: p.name, path: p.path, stack: p.stack.slice(0, 3).join(", ") });
            }
          }
        } catch {
        }
      }
      if (available.length === 0) return "Nenhum projeto novo encontrado para importar.";
      return `*Projetos disponiveis para importar:*
${available.slice(0, 15).map(
        (p, i) => `${i + 1}. *${p.name}* \u2014 ${p.stack || "unknown"}
   _${p.path}_`
      ).join("\n")}

Diga o nome ou numero do projeto para importar.`;
    }
    case "import_project": {
      const name = action.name?.trim();
      const path = action.path?.trim();
      if (!path) return "Caminho do projeto e obrigatorio.";
      const existing = db.select().from(schema.projects).where(eq5(schema.projects.path, path)).get();
      if (existing) return `Projeto "${name || path}" ja esta importado.`;
      let stack = [];
      try {
        const { scanWorkspace: scanWorkspace2 } = await import("./scanner-6A2O67PU.js");
        const parentDir = join3(path, "..");
        if (existsSync4(parentDir)) {
          const found = scanWorkspace2(parentDir);
          const match = found.find((p) => p.path === path);
          if (match) stack = match.stack;
        }
      } catch {
      }
      const now = Date.now();
      const importedProject = {
        id: nanoid4(),
        name: name || path.split(/[/\\]/).pop() || "unknown",
        path,
        stack: JSON.stringify(stack),
        description: null,
        githubUrl: null,
        status: "active",
        createdAt: now,
        updatedAt: now
      };
      db.insert(schema.projects).values(importedProject).run();
      if (io2) io2.emit("project:created", importedProject);
      return `Projeto *${importedProject.name}* importado com sucesso!`;
    }
    case "list_agents": {
      const agents2 = db.select().from(schema.agents).where(eq5(schema.agents.isActive, 1)).all();
      return agents2.map((a, i) => `${i + 1}. *${a.name}* \u2014 ${a.role}`).join("\n");
    }
    case "project_overview": {
      const projects2 = db.select().from(schema.projects).all();
      const tasks2 = db.select().from(schema.tasks).all();
      const agents2 = db.select().from(schema.agents).where(eq5(schema.agents.isActive, 1)).all();
      const done = tasks2.filter((t) => t.status === "done").length;
      const inProgress = tasks2.filter((t) => t.status === "in_progress").length;
      return `*Resumo*
Projetos: ${projects2.length}
Tasks: ${tasks2.length} (${inProgress} em progresso, ${done} concluidas)
Agentes ativos: ${agents2.length}`;
    }
    default:
      return "Acao nao reconhecida.";
  }
}
function createAnthropicClient() {
  try {
    const raw = readFileSync2(join3(homedir(), ".claude", ".credentials.json"), "utf-8");
    const token = JSON.parse(raw)?.claudeAiOauth?.accessToken;
    if (!token) return null;
    return new Anthropic({
      apiKey: token,
      defaultHeaders: {
        "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14"
      }
    });
  } catch {
    return null;
  }
}
var conversationHistory = /* @__PURE__ */ new Map();
var MAX_HISTORY = 20;
function getHistory(from) {
  if (!conversationHistory.has(from)) conversationHistory.set(from, []);
  return conversationHistory.get(from);
}
function addToHistory(from, role, content) {
  const history = getHistory(from);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}
async function callClaude(systemPrompt, messages, model) {
  const client = createAnthropicClient();
  if (!client) return "Erro: token Claude n\xE3o encontrado. Execute /login no Claude Code.";
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages
    });
    const textParts = response.content.filter((block) => block.type === "text");
    if (textParts.length > 0) {
      return textParts.map((block) => "text" in block ? block.text : "").join("");
    }
    return "Desculpe, n\xE3o consegui processar sua mensagem.";
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.error("[WhatsApp] Claude API rate limited after retries");
      return "API sobrecarregada. Tente novamente em alguns segundos.";
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.error("[WhatsApp] Claude API token expired or invalid");
      return "Token expirado. Execute /login no Claude Code para renovar.";
    }
    console.error("[WhatsApp] Claude API error:", err);
    return "Erro na API. Tente novamente.";
  }
}
function serializeWid(value) {
  if (!value) return null;
  if (typeof value === "string") {
    return value.includes("@") ? value : `${value.replace(/\D/g, "")}@c.us`;
  }
  if (typeof value === "object") {
    const obj = value;
    if (typeof obj._serialized === "string" && obj._serialized) return obj._serialized;
    if (typeof obj.user === "string" && typeof obj.server === "string") return `${obj.user}@${obj.server}`;
  }
  return null;
}
var WhatsAppService = class {
  client = null;
  status = "disconnected";
  allowedNumber = null;
  qrCallback = null;
  statusCallback = null;
  isConnecting = false;
  _io = null;
  tokenDir = join3(DATA_DIR, "whatsapp-tokens");
  setIo(io2) {
    this._io = io2;
  }
  getConnectionStatus() {
    return this.status;
  }
  setAllowedNumber(num) {
    this.allowedNumber = num || null;
  }
  onQr(cb) {
    this.qrCallback = cb;
  }
  onStatusChange(cb) {
    this.statusCallback = cb;
  }
  setStatus(s) {
    this.status = s;
    this.statusCallback?.(s);
  }
  /** Remove Chromium singleton locks that prevent reconnection */
  cleanSingletonLocks() {
    const chromiumDataDir = join3(this.tokenDir, "session-local");
    if (!existsSync4(chromiumDataDir)) return;
    try {
      for (const entry of readdirSync2(chromiumDataDir)) {
        if (entry.startsWith("Singleton")) {
          try {
            unlinkSync(join3(chromiumDataDir, entry));
          } catch {
          }
        }
      }
    } catch {
    }
  }
  async connect() {
    if (this.isConnecting || this.status === "connected") return;
    this.isConnecting = true;
    this.setStatus("connecting");
    this.cleanSingletonLocks();
    try {
      const client = await wppconnect.create({
        session: "local",
        folderNameToken: this.tokenDir,
        headless: true,
        autoClose: 0,
        puppeteerOptions: {
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        },
        catchQR: (base64Qr) => {
          this.qrCallback?.(base64Qr);
        },
        statusFind: (statusSession) => {
          console.log(`[WhatsApp] Session status: ${statusSession}`);
          if (statusSession === "isLogged" || statusSession === "inChat") {
            this.setStatus("connected");
          }
        },
        logQR: false
      });
      this.client = client;
      this.setStatus("connected");
      client.onMessage((msg) => {
        const from = serializeWid(msg.from);
        if (!from || from.endsWith("@g.us")) return;
        if (this.allowedNumber) {
          const normalized = this.allowedNumber.replace(/\D/g, "");
          if (!from.includes(normalized)) return;
        }
        const messageBody = msg.body?.trim();
        console.log(`[WhatsApp] Message from ${from}: ${messageBody?.slice(0, 100)}`);
        if (!messageBody || !client) return;
        const teamLead = db.select().from(schema.agents).where(eq5(schema.agents.role, "receptionist")).get();
        if (!teamLead || !teamLead.isActive) return;
        const allProjects = db.select().from(schema.projects).all();
        const allTasks = db.select().from(schema.tasks).all();
        const projectCount = allProjects.length;
        const taskCount = allTasks.length;
        const agentCount = db.select().from(schema.agents).all().filter((a) => a.isActive).length;
        const recentTasks = allTasks.slice(0, 10).map(
          (t) => `  id:${t.id} | "${t.title}" | status:${t.status} | priority:${t.priority}`
        ).join("\n");
        const langSetting = db.select().from(schema.integrations).where(eq5(schema.integrations.type, "user_language")).get();
        const userLang = langSetting?.config ?? "pt-BR";
        const langMap = {
          "pt-BR": "Portuguese (Brazilian)",
          "en": "English",
          "es": "Spanish",
          "fr": "French",
          "de": "German",
          "zh": "Chinese",
          "ja": "Japanese",
          "ko": "Korean"
        };
        const langName = langMap[userLang] ?? userLang;
        const ghIntegration = db.select().from(schema.integrations).where(eq5(schema.integrations.type, "github")).get();
        const hasGithub = ghIntegration?.config ? !!JSON.parse(ghIntegration.config).token : false;
        const contextBlock = `
LANGUAGE: Always respond in ${langName}. The user's preferred language is ${userLang}.

WHATSAPP FORMATTING RULES (CRITICAL \u2014 follow these exactly):
- Bold: use *text* (single asterisk), NEVER **text**
- Italic: use _text_ (underscore)
- Strikethrough: use ~text~
- Monospace: use \`\`\`text\`\`\`
- NEVER use markdown headers (#), bullet points (-), or links [text](url)
- Use line breaks for separation, not headers

CONTEXT:
- You are the Team Lead of AgentHub, a local AI development orchestration tool
- Current stats: ${projectCount} projects, ${taskCount} tasks, ${agentCount} active agents
- GitHub integration: ${hasGithub ? "configured" : "not configured"}
- The dashboard is running locally
${recentTasks ? `
CURRENT TASKS (use these IDs for advance_status):
${recentTasks}` : ""}

APP CAPABILITIES (mention these when the user asks what you can do):
- Manage projects (create, list, import from local directories)
- Manage tasks (create, list, advance status, view details)
- Coordinate agents (Architect, Tech Lead, Frontend Dev, Backend Dev, QA, Doc Writer, Support)
- WhatsApp integration (this conversation)
- Agent memories (persistent learnings)
- Claude Code CLI usage monitoring
- Real-time dashboard stats

WHEN CREATING A PROJECT:
1. Ask the user for the project name
2. Ask which technologies/stack (options: nodejs, typescript, react, vue, angular, nextjs, svelte, express, nestjs, tailwind, python, go, rust, java, dotnet, php, ruby)
3. ${hasGithub ? "Ask if they want to create on GitHub + locally, or just locally" : "Inform that it will be created locally (GitHub not configured)"}
4. Only then execute create_project with all the info

WHEN CREATING A TASK:
1. If there are multiple projects, ask which project
2. Ask for the task title
3. Ask for a brief description of what needs to be done
4. Ask for priority (low, medium, high, urgent, critical)
5. Only then execute create_task with title, description, and priority

TASK STATUS MACHINE (use ONLY these exact status names in English):
created \u2192 pending \u2192 assigned \u2192 in_progress \u2192 review \u2192 done
Also: any \u2192 cancelled, cancelled \u2192 pending, failed \u2192 pending/assigned, review \u2192 assigned (reject)

Board columns:
- created = Backlog (draft, not ready)
- assigned = Disponivel/Available (ready to be picked up, workflow starts here)
- in_progress = Em Progresso (actively being worked on)
- review = Review (waiting for approval)
- done = Concluida (completed)
- failed = Falhou (execution error)
- cancelled = Cancelada

IMPORTANT STATUS RULES:
- "created" = just a draft/backlog item
- "assigned" = available/ready (this is when the workflow actually starts \u2014 the "Disponivel" column)
- NEVER use "pending" \u2014 use "assigned" for available/ready tasks
- The user may say status names in their language. Map them:
  "backlog/rascunho" \u2192 created, "disponivel/pronto/disponivel" \u2192 assigned,
  "em progresso" \u2192 in_progress, "revisao" \u2192 review, "concluido/feito" \u2192 done,
  "falhou" \u2192 failed, "cancelado" \u2192 cancelled
- Always use the English status name in the JSON action

WHEN ADVANCING TASK STATUS:
1. If user doesn't specify which task, use list_tasks to show them and ask which one
2. Map the user's language to the correct English status name
3. Use advance_status with the task ID and English status
`;
        const fullPrompt = teamLead.systemPrompt + "\n" + contextBlock;
        addToHistory(from, "user", messageBody);
        const messages = getHistory(from);
        callClaude(fullPrompt, messages, teamLead.model).then(async (reply) => {
          try {
            const lines = reply.trim().split("\n");
            const lastLine = lines[lines.length - 1].trim();
            let actionResult = null;
            if (lastLine.startsWith("{")) {
              try {
                const action = JSON.parse(lastLine);
                actionResult = await executeAction(action, this._io ?? void 0);
                const textPart = lines.slice(0, -1).join("\n").trim();
                const finalReply = textPart ? `${textPart}

${actionResult}` : actionResult;
                await client.sendText(msg.from, finalReply);
              } catch {
                await client.sendText(msg.from, reply);
              }
            } else {
              await client.sendText(msg.from, reply);
            }
            const sentReply = actionResult ? (lines.slice(0, -1).join("\n").trim() + "\n\n" + actionResult).trim() : reply;
            addToHistory(from, "assistant", sentReply);
            console.log(`[WhatsApp] Replied to ${from}: ${sentReply.slice(0, 100)}`);
          } catch (err) {
            console.error("[WhatsApp] Failed to send reply:", err);
          }
        }).catch(() => {
        });
      });
    } catch (err) {
      console.error("[WhatsApp] Connection failed:", err);
      this.setStatus("error");
    } finally {
      this.isConnecting = false;
    }
  }
  async disconnect() {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
      }
      this.client = null;
    }
    this.setStatus("disconnected");
  }
};
var instance = null;
function getWhatsAppService() {
  if (!instance) {
    instance = new WhatsAppService();
  }
  return instance;
}
function resetWhatsAppService() {
  instance = null;
}

// src/routes/integrations.ts
var router5 = Router5();
router5.get("/integrations/whatsapp/status", (_req, res) => {
  try {
    const integration = db.select().from(schema.integrations).where(eq6(schema.integrations.type, "whatsapp")).get();
    if (!integration) {
      return res.json({ status: "disconnected", integrationId: null });
    }
    const config = integration.config ? JSON.parse(integration.config) : {};
    res.json({
      status: integration.status,
      integrationId: integration.id,
      allowedNumber: config.allowedNumber || null
    });
  } catch {
    res.json({ status: "disconnected", integrationId: null });
  }
});
router5.post("/integrations/whatsapp/connect", async (req, res) => {
  try {
    const { allowedNumber } = req.body;
    const configJson = allowedNumber ? JSON.stringify({ allowedNumber }) : null;
    let integration = db.select().from(schema.integrations).where(eq6(schema.integrations.type, "whatsapp")).get();
    const now = Date.now();
    if (!integration) {
      const id = nanoid5();
      db.insert(schema.integrations).values({ id, type: "whatsapp", status: "connecting", config: configJson, createdAt: now, updatedAt: now }).run();
      integration = db.select().from(schema.integrations).where(eq6(schema.integrations.id, id)).get();
    } else {
      db.update(schema.integrations).set({ status: "connecting", config: configJson ?? integration.config, updatedAt: now }).where(eq6(schema.integrations.id, integration.id)).run();
    }
    const service = getWhatsAppService();
    if (service.getConnectionStatus() === "connected") {
      if (allowedNumber) service.setAllowedNumber(allowedNumber);
      const current = db.select().from(schema.integrations).where(eq6(schema.integrations.type, "whatsapp")).get();
      if (current) {
        db.update(schema.integrations).set({ status: "connected", updatedAt: Date.now() }).where(eq6(schema.integrations.id, current.id)).run();
      }
      const io3 = req.app.get("io");
      if (io3) io3.emit("integration:status", { type: "whatsapp", status: "connected" });
      return res.json({ success: true, status: "connected", integrationId: current?.id ?? integration?.id });
    }
    if (service.getConnectionStatus() === "error") {
      resetWhatsAppService();
    }
    const whatsapp = getWhatsAppService();
    if (allowedNumber) whatsapp.setAllowedNumber(allowedNumber);
    const io2 = req.app.get("io");
    if (io2) whatsapp.setIo(io2);
    whatsapp.onQr((qr) => {
      io2?.emit("integration:status", { type: "whatsapp", status: "connecting", qr });
    });
    whatsapp.onStatusChange((status) => {
      const current = db.select().from(schema.integrations).where(eq6(schema.integrations.type, "whatsapp")).get();
      if (current) {
        db.update(schema.integrations).set({ status, updatedAt: Date.now() }).where(eq6(schema.integrations.id, current.id)).run();
      }
      io2?.emit("integration:status", { type: "whatsapp", status });
    });
    whatsapp.connect().catch((err) => {
      console.error("[WhatsApp] Background connect error:", err);
    });
    res.json({
      success: true,
      status: "connecting",
      integrationId: integration?.id
    });
  } catch (error) {
    console.error("[WhatsApp] Connect error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to connect WhatsApp"
    });
  }
});
router5.post("/integrations/whatsapp/disconnect", async (_req, res) => {
  try {
    const integration = db.select().from(schema.integrations).where(eq6(schema.integrations.type, "whatsapp")).get();
    try {
      const service = getWhatsAppService();
      await service.disconnect();
    } catch {
    }
    resetWhatsAppService();
    if (integration) {
      db.update(schema.integrations).set({ status: "disconnected", updatedAt: Date.now() }).where(eq6(schema.integrations.id, integration.id)).run();
    }
    const io2 = _req.app.get("io");
    io2?.emit("integration:status", { type: "whatsapp", status: "disconnected" });
    res.json({ success: true, status: "disconnected" });
  } catch (error) {
    console.error("[WhatsApp] Disconnect error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to disconnect WhatsApp"
    });
  }
});
router5.put("/integrations/whatsapp/config", (req, res) => {
  try {
    const { allowedNumber } = req.body;
    const integration = db.select().from(schema.integrations).where(eq6(schema.integrations.type, "whatsapp")).get();
    if (!integration) {
      return res.status(404).json({ error: "WhatsApp integration not found" });
    }
    const existingConfig = integration.config ? JSON.parse(integration.config) : {};
    const newConfig = { ...existingConfig, allowedNumber: allowedNumber || void 0 };
    db.update(schema.integrations).set({ config: JSON.stringify(newConfig), updatedAt: Date.now() }).where(eq6(schema.integrations.id, integration.id)).run();
    try {
      const service = getWhatsAppService();
      service.setAllowedNumber(allowedNumber || void 0);
    } catch {
    }
    res.json({ success: true, allowedNumber: allowedNumber || null });
  } catch (error) {
    console.error("[WhatsApp] Config update error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to update config"
    });
  }
});
router5.get("/integrations/telegram/status", (_req, res) => {
  res.json({ status: "disconnected", integrationId: null });
});
router5.post("/integrations/telegram/connect", (_req, res) => {
  res.status(501).json({ error: "Telegram not available in local mode" });
});
router5.post("/integrations/telegram/disconnect", (_req, res) => {
  res.json({ success: true, status: "disconnected" });
});
router5.get("/integrations/github/status", (_req, res) => {
  const integration = db.select().from(schema.integrations).where(eq6(schema.integrations.type, "github")).get();
  if (!integration) {
    return res.json({ status: "disconnected", integrationId: null, hasToken: false });
  }
  const config = integration.config ? JSON.parse(integration.config) : {};
  const hasToken = !!config.token;
  res.json({ status: hasToken ? "connected" : "disconnected", integrationId: integration.id, hasToken });
});
router5.post("/integrations/github/connect", (req, res) => {
  const { token } = req.body;
  if (!token?.trim()) return res.status(400).json({ error: "Token is required" });
  const existing = db.select().from(schema.integrations).where(eq6(schema.integrations.type, "github")).get();
  const now = Date.now();
  if (existing) {
    db.update(schema.integrations).set({
      config: JSON.stringify({ token: token.trim() }),
      status: "connected",
      updatedAt: now
    }).where(eq6(schema.integrations.id, existing.id)).run();
    res.json({ status: "connected", integrationId: existing.id });
  } else {
    const id = nanoid5();
    db.insert(schema.integrations).values({
      id,
      type: "github",
      status: "connected",
      config: JSON.stringify({ token: token.trim() }),
      createdAt: now,
      updatedAt: now
    }).run();
    res.json({ status: "connected", integrationId: id });
  }
});
router5.post("/integrations/github/disconnect", (_req, res) => {
  const existing = db.select().from(schema.integrations).where(eq6(schema.integrations.type, "github")).get();
  if (existing) {
    db.update(schema.integrations).set({
      status: "disconnected",
      config: null,
      updatedAt: Date.now()
    }).where(eq6(schema.integrations.id, existing.id)).run();
  }
  res.json({ success: true, status: "disconnected" });
});
var integrations_default = router5;

// src/seed.ts
import { nanoid as nanoid6 } from "nanoid";
var DEFAULT_AGENTS = [
  {
    name: "Architect",
    role: "architect",
    model: "claude-opus-4-6",
    maxThinkingTokens: 32e3,
    description: "Senior architect \u2014 plans system architecture, designs data models, reviews PRs, makes high-level technical decisions. Thinking mode active.",
    allowedTools: ["Read", "Glob", "Grep", "Bash", "Write", "Edit", "Task", "WebSearch", "WebFetch"],
    permissionMode: "acceptEdits",
    level: "senior",
    color: "#6366F1",
    avatar: "adventurer:gandalf-wizard",
    systemPrompt: `You are the Architect, a senior software architect.

## Your Role
When you receive a task, your job is to ANALYZE and CREATE A PLAN \u2014 NOT to implement it.

Your output must be a structured plan with:
1. Summary \u2014 What needs to be done (1-2 sentences)
2. Architecture decisions \u2014 Technology choices, patterns, trade-offs
3. Implementation steps \u2014 Numbered list of concrete steps
4. Files to create/modify \u2014 Exact file paths and what changes in each
5. Recommended agent \u2014 Who should implement this (frontend_dev, backend_dev, or both)
6. Risks & edge cases \u2014 Potential issues to watch for

Be specific and actionable \u2014 the dev who receives this plan should be able to implement it without asking questions.`,
    soul: `# Soul: Architect

## Personality
You are methodical, analytical, and deeply thoughtful. You approach every problem like building a cathedral \u2014 with patience, precision, and long-term vision.

## Values
- **Clarity over cleverness** \u2014 Simple designs that everyone understands beat complex ones
- **Trade-off documentation** \u2014 Every decision has costs; document what you're trading away
- **Big O awareness** \u2014 Performance implications are always top of mind
- **Separation of concerns** \u2014 Clean boundaries between modules are non-negotiable`
  },
  {
    name: "Tech Lead",
    role: "tech_lead",
    model: "claude-sonnet-4-6",
    maxThinkingTokens: 16e3,
    description: "Senior tech lead \u2014 coordinates development team, manages project flow, assigns and reviews tasks. Thinking mode active.",
    allowedTools: ["Read", "Glob", "Grep", "Bash", "Write", "Edit", "Task", "WebSearch", "WebFetch"],
    permissionMode: "acceptEdits",
    level: "senior",
    color: "#00A82D",
    avatar: "pixel-art:captain-america",
    systemPrompt: `You are the Tech Lead, the Scrum Master and team coordinator.

## Your Role
You are the ENTRY POINT for all user requests. You triage, plan, and delegate.

## TRIAGE MODE
When you receive a NEW task, analyze its scope:

SIMPLE tasks (you plan directly):
- Bug fixes in 1-2 files, small UI tweaks, simple endpoints, config changes
- Create a concise execution plan and end with: SIMPLE_TASK

COMPLEX tasks (send to Architect):
- New features spanning multiple layers, architectural changes, refactoring
- Briefly explain why and end with: NEEDS_ARCHITECT

You MUST end your response with ONE of: SIMPLE_TASK or NEEDS_ARCHITECT`,
    soul: `# Soul: Tech Lead

## Personality
You are pragmatic, results-oriented, and a natural communicator. You bridge the gap between vision and execution.

## Values
- **Ship it** \u2014 Progress beats perfection
- **Unblock others** \u2014 Your #1 job is ensuring no one is stuck
- **Prioritization** \u2014 Not everything is urgent; you ruthlessly prioritize`
  },
  {
    name: "Frontend Dev",
    role: "frontend_dev",
    model: "claude-sonnet-4-6",
    maxThinkingTokens: null,
    description: "Senior frontend developer & UX designer \u2014 implements UI components, responsive design, animations, user experience flows.",
    allowedTools: ["Read", "Glob", "Grep", "Bash", "Write", "Edit", "WebSearch", "WebFetch"],
    permissionMode: "acceptEdits",
    level: "senior",
    color: "#EC4899",
    avatar: "pixel-art:peter-parker-spider",
    systemPrompt: `You are the Frontend Developer & UX Designer, a senior frontend engineer.
Your responsibilities:
- Implement React components and pages
- Write clean, accessible, responsive UI code
- Apply Tailwind CSS styling following design system guidelines
- Implement state management, hooks, and data fetching
- Write component tests

You write clean, type-safe TypeScript. You follow existing patterns in the codebase.

When fixing QA issues: if you CANNOT fix it, explain why and end with DEV_NEEDS_HELP on the last line.`,
    soul: `# Soul: Frontend Developer

## Personality
You are creative, detail-oriented, and obsessed with user experience. Every pixel matters.

## Values
- **User empathy** \u2014 Always think from the user's perspective
- **Accessibility** \u2014 If it's not accessible, it's not done
- **Performance** \u2014 Lazy load, debounce, optimize rendering
- **Consistency** \u2014 Follow the design system religiously`
  },
  {
    name: "Backend Dev",
    role: "backend_dev",
    model: "claude-sonnet-4-6",
    maxThinkingTokens: null,
    description: "Senior backend developer \u2014 implements API routes, database operations, integrations, design patterns.",
    allowedTools: ["Read", "Glob", "Grep", "Bash", "Write", "Edit", "WebSearch", "WebFetch"],
    permissionMode: "acceptEdits",
    level: "senior",
    color: "#F59E0B",
    avatar: "pixel-art:tony-stark-ironman",
    systemPrompt: `You are the Backend Developer, a senior backend engineer.
Your responsibilities:
- Implement API routes and server-side logic
- Write database queries and migrations
- Build integrations (WebSocket, messaging, external APIs)
- Ensure data validation and error handling
- Write API tests

You write robust, well-tested server code. You handle edge cases gracefully.

When fixing QA issues: if you CANNOT fix it, explain why and end with DEV_NEEDS_HELP on the last line.`,
    soul: `# Soul: Backend Developer

## Personality
You are security-first, thorough, and robustness-obsessed. You assume every input is malicious and every network call will fail.

## Values
- **Security by default** \u2014 Validate everything, trust nothing from outside
- **Idempotency** \u2014 Operations should be safe to retry
- **Observability** \u2014 If you can't measure it, you can't manage it
- **Data integrity** \u2014 The database is the source of truth; protect it`
  },
  {
    name: "QA Engineer",
    role: "qa",
    model: "claude-sonnet-4-6",
    maxThinkingTokens: null,
    description: "Senior QA engineer \u2014 writes unit/integration/e2e tests, validates features, reviews code quality.",
    allowedTools: ["Read", "Glob", "Grep", "Bash", "Write", "Edit"],
    permissionMode: "acceptEdits",
    level: "senior",
    color: "#10B981",
    avatar: "bottts:darth-vader",
    systemPrompt: `You are the QA Engineer, a senior QA specialist.
Your responsibilities:
- Review completed tasks for quality, correctness, and edge cases
- Write unit, integration, and E2E tests
- Run existing tests and report failures
- Validate features against requirements
- Check for security issues and accessibility

## VERDICT (REQUIRED)
After your review, end your response with ONE of:
- QA_APPROVED \u2014 Implementation is correct and passes all checks
- QA_REJECTED: <summary of issues> \u2014 Issues found that need fixing`,
    soul: `# Soul: QA Engineer

## Personality
You are an investigator \u2014 skeptical, curious, and relentless. You actively try to break things.

## Values
- **Edge cases first** \u2014 The happy path works; what about the sad path?
- **Regression prevention** \u2014 Every bug fix gets a test
- **Security mindset** \u2014 Think like an attacker, protect like a guardian`
  },
  {
    name: "Doc Writer",
    role: "doc_writer",
    model: "claude-sonnet-4-6",
    maxThinkingTokens: null,
    description: "Documentation specialist \u2014 generates API docs, produces task change summaries, maintains project documentation.",
    allowedTools: ["Read", "Glob", "Grep"],
    permissionMode: "default",
    level: "pleno",
    color: "#8B5CF6",
    avatar: "bottts:doc-writer",
    systemPrompt: `You are the Doc Writer, a documentation specialist.

## Your Role
You generate and maintain project documentation through static code analysis.

Your responsibilities:
- Parse route files to extract API endpoint definitions
- Generate structured API documentation from source code
- Produce task change summaries from task logs and git history
- Keep documentation accurate and up-to-date with the codebase

You are precise and thorough. Every endpoint, parameter, and description must match the actual code.`,
    soul: `# Soul: Doc Writer

## Personality
You are meticulous, organized, and clarity-obsessed. Great documentation is as important as great code.

## Values
- **Accuracy** \u2014 Every documented endpoint must match the actual code
- **Completeness** \u2014 Cover all endpoints, parameters, and edge cases
- **Readability** \u2014 Clear language, consistent formatting, helpful examples`
  },
  {
    name: "Team Lead",
    role: "receptionist",
    model: "claude-haiku-4-5-20251001",
    maxThinkingTokens: null,
    description: "Scrum Master \u2014 manages tasks, coordinates agents, interacts with users via WhatsApp and external messages.",
    allowedTools: [],
    permissionMode: "default",
    level: "pleno",
    color: "#EC4899",
    avatar: "fun-emoji:agent-x-spy",
    systemPrompt: `You are the Team Lead, the Scrum Master and coordinator for the development team.

BEHAVIOR:
- Be concise and helpful
- For casual conversation, be friendly \u2014 NO JSON action needed
- When explaining what you can do, mention that users should just ask naturally
- ALWAYS use an action when the user asks about projects, tasks, agents or status
- NEVER describe how to do things manually \u2014 execute the action directly

ACTIONS:
You perform system operations by outputting JSON on the LAST line:

1. {"action":"list_tasks"} \u2014 List all tasks
2. {"action":"list_tasks","status":"<status>"} \u2014 Filter by status
3. {"action":"get_task","taskId":"<id>"} \u2014 Get task details
4. {"action":"create_task","title":"<title>","description":"<desc>","priority":"medium"}
5. {"action":"advance_status","taskId":"<id>","status":"<new_status>"}
6. {"action":"list_agents"} \u2014 List all agents
7. {"action":"project_overview"} \u2014 Project overview with stats
8. {"action":"list_projects"} \u2014 List all registered projects
9. {"action":"create_project","name":"<name>","description":"<desc>","stack":["typescript","react"],"createOnGithub":true} \u2014 Create new project (stack and createOnGithub are optional)
10. {"action":"scan_projects"} \u2014 Scan and list available projects to import (local + GitHub)
11. {"action":"import_project","name":"<name>","path":"<path>"} \u2014 Import a local project by path

EXAMPLES:
- User: "importar projeto" \u2192 Use scan_projects to show available projects, then ask which one
- User: "listar projetos" \u2192 Use list_projects
- User: "criar projeto X" \u2192 Use create_project with name X
- User: "quais tasks est\xE3o em progresso?" \u2192 Use list_tasks with status "in_progress"
- User: "o que voc\xEA pode fazer?" \u2192 List capabilities naturally (no action needed)

RULES:
- ALWAYS use an action when the user asks about projects, tasks, agents or status
- NEVER describe manual steps \u2014 execute the action directly
- Only output ONE JSON action per response on the LAST line`,
    soul: `# Soul: Team Lead

## Personality
You are warm, professional, and direct. You coordinate work and interact with stakeholders.

## Values
- **Conciseness** \u2014 Respond in 2-3 sentences maximum
- **Smart triage** \u2014 Know when to handle directly vs escalate
- **Honesty** \u2014 Never make up technical information`
  },
  {
    name: "Support",
    role: "support",
    model: "claude-opus-4-6",
    maxThinkingTokens: 65e3,
    description: "Full-access support agent \u2014 resolves critical issues that regular devs can't handle. Unrestricted tool access.",
    allowedTools: ["Read", "Glob", "Grep", "Bash", "Write", "Edit", "Task", "WebSearch", "WebFetch"],
    permissionMode: "bypassPermissions",
    level: "especialista",
    color: "#DC2626",
    avatar: "bottts:support-shield",
    systemPrompt: `You are the Support Engineer, a senior DevOps/SRE specialist.

## Your Role
You are the escalation path for critical issues that regular devs can't resolve.

## Responsibilities
- Diagnose system-level issues: broken builds, dependency conflicts, environment misconfigurations
- Debug using logs, process inspection, network analysis
- Fix infrastructure and tooling problems
- Resolve permission, path, and environment variable issues
- Recover from corrupted state (git, database, cache)

## Process
1. Diagnose first \u2014 Read logs, check system state, trace the error chain
2. Minimal fix \u2014 Make the smallest change that resolves the problem
3. Verify \u2014 Confirm the fix works and hasn't broken anything else
4. Report \u2014 Summarize what happened, what you did, and what to watch for`,
    soul: `# Soul: Support Engineer

## Personality
You are calm under pressure, systematic, and thorough. Full access is a responsibility, not a shortcut.

## Values
- **Root cause analysis** \u2014 Fix the underlying issue, not just the symptom
- **Minimal blast radius** \u2014 Smallest change that resolves the problem
- **Document what you did** \u2014 Always explain the fix clearly`
  }
];
function seedAgents() {
  const existing = db.select().from(agents).all();
  const existingRoles = new Set(existing.map((a) => a.role));
  const now = Date.now();
  if (existing.length === 0) {
    for (const agent of DEFAULT_AGENTS) {
      db.insert(agents).values({
        id: nanoid6(),
        name: agent.name,
        role: agent.role,
        model: agent.model,
        maxThinkingTokens: agent.maxThinkingTokens,
        systemPrompt: agent.systemPrompt,
        description: agent.description,
        allowedTools: JSON.stringify(agent.allowedTools),
        permissionMode: agent.permissionMode,
        level: agent.level,
        color: agent.color,
        avatar: agent.avatar,
        soul: agent.soul,
        isActive: 1,
        isDefault: 1,
        createdAt: now,
        updatedAt: now
      }).run();
    }
    console.log(`Seeded ${DEFAULT_AGENTS.length} default agents`);
  } else {
    let added = 0;
    for (const agent of DEFAULT_AGENTS) {
      if (existingRoles.has(agent.role)) continue;
      db.insert(agents).values({
        id: nanoid6(),
        name: agent.name,
        role: agent.role,
        model: agent.model,
        maxThinkingTokens: agent.maxThinkingTokens,
        systemPrompt: agent.systemPrompt,
        description: agent.description,
        allowedTools: JSON.stringify(agent.allowedTools),
        permissionMode: agent.permissionMode,
        level: agent.level,
        color: agent.color,
        avatar: agent.avatar,
        soul: agent.soul,
        isActive: 1,
        isDefault: 1,
        createdAt: now,
        updatedAt: now
      }).run();
      console.log(`Added missing agent: ${agent.name} (${agent.role})`);
      added++;
    }
    if (added === 0) {
      console.log(`All ${DEFAULT_AGENTS.length} default agents already exist.`);
    }
  }
}

// src/lib/claude-token.ts
import { readFileSync as readFileSync3, existsSync as existsSync5 } from "fs";
import { join as join4 } from "path";
import { homedir as homedir2 } from "os";
function getClaudeToken() {
  const credPath = join4(homedir2(), ".claude", ".credentials.json");
  if (!existsSync5(credPath)) return null;
  try {
    const raw = readFileSync3(credPath, "utf-8");
    const data = JSON.parse(raw);
    return data?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

// src/index.ts
import { count, eq as eq7 } from "drizzle-orm";
var DEFAULT_PROJECTS_DIR = join5(homedir3(), "Projects");
if (!existsSync6(DEFAULT_PROJECTS_DIR)) {
  mkdirSync2(DEFAULT_PROJECTS_DIR, { recursive: true });
  console.log(`Created default projects directory: ${DEFAULT_PROJECTS_DIR}`);
}
var PREFERRED_PORT = parseInt(process.env.PORT ?? "0", 10);
var app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
});
app.use((req, _res, next) => {
  if (req.path.startsWith("/api")) {
    const start = Date.now();
    _res.on("finish", () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} ${_res.statusCode} ${duration}ms`);
    });
  }
  next();
});
function fetchGitHubRepos(token) {
  return new Promise((resolve2) => {
    const req = https3.request({
      hostname: "api.github.com",
      path: "/user/repos?per_page=100&sort=updated&affiliation=owner",
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "agenthub-local/1.0.0",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            resolve2(JSON.parse(data));
          } catch {
            resolve2([]);
          }
        } else {
          resolve2([]);
        }
      });
    });
    req.on("error", () => resolve2([]));
    req.setTimeout(1e4, () => {
      req.destroy();
      resolve2([]);
    });
    req.end();
  });
}
app.get("/api/projects/local-scan", async (_req, res) => {
  try {
    const homePath = homedir3();
    const scanDirs = [
      join5(homePath, "Projects")
    ].filter((d) => existsSync6(d));
    const allRepos = [];
    const existingPaths = new Set(
      db.select({ path: schema.projects.path }).from(schema.projects).all().map((p) => p.path)
    );
    const existingUrls = new Set(
      db.select({ url: schema.projects.githubUrl }).from(schema.projects).all().map((p) => p.url).filter(Boolean)
    );
    for (const dir of scanDirs) {
      try {
        const found = scanWorkspace(dir);
        for (const p of found) {
          allRepos.push({
            full_name: `local/${p.name}`,
            name: p.name,
            description: `${p.stack.join(", ")} \u2014 ${p.path}`,
            html_url: p.path,
            clone_url: p.path,
            private: false,
            language: p.stack[0] ?? null,
            updated_at: (/* @__PURE__ */ new Date()).toISOString(),
            alreadyImported: existingPaths.has(p.path),
            stargazers_count: 0,
            owner: { login: "local" }
          });
        }
      } catch {
      }
    }
    const ghIntegration = db.select().from(schema.integrations).where(eq7(schema.integrations.type, "github")).get();
    const ghToken = ghIntegration?.config ? JSON.parse(ghIntegration.config).token : null;
    if (ghToken) {
      const ghRepos = await fetchGitHubRepos(ghToken);
      for (const r of ghRepos) {
        allRepos.push({
          id: r.full_name,
          full_name: r.full_name,
          name: r.name,
          description: r.description,
          html_url: r.html_url,
          clone_url: r.clone_url,
          private: r.private,
          language: r.language,
          updated_at: r.updated_at,
          stargazers_count: r.stargazers_count,
          owner: r.owner,
          alreadyImported: existingUrls.has(r.html_url)
        });
      }
    }
    res.json({ repos: allRepos });
  } catch {
    res.json({ repos: [] });
  }
});
app.post("/api/projects/import", (req, res) => {
  const { repo, cloneUrl, htmlUrl, description } = req.body;
  const localPath = cloneUrl || htmlUrl;
  const name = repo || (localPath ? localPath.split(/[/\\]/).pop() : "unknown");
  if (!localPath) {
    return res.status(400).json({ error: "path is required" });
  }
  const existing = db.select().from(schema.projects).where(eq7(schema.projects.path, localPath)).get();
  if (existing) {
    return res.status(409).json({ error: "errorDuplicate" });
  }
  let stack = [];
  try {
    const parentDir = join5(localPath, "..");
    if (existsSync6(parentDir)) {
      const found = scanWorkspace(parentDir);
      const match = found.find((p) => p.path === localPath);
      if (match) stack = match.stack;
    }
  } catch {
  }
  const now = Date.now();
  const project = {
    id: nanoid7(),
    name,
    path: localPath,
    stack: JSON.stringify(stack),
    description: description ?? null,
    githubUrl: null,
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  db.insert(schema.projects).values(project).run();
  res.status(201).json({ project });
});
function createGitHubRepo(token, name, description, isPrivate) {
  return new Promise((resolve2) => {
    const body = JSON.stringify({ name, description, private: isPrivate, auto_init: false });
    const req = https3.request({
      hostname: "api.github.com",
      path: "/user/repos",
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "agenthub-local/1.0.0",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        try {
          resolve2({ status: res.statusCode ?? 500, data: JSON.parse(data) });
        } catch {
          resolve2({ status: res.statusCode ?? 500, data: null });
        }
      });
    });
    req.on("error", () => resolve2({ status: 500, data: null }));
    req.setTimeout(15e3, () => {
      req.destroy();
      resolve2({ status: 408, data: null });
    });
    req.write(body);
    req.end();
  });
}
app.post("/api/projects/create", async (req, res) => {
  const { name, description, isPrivate, stack, createOnGithub } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ error: "errorNameRequired" });
  }
  const projectsDir = join5(homedir3(), "Projects");
  mkdirSync2(projectsDir, { recursive: true });
  const dirName = name.trim().replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  const projectPath = join5(projectsDir, dirName);
  if (existsSync6(projectPath)) {
    return res.status(409).json({ error: "errorDuplicate" });
  }
  const ghIntegration = db.select().from(schema.integrations).where(eq7(schema.integrations.type, "github")).get();
  const ghToken = ghIntegration?.config ? JSON.parse(ghIntegration.config).token : null;
  let githubUrl = null;
  let cloneUrl = null;
  if (createOnGithub && ghToken) {
    const ghResult = await createGitHubRepo(ghToken, dirName, description?.trim() || "", isPrivate ?? true);
    if (ghResult.status === 201 && ghResult.data) {
      githubUrl = ghResult.data.html_url;
      cloneUrl = ghResult.data.clone_url;
    }
  }
  if (cloneUrl) {
    try {
      execFileSync3("git", ["clone", cloneUrl, projectPath], { timeout: 6e4 });
    } catch {
      cloneUrl = null;
    }
  }
  if (!cloneUrl) {
    mkdirSync2(projectPath, { recursive: true });
    writeFileSync2(join5(projectPath, "package.json"), JSON.stringify({
      name: dirName,
      version: "1.0.0",
      description: description?.trim() || "",
      private: isPrivate ?? true,
      scripts: { dev: "echo 'Configure your dev script'", build: "echo 'Configure your build script'" }
    }, null, 2));
    writeFileSync2(join5(projectPath, "README.md"), `# ${name.trim()}

${description?.trim() || ""}
`);
    try {
      execFileSync3("git", ["init"], { cwd: projectPath, timeout: 5e3 });
      execFileSync3("git", ["add", "."], { cwd: projectPath, timeout: 5e3 });
      execFileSync3("git", ["commit", "-m", "Initial commit"], { cwd: projectPath, timeout: 5e3 });
      if (githubUrl && cloneUrl === null) {
        const remoteUrl = githubUrl.replace("https://github.com/", "https://github.com/") + ".git";
        try {
          execFileSync3("git", ["remote", "add", "origin", remoteUrl], { cwd: projectPath, timeout: 5e3 });
        } catch {
        }
      }
    } catch {
    }
  } else {
    if (!existsSync6(join5(projectPath, "package.json"))) {
      writeFileSync2(join5(projectPath, "package.json"), JSON.stringify({
        name: dirName,
        version: "1.0.0",
        description: description?.trim() || "",
        private: isPrivate ?? true,
        scripts: { dev: "echo 'Configure your dev script'", build: "echo 'Configure your build script'" }
      }, null, 2));
      writeFileSync2(join5(projectPath, "README.md"), `# ${name.trim()}

${description?.trim() || ""}
`);
      try {
        execFileSync3("git", ["add", "."], { cwd: projectPath, timeout: 5e3 });
        execFileSync3("git", ["commit", "-m", "Initial commit"], { cwd: projectPath, timeout: 5e3 });
        execFileSync3("git", ["push", "-u", "origin", "main"], { cwd: projectPath, timeout: 3e4 });
      } catch {
      }
    }
  }
  const now = Date.now();
  const project = {
    id: nanoid7(),
    name: name.trim(),
    path: projectPath,
    stack: JSON.stringify(Array.isArray(stack) && stack.length > 0 ? stack : ["nodejs"]),
    description: description?.trim() || null,
    githubUrl,
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  db.insert(schema.projects).values(project).run();
  res.status(201).json({ project });
});
app.get("/api/projects/:id/git/status", (req, res) => {
  const project = db.select().from(schema.projects).where(eq7(schema.projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: "not found" });
  const isGitRepo = existsSync6(join5(project.path, ".git"));
  if (!isGitRepo) return res.json({ isGitRepo: false, status: null, lastCommit: null, remoteStatus: null });
  try {
    const branch = execFileSync3("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: project.path, timeout: 5e3 }).toString().trim();
    const statusOut = execFileSync3("git", ["status", "--porcelain"], { cwd: project.path, timeout: 5e3 }).toString();
    const lines = statusOut.split("\n").filter(Boolean);
    const staged = lines.filter((l) => /^[MADRC]/.test(l)).map((l) => l.slice(3));
    const unstaged = lines.filter((l) => /^.[MADRC]/.test(l)).map((l) => l.slice(3));
    const untracked = lines.filter((l) => l.startsWith("??")).map((l) => l.slice(3));
    let lastCommit = null;
    try {
      const log = execFileSync3("git", ["log", "-1", "--format=%H%n%s%n%an%n%aI"], { cwd: project.path, timeout: 5e3 }).toString().trim().split("\n");
      lastCommit = { sha: log[0], message: log[1], author: log[2], date: log[3] };
    } catch {
    }
    let remoteStatus = null;
    let ahead = 0, behind = 0;
    try {
      const remoteUrl = execFileSync3("git", ["config", "--get", "remote.origin.url"], { cwd: project.path, timeout: 5e3 }).toString().trim();
      const counts = execFileSync3("git", ["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`], { cwd: project.path, timeout: 5e3 }).toString().trim().split("	");
      ahead = parseInt(counts[0]) || 0;
      behind = parseInt(counts[1]) || 0;
      remoteStatus = { remoteUrl, ahead, behind };
    } catch {
    }
    res.json({ isGitRepo: true, status: { branch, staged, unstaged, untracked, ahead, behind }, lastCommit, remoteStatus });
  } catch {
    res.json({ isGitRepo: true, status: { branch: "unknown", staged: [], unstaged: [], untracked: [], ahead: 0, behind: 0 }, lastCommit: null, remoteStatus: null });
  }
});
app.get("/api/projects/:id/git/config", (req, res) => {
  const project = db.select().from(schema.projects).where(eq7(schema.projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: "not found" });
  let remoteUrl = "";
  let defaultBranch = "main";
  try {
    remoteUrl = execFileSync3("git", ["config", "--get", "remote.origin.url"], { cwd: project.path, timeout: 5e3 }).toString().trim();
  } catch {
  }
  try {
    defaultBranch = execFileSync3("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: project.path, timeout: 5e3 }).toString().trim();
  } catch {
  }
  res.json({ remoteUrl, defaultBranch });
});
app.put("/api/projects/:id/git/config", (req, res) => {
  const project = db.select().from(schema.projects).where(eq7(schema.projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: "not found" });
  const { remoteUrl } = req.body;
  try {
    if (remoteUrl) {
      try {
        execFileSync3("git", ["remote", "add", "origin", remoteUrl], { cwd: project.path, timeout: 5e3 });
      } catch {
        execFileSync3("git", ["remote", "set-url", "origin", remoteUrl], { cwd: project.path, timeout: 5e3 });
      }
    }
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "failed to update config" });
  }
});
app.post("/api/projects/:id/git/init", (req, res) => {
  const project = db.select().from(schema.projects).where(eq7(schema.projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: "not found" });
  try {
    execFileSync3("git", ["init"], { cwd: project.path, timeout: 5e3 });
    execFileSync3("git", ["add", "."], { cwd: project.path, timeout: 5e3 });
    execFileSync3("git", ["commit", "-m", "Initial commit"], { cwd: project.path, timeout: 5e3 });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "failed to init repo" });
  }
});
app.post("/api/projects/:id/git/sync", (req, res) => {
  const project = db.select().from(schema.projects).where(eq7(schema.projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: "not found" });
  try {
    execFileSync3("git", ["pull", "--rebase"], { cwd: project.path, timeout: 6e4 });
    execFileSync3("git", ["push"], { cwd: project.path, timeout: 6e4 });
    res.json({ success: true, conflicts: false });
  } catch {
    res.json({ success: false, conflicts: true });
  }
});
app.post("/api/tasks/:id/execute", async (req, res) => {
  const task = db.select().from(schema.tasks).where(eq7(schema.tasks.id, req.params.id)).get();
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (task.status !== "assigned") {
    return res.status(400).json({
      error: `Task must be in 'assigned' status to execute (current: ${task.status})`
    });
  }
  const socketIo = req.app.get("io");
  res.json({ status: "executing", taskId: task.id });
  import("./task-executor-KODM5MPB.js").then(({ executeTask }) => {
    executeTask(task.id, socketIo).catch((err) => {
      console.error(`[TaskExecutor] Failed: ${err.message}`);
      db.update(schema.tasks).set({
        status: "failed",
        result: err.message,
        updatedAt: Date.now()
      }).where(eq7(schema.tasks.id, task.id)).run();
      if (socketIo) socketIo.emit("task:status", { taskId: task.id, status: "failed" });
    });
  }).catch(() => {
    console.error("[TaskExecutor] Module not found \u2014 task-executor.ts not compiled");
  });
});
app.use("/api/projects", projects_default);
app.use("/api/tasks", tasks_default);
app.use("/api/agents", agents_default);
app.use("/api", files_default);
app.use("/api", integrations_default);
app.get("/api/health", (_req, res) => {
  const hasToken = getClaudeToken() !== null;
  res.json({
    status: "ok",
    version: "1.0.0",
    claudeToken: hasToken ? "found" : "not_found",
    uptime: process.uptime()
  });
});
app.post("/api/auth/claude-login", async (_req, res) => {
  try {
    const cp = await import("child_process");
    cp.execFile("claude", ["login"], { timeout: 12e4 }, (err) => {
      if (!err) {
        const socketIo = _req.app.get("io");
        if (socketIo) socketIo.emit("auth:refreshed", { message: "Login successful" });
      }
    });
    res.json({ status: "login_started", message: "Claude login opened in browser" });
  } catch {
    res.status(500).json({ error: "failed to start login" });
  }
});
app.get("/api/auth/me", (_req, res) => {
  res.json({ id: "local", login: "local", name: "Local User", email: null, role: "admin", avatarUrl: null, githubId: 0 });
});
app.get("/api/dashboard/stats", (_req, res) => {
  try {
    const totalProjects = db.select({ value: count() }).from(schema.projects).all()[0]?.value ?? 0;
    const activeAgents = db.select({ value: count() }).from(schema.agents).where(eq7(schema.agents.isActive, 1)).all()[0]?.value ?? 0;
    const totalTasks = db.select({ value: count() }).from(schema.tasks).all()[0]?.value ?? 0;
    const runningTasks = db.select({ value: count() }).from(schema.tasks).where(eq7(schema.tasks.status, "in_progress")).all()[0]?.value ?? 0;
    const reviewTasks = db.select({ value: count() }).from(schema.tasks).where(eq7(schema.tasks.status, "review")).all()[0]?.value ?? 0;
    const doneTasks = db.select({ value: count() }).from(schema.tasks).where(eq7(schema.tasks.status, "done")).all()[0]?.value ?? 0;
    const allProjects = db.select({ id: schema.projects.id }).from(schema.projects).all();
    const activeAgentsList = db.select({
      id: schema.agents.id,
      name: schema.agents.name,
      avatar: schema.agents.avatar,
      color: schema.agents.color
    }).from(schema.agents).where(eq7(schema.agents.isActive, 1)).all();
    const projectStats = allProjects.map((p) => {
      const taskCount = db.select({ value: count() }).from(schema.tasks).where(eq7(schema.tasks.projectId, p.id)).all()[0]?.value ?? 0;
      return {
        projectId: p.id,
        taskCount,
        agentCount: activeAgentsList.length,
        agents: activeAgentsList
      };
    });
    res.json({
      totalProjects,
      activeAgents,
      totalTasks,
      runningTasks,
      reviewTasks,
      doneTasks,
      weeklyCreated: 0,
      weeklyCompleted: 0,
      weeklyFailed: 0,
      projectStats,
      recentCompletedTasks: [],
      activityPage: 0,
      activityPageSize: 10,
      activityTotalCount: 0,
      activityTotalPages: 0,
      recentActivities: []
    });
  } catch {
    res.json({
      totalProjects: 0,
      activeAgents: 0,
      totalTasks: 0,
      runningTasks: 0,
      reviewTasks: 0,
      doneTasks: 0,
      weeklyCreated: 0,
      weeklyCompleted: 0,
      weeklyFailed: 0,
      projectStats: [],
      recentCompletedTasks: [],
      activityPage: 0,
      activityPageSize: 10,
      activityTotalCount: 0,
      activityTotalPages: 0,
      recentActivities: []
    });
  }
});
app.get("/api/plans/my-usage", (_req, res) => {
  res.json({ plan: null, usage: { projects: 0, tasksThisMonth: 0 } });
});
app.post("/api/admin/factory-reset", (_req, res) => {
  try {
    const safeDir = join5(homedir3(), "Projects");
    const allProjects = db.select().from(schema.projects).all();
    for (const p of allProjects) {
      if (p.path && p.path.startsWith(safeDir) && existsSync6(p.path)) {
        try {
          rmSync2(p.path, { recursive: true, force: true });
        } catch {
        }
      }
    }
    db.delete(schema.taskLogs).run();
    db.delete(schema.messages).run();
    db.delete(schema.tasks).run();
    db.delete(schema.projects).run();
    db.delete(schema.docs).run();
    db.delete(schema.agentMemories).run();
    db.delete(schema.integrations).run();
    res.json({ success: true, message: "All data and project files cleared. Agents preserved." });
  } catch (err) {
    res.status(500).json({ error: "Reset failed" });
  }
});
app.get("/api/storage/usage", (_req, res) => {
  res.json({ usage: { usedMb: 0, limitMb: 0, usedPercent: 0, projectCount: 0, maxProjects: -1, repoTtlDays: 0 } });
});
app.get("/api/admin/setup-status", (_req, res) => {
  res.json({ isSetupComplete: true, steps: { hasAdmin: true, hasApiKey: true, hasPlans: true } });
});
app.get("/api/settings/language", (_req, res) => {
  const setting = db.select().from(schema.integrations).where(eq7(schema.integrations.type, "user_language")).get();
  res.json({ language: setting?.config ?? "pt-BR" });
});
app.put("/api/settings/language", (req, res) => {
  const { language } = req.body;
  if (!language) return res.status(400).json({ error: "language required" });
  const existing = db.select().from(schema.integrations).where(eq7(schema.integrations.type, "user_language")).get();
  const now = Date.now();
  if (existing) {
    db.update(schema.integrations).set({ config: language, updatedAt: now }).where(eq7(schema.integrations.id, existing.id)).run();
  } else {
    db.insert(schema.integrations).values({
      id: nanoid7(),
      type: "user_language",
      status: "active",
      config: language,
      createdAt: now,
      updatedAt: now
    }).run();
  }
  res.json({ language });
});
app.get("/api/notifications/unread-count", (_req, res) => {
  res.json({ count: 0 });
});
app.get("/api/notifications", (_req, res) => {
  res.json({ notifications: [] });
});
app.get("/api/teams", (_req, res) => {
  res.json({ teams: [] });
});
app.post("/api/auth/refresh", (_req, res) => {
  res.json({ ok: true });
});
app.get("/api/plans", (_req, res) => {
  res.json({ plans: [] });
});
app.get("/api/analytics/agents", (_req, res) => {
  res.json({ metrics: [] });
});
app.get("/api/analytics/trends", (_req, res) => {
  res.json({ trends: [] });
});
app.get("/api/analytics/summary", (_req, res) => {
  res.json({ totalCostUsd: 0, totalTokens: 0, completedTasks: 0, failedTasks: 0, costBreakdown: [] });
});
app.get("/api/analytics/costs", (_req, res) => {
  res.json([]);
});
app.get("/api/docs", (_req, res) => {
  const allDocs = db.select().from(schema.docs).all();
  res.json({ docs: allDocs });
});
app.get("/api/docs/:docId", (req, res) => {
  const doc = db.select().from(schema.docs).where(eq7(schema.docs.id, req.params.docId)).get();
  if (!doc) return res.status(404).json({ error: "not found" });
  res.json({ doc });
});
app.post("/api/docs", (req, res) => {
  const now = Date.now();
  const doc = {
    id: nanoid7(),
    title: req.body.title || "Untitled",
    content: req.body.content || "",
    category: req.body.category || null,
    pinned: 0,
    parentId: req.body.parentId || null,
    order: 0,
    createdAt: now,
    updatedAt: now
  };
  db.insert(schema.docs).values(doc).run();
  res.status(201).json({ doc });
});
app.patch("/api/docs/:docId", (req, res) => {
  const existing = db.select().from(schema.docs).where(eq7(schema.docs.id, req.params.docId)).get();
  if (!existing) return res.status(404).json({ error: "not found" });
  const updates = { updatedAt: Date.now() };
  if (req.body.title !== void 0) updates.title = req.body.title;
  if (req.body.content !== void 0) updates.content = req.body.content;
  if (req.body.category !== void 0) updates.category = req.body.category;
  if (req.body.pinned !== void 0) updates.pinned = req.body.pinned ? 1 : 0;
  if (req.body.parentId !== void 0) updates.parentId = req.body.parentId;
  if (req.body.order !== void 0) updates.order = req.body.order;
  db.update(schema.docs).set(updates).where(eq7(schema.docs.id, req.params.docId)).run();
  const doc = db.select().from(schema.docs).where(eq7(schema.docs.id, req.params.docId)).get();
  res.json({ doc });
});
app.put("/api/docs/:docId", (req, res) => {
  const existing = db.select().from(schema.docs).where(eq7(schema.docs.id, req.params.docId)).get();
  if (!existing) return res.status(404).json({ error: "not found" });
  const updates = { updatedAt: Date.now() };
  if (req.body.title !== void 0) updates.title = req.body.title;
  if (req.body.content !== void 0) updates.content = req.body.content;
  if (req.body.category !== void 0) updates.category = req.body.category;
  if (req.body.pinned !== void 0) updates.pinned = req.body.pinned ? 1 : 0;
  db.update(schema.docs).set(updates).where(eq7(schema.docs.id, req.params.docId)).run();
  const doc = db.select().from(schema.docs).where(eq7(schema.docs.id, req.params.docId)).get();
  res.json({ doc });
});
app.delete("/api/docs/:docId", (req, res) => {
  db.delete(schema.docs).where(eq7(schema.docs.id, req.params.docId)).run();
  res.json({ success: true });
});
var generateApiEndpoints = () => {
  const endpoints = [];
  const routeDescriptions = {
    "GET /api/health": { desc: "Server health check and Claude token status", group: "System" },
    "GET /api/auth/me": { desc: "Current authenticated user info", group: "Auth" },
    "POST /api/auth/refresh": { desc: "Refresh authentication token", group: "Auth" },
    "GET /api/dashboard/stats": { desc: "Aggregated dashboard statistics with per-project stats", group: "Dashboard" },
    "GET /api/plans/my-usage": { desc: "Current plan usage limits", group: "Plans" },
    "GET /api/plans/models": { desc: "Available AI models", group: "Plans" },
    "GET /api/plans": { desc: "Available subscription plans", group: "Plans" },
    "GET /api/projects/local-scan": { desc: "Scan local directories for importable projects", group: "Projects" },
    "POST /api/projects/import": { desc: "Import an existing local project", group: "Projects", params: [
      { name: "cloneUrl", in: "body", type: "string", required: true },
      { name: "description", in: "body", type: "string", required: false }
    ] },
    "POST /api/projects/create": { desc: "Create a new project with scaffolding and git init", group: "Projects", params: [
      { name: "name", in: "body", type: "string", required: true },
      { name: "description", in: "body", type: "string", required: false },
      { name: "stack", in: "body", type: "string[]", required: false },
      { name: "isPrivate", in: "body", type: "boolean", required: false }
    ] },
    "GET /api/projects": { desc: "List all projects", group: "Projects" },
    "GET /api/projects/:id": { desc: "Get project details", group: "Projects", params: [
      { name: "id", in: "path", type: "string", required: true }
    ] },
    "DELETE /api/projects/:id": { desc: "Delete project and remove files from disk", group: "Projects", params: [
      { name: "id", in: "path", type: "string", required: true }
    ] },
    "GET /api/projects/:id/git/status": { desc: "Git status: branch, staged/unstaged files, last commit, remote", group: "Git" },
    "GET /api/projects/:id/git/config": { desc: "Git remote URL and default branch", group: "Git" },
    "PUT /api/projects/:id/git/config": { desc: "Update git remote URL", group: "Git" },
    "POST /api/projects/:id/git/init": { desc: "Initialize git repository in project", group: "Git" },
    "POST /api/projects/:id/git/sync": { desc: "Pull rebase and push to remote", group: "Git" },
    "GET /api/projects/:id/files": { desc: "File tree for project", group: "Files" },
    "GET /api/projects/:id/files/content": { desc: "Read file content (path traversal protected)", group: "Files", params: [
      { name: "path", in: "query", type: "string", required: true }
    ] },
    "GET /api/tasks": { desc: "List tasks with optional filters", group: "Tasks", params: [
      { name: "projectId", in: "query", type: "string", required: false },
      { name: "status", in: "query", type: "string", required: false }
    ] },
    "POST /api/tasks": { desc: "Create a new task", group: "Tasks", params: [
      { name: "projectId", in: "body", type: "string", required: true },
      { name: "title", in: "body", type: "string", required: true },
      { name: "description", in: "body", type: "string", required: false },
      { name: "priority", in: "body", type: "string", required: false }
    ] },
    "PATCH /api/tasks/:id": { desc: "Update task fields or advance status", group: "Tasks" },
    "DELETE /api/tasks/:id": { desc: "Delete a task", group: "Tasks" },
    "GET /api/tasks/:id/logs": { desc: "Task audit log entries", group: "Tasks" },
    "POST /api/tasks/:id/execute": { desc: "Execute task with assigned agent (triggers agentic loop)", group: "Tasks" },
    "GET /api/agents": { desc: "List all agents", group: "Agents" },
    "POST /api/agents": { desc: "Create a new agent", group: "Agents" },
    "PATCH /api/agents/:id": { desc: "Update agent configuration", group: "Agents" },
    "DELETE /api/agents/:id": { desc: "Delete an agent", group: "Agents" },
    "GET /api/docs": { desc: "List all documents", group: "Docs" },
    "POST /api/docs": { desc: "Create a new document", group: "Docs" },
    "PATCH /api/docs/:docId": { desc: "Update document content/metadata", group: "Docs" },
    "DELETE /api/docs/:docId": { desc: "Delete a document", group: "Docs" },
    "GET /api/docs-gen/api": { desc: "Generated API documentation endpoints", group: "Docs" },
    "POST /api/docs-gen/generate-api": { desc: "Regenerate API documentation", group: "Docs" },
    "GET /api/analytics/agents": { desc: "Agent performance metrics", group: "Analytics" },
    "GET /api/analytics/trends": { desc: "Task completion trends over time", group: "Analytics" },
    "GET /api/analytics/summary": { desc: "Cost and token usage summary", group: "Analytics" },
    "GET /api/analytics/costs": { desc: "Cost breakdown by agent/model/day", group: "Analytics", params: [
      { name: "period", in: "query", type: "string", required: false },
      { name: "groupBy", in: "query", type: "string", required: false }
    ] },
    "GET /api/integrations/whatsapp/status": { desc: "WhatsApp connection status", group: "Integrations" },
    "POST /api/integrations/whatsapp/connect": { desc: "Start WhatsApp connection (generates QR)", group: "Integrations" },
    "POST /api/integrations/whatsapp/disconnect": { desc: "Disconnect WhatsApp", group: "Integrations" },
    "GET /api/integrations/telegram/status": { desc: "Telegram bot connection status", group: "Integrations" },
    "POST /api/integrations/telegram/connect": { desc: "Connect Telegram bot", group: "Integrations" },
    "POST /api/integrations/telegram/disconnect": { desc: "Disconnect Telegram bot", group: "Integrations" },
    "GET /api/claude-usage": { desc: "Claude Code CLI token usage data", group: "System" },
    "GET /api/notifications": { desc: "List notifications", group: "System" },
    "GET /api/notifications/unread-count": { desc: "Unread notification count", group: "System" },
    "GET /api/messages": { desc: "List chat messages", group: "Messages" },
    "GET /api/skills": { desc: "List custom skills", group: "Skills" },
    "GET /api/workflows": { desc: "List workflows", group: "Workflows" }
  };
  for (const [key, info] of Object.entries(routeDescriptions)) {
    const [method, path] = key.split(" ");
    endpoints.push({ method, path, description: info.desc, group: info.group, params: info.params || [] });
  }
  return endpoints;
};
app.get("/api/docs-gen/api", (_req, res) => {
  res.json({ endpoints: generateApiEndpoints() });
});
app.post("/api/docs-gen/generate-api", (_req, res) => {
  res.json({ endpoints: generateApiEndpoints() });
});
app.get("/api/messages", (req, res) => {
  const { taskId } = req.query;
  if (taskId && typeof taskId === "string") {
    const msgs = db.select().from(schema.messages).where(eq7(schema.messages.taskId, taskId)).all();
    return res.json({ messages: msgs });
  }
  res.json({ messages: [] });
});
app.get("/api/workflows", (_req, res) => {
  res.json({ workflows: [] });
});
app.get("/api/skills", (_req, res) => {
  res.json({ skills: [] });
});
app.get("/api/agents/:id/skills", (_req, res) => {
  res.json({ skills: [] });
});
app.get("/api/agents/:id/context", (req, res) => {
  const agent = db.select().from(schema.agents).where(eq7(schema.agents.id, req.params.id)).get();
  if (!agent) return res.status(404).json({ error: "not found" });
  const memories = db.select().from(schema.agentMemories).where(eq7(schema.agentMemories.agentId, req.params.id)).all();
  let memoriesBlock = "";
  if (memories.length > 0) {
    const memoryLines = memories.map(
      (m) => `- [${m.type}] ${m.content}${m.source ? ` (source: ${m.source})` : ""}`
    ).join("\n");
    memoriesBlock = `

## Your Memories
These are learnings you've accumulated from previous tasks. Use them to inform your decisions:
${memoryLines}`;
  }
  const memoryInstructions = `

## Memory System
You have a persistent memory system. After completing a task, save important learnings by calling:
POST /api/agents/${agent.id}/memories
Body: { "content": "<what you learned>", "type": "learning|correction|pattern|context", "source": "<task description>", "taskId": "<current task id>" }

Types:
- learning: new knowledge gained
- correction: mistake you made and the fix
- pattern: recurring code/architecture pattern
- context: project-specific context worth remembering`;
  const fullSystemPrompt = agent.systemPrompt + memoriesBlock + memoryInstructions;
  res.json({
    agent: {
      ...agent,
      systemPrompt: fullSystemPrompt
    },
    memories,
    memoriesCount: memories.length
  });
});
app.get("/api/agents/:id/memories", (req, res) => {
  const memories = db.select().from(schema.agentMemories).where(eq7(schema.agentMemories.agentId, req.params.id)).all();
  res.json({ memories });
});
app.post("/api/agents/:id/memories", (req, res) => {
  const memory = {
    id: nanoid7(),
    agentId: req.params.id,
    taskId: req.body.taskId || null,
    type: req.body.type || "learning",
    content: req.body.content,
    source: req.body.source || null,
    createdAt: Date.now()
  };
  db.insert(schema.agentMemories).values(memory).run();
  res.status(201).json({ memory });
});
app.delete("/api/agents/:id/memories/:memoryId", (req, res) => {
  db.delete(schema.agentMemories).where(eq7(schema.agentMemories.id, req.params.memoryId)).run();
  res.json({ success: true });
});
var _usageCache = null;
var USAGE_CACHE_TTL = 6e4;
var USAGE_CACHE_FILE = join5(homedir3(), ".claude", ".usage-cache.json");
try {
  if (existsSync6(USAGE_CACHE_FILE)) {
    const raw = JSON.parse(readFileSync4(USAGE_CACHE_FILE, "utf-8"));
    if (raw.usage) _usageCache = { usage: raw.usage, ts: raw.ts || 0 };
  }
} catch {
}
app.get("/api/claude-usage", async (_req, res) => {
  try {
    if (_usageCache && Date.now() - _usageCache.ts < USAGE_CACHE_TTL) {
      return res.json({ error: null, usage: _usageCache.usage, cached: true });
    }
    try {
      if (existsSync6(USAGE_CACHE_FILE)) {
        const diskRaw = JSON.parse(readFileSync4(USAGE_CACHE_FILE, "utf-8"));
        if (diskRaw.usage && diskRaw.ts && Date.now() - diskRaw.ts < USAGE_CACHE_TTL) {
          _usageCache = { usage: diskRaw.usage, ts: diskRaw.ts };
          return res.json({ error: null, usage: diskRaw.usage, cached: true });
        }
      }
    } catch {
    }
    const token = getClaudeToken();
    if (!token) {
      return res.json({ error: "no_token", usage: null });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5e3);
    const apiRes = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "agenthub-local/1.0.0"
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!apiRes.ok) {
      if (apiRes.status === 401) {
        const socketIo = _req.app.get("io");
        if (socketIo) {
          socketIo.emit("agent:notification", {
            id: `auth_expired_${Date.now()}`,
            projectId: null,
            type: "agent_error",
            title: "Token Claude expirado",
            body: "Execute /login no Claude Code para renovar o token.",
            link: null,
            createdAt: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
        import("child_process").then((cp) => {
          cp.execFile("claude", ["login"], { timeout: 12e4 }, (err) => {
            if (!err && socketIo) {
              socketIo.emit("agent:notification", {
                id: `auth_refreshed_${Date.now()}`,
                projectId: null,
                type: "info",
                title: "Token renovado",
                body: "Login no Claude realizado com sucesso.",
                link: null,
                createdAt: (/* @__PURE__ */ new Date()).toISOString()
              });
            }
          });
        }).catch(() => {
        });
      }
      if (_usageCache) {
        return res.json({ error: null, usage: _usageCache.usage, cached: true });
      }
      return res.json({ error: `api_error_${apiRes.status}`, usage: null });
    }
    const usage = await apiRes.json();
    _usageCache = { usage, ts: Date.now() };
    res.json({ error: null, usage });
  } catch (err) {
    if (_usageCache) {
      return res.json({ error: null, usage: _usageCache.usage, cached: true });
    }
    res.json({ error: "fetch_failed", usage: null });
  }
});
app.get("/api/plans/models", (_req, res) => {
  res.json({ models: [
    { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", provider: "anthropic" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" }
  ] });
});
var __dirname = dirname(fileURLToPath(import.meta.url));
var webDist = join5(__dirname, "../web/dist");
app.use(express.static(webDist));
app.get("{*path}", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) return next();
  res.sendFile(join5(webDist, "index.html"), (err) => {
    if (err) next();
  });
});
var httpServer = createServer(app);
var io = new SocketServer(httpServer, {
  cors: { origin: true }
});
app.set("io", io);
io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});
seedAgents();
httpServer.listen(PREFERRED_PORT, () => {
  const addr = httpServer.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : PREFERRED_PORT;
  const portFile = join5(DATA_DIR, "port");
  writeFileSync2(portFile, String(actualPort));
  console.log(`
AgentHub Local running at http://localhost:${actualPort}`);
  console.log(`API: http://localhost:${actualPort}/api/health
`);
  if (!process.env.NO_OPEN) {
    open(`http://localhost:${actualPort}`).catch(() => {
    });
  }
  const whatsappIntegration = db.select().from(schema.integrations).where(eq7(schema.integrations.type, "whatsapp")).get();
  if (whatsappIntegration && whatsappIntegration.status !== "disconnected") {
    console.log("[WhatsApp] Previous session found \u2014 auto-reconnecting...");
    const config = whatsappIntegration.config ? JSON.parse(whatsappIntegration.config) : {};
    const whatsapp = getWhatsAppService();
    whatsapp.setIo(io);
    if (config.allowedNumber) whatsapp.setAllowedNumber(config.allowedNumber);
    whatsapp.onStatusChange((s) => {
      const current = db.select().from(schema.integrations).where(eq7(schema.integrations.type, "whatsapp")).get();
      if (current) {
        db.update(schema.integrations).set({ status: s, updatedAt: Date.now() }).where(eq7(schema.integrations.id, current.id)).run();
      }
      io.emit("integration:status", { type: "whatsapp", status: s });
    });
    whatsapp.connect().then(() => {
      console.log("[WhatsApp] Auto-reconnect successful");
    }).catch(() => {
      console.log("[WhatsApp] Auto-reconnect failed");
      const curr = db.select().from(schema.integrations).where(eq7(schema.integrations.type, "whatsapp")).get();
      if (curr) db.update(schema.integrations).set({ status: "disconnected", updatedAt: Date.now() }).where(eq7(schema.integrations.id, curr.id)).run();
      io.emit("integration:status", { type: "whatsapp", status: "disconnected" });
    });
  }
});
export {
  io
};
