import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import open from "open";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";
import https from "https";
import { homedir } from "os";
import { nanoid } from "nanoid";

import projectsRouter from "./routes/projects.js";
import tasksRouter from "./routes/tasks.js";
import agentsRouter from "./routes/agents.js";
import filesRouter from "./routes/files.js";
import integrationsRouter from "./routes/integrations.js";
import { seedAgents } from "./seed.js";
import { getWhatsAppService } from "./lib/whatsapp-service.js";
import { getClaudeToken } from "./lib/claude-token.js";
import { scanWorkspace } from "./lib/scanner.js";
import { db, schema, DATA_DIR } from "./db.js";
import { count, eq } from "drizzle-orm";

// Ensure default projects directory exists on first run
const DEFAULT_PROJECTS_DIR = join(homedir(), "Projects");
if (!existsSync(DEFAULT_PROJECTS_DIR)) {
  mkdirSync(DEFAULT_PROJECTS_DIR, { recursive: true });
  console.log(`Created default projects directory: ${DEFAULT_PROJECTS_DIR}`);
}

// Use port 0 to let the OS assign a random available port
const PREFERRED_PORT = parseInt(process.env.PORT ?? "0", 10);
const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

// Cross-Origin Isolation headers required by WebContainer
app.use((_req, res, next) => {
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
});

// Request logging
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

// Helper: fetch GitHub repos via API
function fetchGitHubRepos(token: string): Promise<unknown[]> {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.github.com",
      path: "/user/repos?per_page=100&sort=updated&affiliation=owner",
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "agenthub-local/1.0.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); } catch { resolve([]); }
        } else { resolve([]); }
      });
    });
    req.on("error", () => resolve([]));
    req.setTimeout(10000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

// Local scan + GitHub repos — must be before projectsRouter (which has /:id catch-all)
app.get("/api/projects/local-scan", async (_req, res) => {
  try {
    const homePath = homedir();
    const scanDirs = [
      join(homePath, "Projects"),
      join(homePath, "Desenvolvimento", "Projects"),
      join(homePath, "Development"),
      join(homePath, "dev"),
      join(homePath, "repos"),
      join(homePath, "workspace"),
      join(homePath, "code"),
    ].filter(d => existsSync(d));

    const allRepos: unknown[] = [];
    const existingPaths = new Set(
      db.select({ path: schema.projects.path }).from(schema.projects).all().map((p: { path: string }) => p.path)
    );
    const existingUrls = new Set(
      db.select({ url: schema.projects.githubUrl }).from(schema.projects).all()
        .map((p: { url: string | null }) => p.url).filter(Boolean)
    );

    // Local repos
    for (const dir of scanDirs) {
      try {
        const found = scanWorkspace(dir);
        for (const p of found) {
          allRepos.push({
            full_name: `local/${p.name}`,
            name: p.name,
            description: `${p.stack.join(", ")} — ${p.path}`,
            html_url: p.path,
            clone_url: p.path,
            private: false,
            language: p.stack[0] ?? null,
            updated_at: new Date().toISOString(),
            alreadyImported: existingPaths.has(p.path),
            stargazers_count: 0,
            owner: { login: "local" },
          });
        }
      } catch { /* skip */ }
    }

    // GitHub repos (if token configured)
    const ghIntegration = db.select().from(schema.integrations)
      .where(eq(schema.integrations.type, "github")).get();
    const ghToken = ghIntegration?.config ? JSON.parse(ghIntegration.config).token : null;

    if (ghToken) {
      const ghRepos = await fetchGitHubRepos(ghToken) as Array<{
        full_name: string; name: string; description: string | null;
        html_url: string; clone_url: string; private: boolean;
        language: string | null; updated_at: string; stargazers_count: number;
        owner: { login: string };
      }>;

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
          alreadyImported: existingUrls.has(r.html_url),
        });
      }
    }

    res.json({ repos: allRepos });
  } catch {
    res.json({ repos: [] });
  }
});

// Import project endpoint — must be before /:id route
app.post("/api/projects/import", (req, res) => {
  const { repo, cloneUrl, htmlUrl, description } = req.body;
  const localPath = cloneUrl || htmlUrl;
  const name = repo || (localPath ? localPath.split(/[/\\]/).pop() : "unknown");

  if (!localPath) {
    return res.status(400).json({ error: "path is required" });
  }

  const existing = db.select().from(schema.projects).where(eq(schema.projects.path, localPath)).get();
  if (existing) {
    return res.status(409).json({ error: "errorDuplicate" });
  }

  let stack: string[] = [];
  try {
    const parentDir = join(localPath, "..");
    if (existsSync(parentDir)) {
      const found = scanWorkspace(parentDir);
      const match = found.find((p: { path: string }) => p.path === localPath);
      if (match) stack = match.stack;
    }
  } catch { /* ignore */ }

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
    updatedAt: now,
  };

  db.insert(schema.projects).values(project).run();
  res.status(201).json({ project });
});

// Helper: create GitHub repo via API
function createGitHubRepo(token: string, name: string, description: string, isPrivate: boolean): Promise<{ status: number; data: Record<string, unknown> | null }> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ name, description, private: isPrivate, auto_init: false });
    const req = https.request({
      hostname: "api.github.com", path: "/user/repos", method: "POST",
      headers: {
        Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
        "User-Agent": "agenthub-local/1.0.0", "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk: string) => { data += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode ?? 500, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode ?? 500, data: null }); }
      });
    });
    req.on("error", () => resolve({ status: 500, data: null }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 408, data: null }); });
    req.write(body);
    req.end();
  });
}

// Create project — local + optional GitHub repo
app.post("/api/projects/create", async (req, res) => {
  const { name, description, isPrivate, stack, createOnGithub } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ error: "errorNameRequired" });
  }

  const projectsDir = join(homedir(), "Projects");
  mkdirSync(projectsDir, { recursive: true });

  const dirName = name.trim().replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  const projectPath = join(projectsDir, dirName);

  if (existsSync(projectPath)) {
    return res.status(409).json({ error: "errorDuplicate" });
  }

  // Check if GitHub is configured
  const ghIntegration = db.select().from(schema.integrations)
    .where(eq(schema.integrations.type, "github")).get();
  const ghToken = ghIntegration?.config ? JSON.parse(ghIntegration.config).token : null;

  let githubUrl: string | null = null;
  let cloneUrl: string | null = null;

  // Create GitHub repo only if user explicitly chose it AND token is available
  if (createOnGithub && ghToken) {
    const ghResult = await createGitHubRepo(ghToken, dirName, description?.trim() || "", isPrivate ?? true);
    if (ghResult.status === 201 && ghResult.data) {
      githubUrl = ghResult.data.html_url as string;
      cloneUrl = ghResult.data.clone_url as string;
    }
    // If GitHub creation fails (e.g. repo already exists), continue with local only
  }

  // Clone from GitHub or create locally
  if (cloneUrl) {
    try {
      execFileSync("git", ["clone", cloneUrl, projectPath], { timeout: 60000 });
    } catch {
      // Clone failed — fall back to local creation
      cloneUrl = null;
    }
  }

  if (!cloneUrl) {
    // Local creation (no GitHub or clone failed)
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(join(projectPath, "package.json"), JSON.stringify({
      name: dirName,
      version: "1.0.0",
      description: description?.trim() || "",
      private: isPrivate ?? true,
      scripts: { dev: "echo 'Configure your dev script'", build: "echo 'Configure your build script'" },
    }, null, 2));
    writeFileSync(join(projectPath, "README.md"), `# ${name.trim()}\n\n${description?.trim() || ""}\n`);

    // Git init
    try {
      execFileSync("git", ["init"], { cwd: projectPath, timeout: 5000 });
      execFileSync("git", ["add", "."], { cwd: projectPath, timeout: 5000 });
      execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: projectPath, timeout: 5000 });
      // Add remote if GitHub was created but clone failed
      if (githubUrl && cloneUrl === null) {
        const remoteUrl = githubUrl.replace("https://github.com/", "https://github.com/") + ".git";
        try { execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: projectPath, timeout: 5000 }); } catch { /* ignore */ }
      }
    } catch { /* optional */ }
  } else {
    // Cloned from GitHub — add template files if empty
    if (!existsSync(join(projectPath, "package.json"))) {
      writeFileSync(join(projectPath, "package.json"), JSON.stringify({
        name: dirName, version: "1.0.0", description: description?.trim() || "",
        private: isPrivate ?? true,
        scripts: { dev: "echo 'Configure your dev script'", build: "echo 'Configure your build script'" },
      }, null, 2));
      writeFileSync(join(projectPath, "README.md"), `# ${name.trim()}\n\n${description?.trim() || ""}\n`);
      try {
        execFileSync("git", ["add", "."], { cwd: projectPath, timeout: 5000 });
        execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: projectPath, timeout: 5000 });
        execFileSync("git", ["push", "-u", "origin", "main"], { cwd: projectPath, timeout: 30000 });
      } catch { /* best-effort */ }
    }
  }

  const now = Date.now();
  const project = {
    id: nanoid(),
    name: name.trim(),
    path: projectPath,
    stack: JSON.stringify(Array.isArray(stack) && stack.length > 0 ? stack : ["nodejs"]),
    description: description?.trim() || null,
    githubUrl,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  db.insert(schema.projects).values(project).run();
  res.status(201).json({ project });
});

// Git routes — before projectsRouter to avoid /:id catch-all
app.get("/api/projects/:id/git/status", (req, res) => {
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: "not found" });


  const isGitRepo = existsSync(join(project.path, ".git"));
  if (!isGitRepo) return res.json({ isGitRepo: false, status: null, lastCommit: null, remoteStatus: null });

  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: project.path, timeout: 5000 }).toString().trim();
    const statusOut = execFileSync("git", ["status", "--porcelain"], { cwd: project.path, timeout: 5000 }).toString();
    const lines = statusOut.split("\n").filter(Boolean);
    const staged = lines.filter((l: string) => /^[MADRC]/.test(l)).map((l: string) => l.slice(3));
    const unstaged = lines.filter((l: string) => /^.[MADRC]/.test(l)).map((l: string) => l.slice(3));
    const untracked = lines.filter((l: string) => l.startsWith("??")).map((l: string) => l.slice(3));

    let lastCommit = null;
    try {
      const log = execFileSync("git", ["log", "-1", "--format=%H%n%s%n%an%n%aI"], { cwd: project.path, timeout: 5000 }).toString().trim().split("\n");
      lastCommit = { sha: log[0], message: log[1], author: log[2], date: log[3] };
    } catch { /* no commits */ }

    let remoteStatus = null;
    let ahead = 0, behind = 0;
    try {
      const remoteUrl = execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: project.path, timeout: 5000 }).toString().trim();
      const counts = execFileSync("git", ["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`], { cwd: project.path, timeout: 5000 }).toString().trim().split("\t");
      ahead = parseInt(counts[0]) || 0;
      behind = parseInt(counts[1]) || 0;
      remoteStatus = { remoteUrl, ahead, behind };
    } catch { /* no remote */ }

    res.json({ isGitRepo: true, status: { branch, staged, unstaged, untracked, ahead, behind }, lastCommit, remoteStatus });
  } catch {
    res.json({ isGitRepo: true, status: { branch: "unknown", staged: [], unstaged: [], untracked: [], ahead: 0, behind: 0 }, lastCommit: null, remoteStatus: null });
  }
});

app.get("/api/projects/:id/git/config", (req, res) => {
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: "not found" });


  let remoteUrl = "";
  let defaultBranch = "main";
  try {
    remoteUrl = execFileSync("git", ["config", "--get", "remote.origin.url"], { cwd: project.path, timeout: 5000 }).toString().trim();
  } catch { /* no remote */ }
  try {
    defaultBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: project.path, timeout: 5000 }).toString().trim();
  } catch { /* ignore */ }
  res.json({ remoteUrl, defaultBranch });
});

app.put("/api/projects/:id/git/config", (req, res) => {
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: "not found" });

  const { remoteUrl } = req.body;

  try {
    if (remoteUrl) {
      try { execFileSync("git", ["remote", "add", "origin", remoteUrl], { cwd: project.path, timeout: 5000 }); } catch {
        execFileSync("git", ["remote", "set-url", "origin", remoteUrl], { cwd: project.path, timeout: 5000 });
      }
    }
    res.json({ success: true });
  } catch { res.status(500).json({ error: "failed to update config" }); }
});

app.post("/api/projects/:id/git/init", (req, res) => {
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: "not found" });


  try {
    execFileSync("git", ["init"], { cwd: project.path, timeout: 5000 });
    execFileSync("git", ["add", "."], { cwd: project.path, timeout: 5000 });
    execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: project.path, timeout: 5000 });
    res.json({ success: true });
  } catch { res.status(500).json({ error: "failed to init repo" }); }
});

app.post("/api/projects/:id/git/sync", (req, res) => {
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, req.params.id)).get();
  if (!project) return res.status(404).json({ error: "not found" });


  try {
    execFileSync("git", ["pull", "--rebase"], { cwd: project.path, timeout: 60000 });
    execFileSync("git", ["push"], { cwd: project.path, timeout: 60000 });
    res.json({ success: true, conflicts: false });
  } catch {
    res.json({ success: false, conflicts: true });
  }
});

// Task execution endpoint — triggers agent workflow
app.post("/api/tasks/:id/execute", async (req, res) => {
  const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, req.params.id)).get();
  if (!task) return res.status(404).json({ error: "Task not found" });

  if (task.status !== "assigned") {
    return res.status(400).json({
      error: `Task must be in 'assigned' status to execute (current: ${task.status})`,
    });
  }

  const socketIo = req.app.get("io");
  res.json({ status: "executing", taskId: task.id });

  // Execute async (non-blocking) — import dynamically to avoid issues before file exists
  import("./lib/task-executor.js").then(({ executeTask }) => {
    executeTask(task.id, socketIo).catch((err: Error) => {
      console.error(`[TaskExecutor] Failed: ${err.message}`);
      db.update(schema.tasks).set({
        status: "failed", result: err.message, updatedAt: Date.now(),
      }).where(eq(schema.tasks.id, task.id)).run();
      if (socketIo) socketIo.emit("task:status", { taskId: task.id, status: "failed" });
    });
  }).catch(() => {
    console.error("[TaskExecutor] Module not found — task-executor.ts not compiled");
  });
});

// API routes
app.use("/api/projects", projectsRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/agents", agentsRouter);
app.use("/api", filesRouter);
app.use("/api", integrationsRouter);

// Health check
app.get("/api/health", (_req, res) => {
  const hasToken = getClaudeToken() !== null;
  res.json({
    status: "ok",
    version: "1.0.0",
    claudeToken: hasToken ? "found" : "not_found",
    uptime: process.uptime(),
  });
});

// Claude login — opens browser-based OAuth flow
app.post("/api/auth/claude-login", async (_req, res) => {
  try {
    // claude login opens the browser for OAuth — non-blocking
    const cp = await import("child_process");
    cp.execFile("claude", ["login"], { timeout: 120000 }, (err) => {
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

// Fake auth endpoint for local mode
app.get("/api/auth/me", (_req, res) => {
  res.json({ id: "local", login: "local", name: "Local User", email: null, role: "admin", avatarUrl: null, githubId: 0 });
});

// Dashboard stats — all fields the frontend expects
app.get("/api/dashboard/stats", (_req, res) => {
  try {
    const totalProjects = db.select({ value: count() }).from(schema.projects).all()[0]?.value ?? 0;
    const activeAgents = db.select({ value: count() }).from(schema.agents).where(eq(schema.agents.isActive, 1)).all()[0]?.value ?? 0;
    const totalTasks = db.select({ value: count() }).from(schema.tasks).all()[0]?.value ?? 0;
    const runningTasks = db.select({ value: count() }).from(schema.tasks).where(eq(schema.tasks.status, "in_progress")).all()[0]?.value ?? 0;
    const reviewTasks = db.select({ value: count() }).from(schema.tasks).where(eq(schema.tasks.status, "review")).all()[0]?.value ?? 0;
    const doneTasks = db.select({ value: count() }).from(schema.tasks).where(eq(schema.tasks.status, "done")).all()[0]?.value ?? 0;

    // Build per-project stats
    const allProjects = db.select({ id: schema.projects.id }).from(schema.projects).all();
    const activeAgentsList = db.select({
      id: schema.agents.id,
      name: schema.agents.name,
      avatar: schema.agents.avatar,
      color: schema.agents.color,
    }).from(schema.agents).where(eq(schema.agents.isActive, 1)).all();

    const projectStats = allProjects.map((p) => {
      const taskCount = db.select({ value: count() }).from(schema.tasks)
        .where(eq(schema.tasks.projectId, p.id)).all()[0]?.value ?? 0;
      return {
        projectId: p.id,
        taskCount,
        agentCount: activeAgentsList.length,
        agents: activeAgentsList,
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
      recentActivities: [],
    });
  } catch {
    res.json({
      totalProjects: 0, activeAgents: 0, totalTasks: 0, runningTasks: 0,
      reviewTasks: 0, doneTasks: 0, weeklyCreated: 0, weeklyCompleted: 0,
      weeklyFailed: 0, projectStats: [], recentCompletedTasks: [],
      activityPage: 0, activityPageSize: 10, activityTotalCount: 0,
      activityTotalPages: 0, recentActivities: [],
    });
  }
});

// Plan usage — unlimited for local
app.get("/api/plans/my-usage", (_req, res) => {
  res.json({ plan: null, usage: { projects: 0, tasksThisMonth: 0 } });
});

// Factory reset — wipe all data except agents
app.post("/api/admin/factory-reset", (_req, res) => {
  try {
    db.delete(schema.taskLogs).run();
    db.delete(schema.messages).run();
    db.delete(schema.tasks).run();
    db.delete(schema.projects).run();
    db.delete(schema.docs).run();
    db.delete(schema.agentMemories).run();
    db.delete(schema.integrations).run();

    res.json({ success: true, message: "All data cleared. Agents preserved." });
  } catch (err) {
    res.status(500).json({ error: "Reset failed" });
  }
});

// Storage usage — no limits for local
app.get("/api/storage/usage", (_req, res) => {
  res.json({ usage: { usedMb: 0, limitMb: 0, usedPercent: 0, projectCount: 0, maxProjects: -1, repoTtlDays: 0 } });
});

// Admin setup status — always complete for local
app.get("/api/admin/setup-status", (_req, res) => {
  res.json({ isSetupComplete: true, steps: { hasAdmin: true, hasApiKey: true, hasPlans: true } });
});

// User language preference
app.get("/api/settings/language", (_req, res) => {
  const setting = db.select().from(schema.integrations)
    .where(eq(schema.integrations.type, "user_language")).get();
  res.json({ language: setting?.config ?? "pt-BR" });
});
app.put("/api/settings/language", (req, res) => {
  const { language } = req.body;
  if (!language) return res.status(400).json({ error: "language required" });
  const existing = db.select().from(schema.integrations)
    .where(eq(schema.integrations.type, "user_language")).get();
  const now = Date.now();
  if (existing) {
    db.update(schema.integrations).set({ config: language, updatedAt: now })
      .where(eq(schema.integrations.id, existing.id)).run();
  } else {
    db.insert(schema.integrations).values({
      id: nanoid(), type: "user_language", status: "active", config: language,
      createdAt: now, updatedAt: now,
    }).run();
  }
  res.json({ language });
});

// Notifications stubs
app.get("/api/notifications/unread-count", (_req, res) => {
  res.json({ count: 0 });
});
app.get("/api/notifications", (_req, res) => {
  res.json({ notifications: [] });
});

// Teams stub
app.get("/api/teams", (_req, res) => {
  res.json({ teams: [] });
});

// Auth refresh stub
app.post("/api/auth/refresh", (_req, res) => {
  res.json({ ok: true });
});

// Plans list stub
app.get("/api/plans", (_req, res) => {
  res.json({ plans: [] });
});

// (local-scan and import endpoints are defined above, before projectsRouter)

// Analytics stubs — must match frontend expected response shapes
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

// Docs CRUD
app.get("/api/docs", (_req, res) => {
  const allDocs = db.select().from(schema.docs).all();
  res.json({ docs: allDocs });
});

app.get("/api/docs/:docId", (req, res) => {
  const doc = db.select().from(schema.docs).where(eq(schema.docs.id, req.params.docId)).get();
  if (!doc) return res.status(404).json({ error: "not found" });
  res.json({ doc });
});

app.post("/api/docs", (req, res) => {
  const now = Date.now();
  const doc = {
    id: nanoid(),
    title: req.body.title || "Untitled",
    content: req.body.content || "",
    category: req.body.category || null,
    pinned: 0,
    parentId: req.body.parentId || null,
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(schema.docs).values(doc).run();
  res.status(201).json({ doc });
});

app.patch("/api/docs/:docId", (req, res) => {
  const existing = db.select().from(schema.docs).where(eq(schema.docs.id, req.params.docId)).get();
  if (!existing) return res.status(404).json({ error: "not found" });

  const updates: Record<string, unknown> = { updatedAt: Date.now() };
  if (req.body.title !== undefined) updates.title = req.body.title;
  if (req.body.content !== undefined) updates.content = req.body.content;
  if (req.body.category !== undefined) updates.category = req.body.category;
  if (req.body.pinned !== undefined) updates.pinned = req.body.pinned ? 1 : 0;
  if (req.body.parentId !== undefined) updates.parentId = req.body.parentId;
  if (req.body.order !== undefined) updates.order = req.body.order;

  db.update(schema.docs).set(updates).where(eq(schema.docs.id, req.params.docId)).run();
  const doc = db.select().from(schema.docs).where(eq(schema.docs.id, req.params.docId)).get();
  res.json({ doc });
});

app.put("/api/docs/:docId", (req, res) => {
  const existing = db.select().from(schema.docs).where(eq(schema.docs.id, req.params.docId)).get();
  if (!existing) return res.status(404).json({ error: "not found" });

  const updates: Record<string, unknown> = { updatedAt: Date.now() };
  if (req.body.title !== undefined) updates.title = req.body.title;
  if (req.body.content !== undefined) updates.content = req.body.content;
  if (req.body.category !== undefined) updates.category = req.body.category;
  if (req.body.pinned !== undefined) updates.pinned = req.body.pinned ? 1 : 0;

  db.update(schema.docs).set(updates).where(eq(schema.docs.id, req.params.docId)).run();
  const doc = db.select().from(schema.docs).where(eq(schema.docs.id, req.params.docId)).get();
  res.json({ doc });
});

app.delete("/api/docs/:docId", (req, res) => {
  db.delete(schema.docs).where(eq(schema.docs.id, req.params.docId)).run();
  res.json({ success: true });
});

// API docs generation — introspects registered routes
const generateApiEndpoints = () => {
  const endpoints: { method: string; path: string; description: string; group: string; params: { name: string; in: string; type: string; required: boolean }[] }[] = [];

  const routeDescriptions: Record<string, { desc: string; group: string; params?: { name: string; in: string; type: string; required: boolean }[] }> = {
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
      { name: "description", in: "body", type: "string", required: false },
    ]},
    "POST /api/projects/create": { desc: "Create a new project with scaffolding and git init", group: "Projects", params: [
      { name: "name", in: "body", type: "string", required: true },
      { name: "description", in: "body", type: "string", required: false },
      { name: "stack", in: "body", type: "string[]", required: false },
      { name: "isPrivate", in: "body", type: "boolean", required: false },
    ]},
    "GET /api/projects": { desc: "List all projects", group: "Projects" },
    "GET /api/projects/:id": { desc: "Get project details", group: "Projects", params: [
      { name: "id", in: "path", type: "string", required: true },
    ]},
    "DELETE /api/projects/:id": { desc: "Delete project and remove files from disk", group: "Projects", params: [
      { name: "id", in: "path", type: "string", required: true },
    ]},
    "GET /api/projects/:id/git/status": { desc: "Git status: branch, staged/unstaged files, last commit, remote", group: "Git" },
    "GET /api/projects/:id/git/config": { desc: "Git remote URL and default branch", group: "Git" },
    "PUT /api/projects/:id/git/config": { desc: "Update git remote URL", group: "Git" },
    "POST /api/projects/:id/git/init": { desc: "Initialize git repository in project", group: "Git" },
    "POST /api/projects/:id/git/sync": { desc: "Pull rebase and push to remote", group: "Git" },
    "GET /api/projects/:id/files": { desc: "File tree for project", group: "Files" },
    "GET /api/projects/:id/files/content": { desc: "Read file content (path traversal protected)", group: "Files", params: [
      { name: "path", in: "query", type: "string", required: true },
    ]},
    "GET /api/tasks": { desc: "List tasks with optional filters", group: "Tasks", params: [
      { name: "projectId", in: "query", type: "string", required: false },
      { name: "status", in: "query", type: "string", required: false },
    ]},
    "POST /api/tasks": { desc: "Create a new task", group: "Tasks", params: [
      { name: "projectId", in: "body", type: "string", required: true },
      { name: "title", in: "body", type: "string", required: true },
      { name: "description", in: "body", type: "string", required: false },
      { name: "priority", in: "body", type: "string", required: false },
    ]},
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
      { name: "groupBy", in: "query", type: "string", required: false },
    ]},
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
    "GET /api/workflows": { desc: "List workflows", group: "Workflows" },
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

// Messages stub
app.get("/api/messages", (_req, res) => {
  res.json({ messages: [] });
});

// Workflows stub
app.get("/api/workflows", (_req, res) => {
  res.json({ workflows: [] });
});

// Skills stub
app.get("/api/skills", (_req, res) => {
  res.json({ skills: [] });
});

// Agent skills/memories stubs
app.get("/api/agents/:id/skills", (_req, res) => {
  res.json({ skills: [] });
});
// Agent context — agent config + memories formatted for prompt injection
app.get("/api/agents/:id/context", (req, res) => {
  const agent = db.select().from(schema.agents).where(eq(schema.agents.id, req.params.id)).get();
  if (!agent) return res.status(404).json({ error: "not found" });

  const memories = db.select().from(schema.agentMemories)
    .where(eq(schema.agentMemories.agentId, req.params.id)).all();

  let memoriesBlock = "";
  if (memories.length > 0) {
    const memoryLines = memories.map(m =>
      `- [${m.type}] ${m.content}${m.source ? ` (source: ${m.source})` : ""}`
    ).join("\n");
    memoriesBlock = `\n\n## Your Memories\nThese are learnings you've accumulated from previous tasks. Use them to inform your decisions:\n${memoryLines}`;
  }

  const memoryInstructions = `\n\n## Memory System
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
      systemPrompt: fullSystemPrompt,
    },
    memories,
    memoriesCount: memories.length,
  });
});

// Agent memories CRUD
app.get("/api/agents/:id/memories", (req, res) => {
  const memories = db.select().from(schema.agentMemories)
    .where(eq(schema.agentMemories.agentId, req.params.id)).all();
  res.json({ memories });
});

app.post("/api/agents/:id/memories", (req, res) => {
  const memory = {
    id: nanoid(),
    agentId: req.params.id,
    taskId: req.body.taskId || null,
    type: req.body.type || "learning",
    content: req.body.content,
    source: req.body.source || null,
    createdAt: Date.now(),
  };
  db.insert(schema.agentMemories).values(memory).run();
  res.status(201).json({ memory });
});

app.delete("/api/agents/:id/memories/:memoryId", (req, res) => {
  db.delete(schema.agentMemories).where(eq(schema.agentMemories.id, req.params.memoryId)).run();
  res.json({ success: true });
});

// Claude Code CLI usage — reads token and fetches from Anthropic API
let _usageCache: { usage: unknown; ts: number } | null = null;
const USAGE_CACHE_TTL = 60_000; // 1 min
const USAGE_CACHE_FILE = join(homedir(), ".claude", ".usage-cache.json");

// Load disk cache on startup
try {
  if (existsSync(USAGE_CACHE_FILE)) {
    const raw = JSON.parse(readFileSync(USAGE_CACHE_FILE, "utf-8"));
    if (raw.usage) _usageCache = { usage: raw.usage, ts: raw.ts || 0 };
  }
} catch { /* ignore */ }

app.get("/api/claude-usage", async (_req, res) => {
  try {
    // Return fresh cache to avoid rate limiting
    if (_usageCache && (Date.now() - _usageCache.ts < USAGE_CACHE_TTL)) {
      return res.json({ error: null, usage: _usageCache.usage, cached: true });
    }

    const token = getClaudeToken();
    if (!token) {
      return res.json({ error: "no_token", usage: null });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const apiRes = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "agenthub-local/1.0.0",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!apiRes.ok) {
      if (apiRes.status === 401) {
        const socketIo = _req.app.get("io");
        // Notify frontend via notification socket (already handled by frontend)
        if (socketIo) {
          socketIo.emit("agent:notification", {
            id: `auth_expired_${Date.now()}`,
            projectId: null,
            type: "agent_error",
            title: "Token Claude expirado",
            body: "Execute /login no Claude Code para renovar o token.",
            link: null,
            createdAt: new Date().toISOString(),
          });
        }
        // Auto-trigger claude login in background (non-blocking)
        import("child_process").then(cp => {
          cp.execFile("claude", ["login"], { timeout: 120000 }, (err) => {
            if (!err && socketIo) {
              socketIo.emit("agent:notification", {
                id: `auth_refreshed_${Date.now()}`,
                projectId: null,
                type: "info",
                title: "Token renovado",
                body: "Login no Claude realizado com sucesso.",
                link: null,
                createdAt: new Date().toISOString(),
              });
            }
          });
        }).catch(() => {});
      }
      // Return cached data on API error so widget still renders
      if (_usageCache) {
        return res.json({ error: null, usage: _usageCache.usage, cached: true });
      }
      return res.json({ error: `api_error_${apiRes.status}`, usage: null });
    }

    const usage = await apiRes.json();
    _usageCache = { usage, ts: Date.now() };
    res.json({ error: null, usage });
  } catch (err) {
    // Return cached data on fetch failure
    if (_usageCache) {
      return res.json({ error: null, usage: _usageCache.usage, cached: true });
    }
    res.json({ error: "fetch_failed", usage: null });
  }
});

// Available models
app.get("/api/plans/models", (_req, res) => {
  res.json({ models: [
    { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5", provider: "anthropic" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" },
  ]});
});

// Serve static frontend
const __dirname = dirname(fileURLToPath(import.meta.url));
const webDist = join(__dirname, "../web/dist");
app.use(express.static(webDist));

// SPA fallback — Express 5 uses {*path} syntax
app.get("{*path}", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) return next();
  res.sendFile(join(webDist, "index.html"), (err) => {
    if (err) next();
  });
});

// Socket.io
const httpServer = createServer(app);
const io = new SocketServer(httpServer, {
  cors: { origin: true },
});

// Share io with route handlers
app.set("io", io);

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

// Seed default agents
seedAgents();

// Start server
httpServer.listen(PREFERRED_PORT, () => {
  const addr = httpServer.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : PREFERRED_PORT;

  // Write port to file so the plugin command can read it
  const portFile = join(DATA_DIR, "port");
  writeFileSync(portFile, String(actualPort));

  console.log(`\nAgentHub Local running at http://localhost:${actualPort}`);
  console.log(`API: http://localhost:${actualPort}/api/health\n`);

  // Open browser unless NO_OPEN env is set
  if (!process.env.NO_OPEN) {
    open(`http://localhost:${actualPort}`).catch(() => {
      // Ignore if browser can't be opened
    });
  }

  // Auto-reconnect WhatsApp after server + socket.io are ready
  const whatsappIntegration = db.select().from(schema.integrations)
    .where(eq(schema.integrations.type, "whatsapp")).get();

  if (whatsappIntegration && whatsappIntegration.status !== "disconnected") {
    console.log("[WhatsApp] Previous session found — auto-reconnecting...");
    const config = whatsappIntegration.config ? JSON.parse(whatsappIntegration.config) : {};
    const whatsapp = getWhatsAppService();
    whatsapp.setIo(io);
    if (config.allowedNumber) whatsapp.setAllowedNumber(config.allowedNumber);

    whatsapp.onStatusChange((s) => {
      const current = db.select().from(schema.integrations)
        .where(eq(schema.integrations.type, "whatsapp")).get();
      if (current) {
        db.update(schema.integrations).set({ status: s, updatedAt: Date.now() })
          .where(eq(schema.integrations.id, current.id)).run();
      }
      io.emit("integration:status", { type: "whatsapp", status: s });
    });

    whatsapp.connect().then(() => {
      console.log("[WhatsApp] Auto-reconnect successful");
    }).catch(() => {
      console.log("[WhatsApp] Auto-reconnect failed");
      const curr = db.select().from(schema.integrations)
        .where(eq(schema.integrations.type, "whatsapp")).get();
      if (curr) db.update(schema.integrations).set({ status: "disconnected", updatedAt: Date.now() })
        .where(eq(schema.integrations.id, curr.id)).run();
      io.emit("integration:status", { type: "whatsapp", status: "disconnected" });
    });
  }
});

export { io };
