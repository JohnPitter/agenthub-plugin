import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import open from "open";
import { writeFileSync } from "fs";

import projectsRouter from "./routes/projects.js";
import tasksRouter from "./routes/tasks.js";
import agentsRouter from "./routes/agents.js";
import filesRouter from "./routes/files.js";
import { seedAgents } from "./seed.js";
import { getClaudeToken } from "./lib/claude-token.js";
import { db, schema, DATA_DIR } from "./db.js";
import { count, eq } from "drizzle-orm";

// Use port 0 to let the OS assign a random available port
const PREFERRED_PORT = parseInt(process.env.PORT ?? "0", 10);
const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

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

// API routes
app.use("/api/projects", projectsRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/agents", agentsRouter);
app.use("/api", filesRouter);

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
      projectStats: [],
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

// Storage usage — no limits for local
app.get("/api/storage/usage", (_req, res) => {
  res.json({ usage: { usedMb: 0, limitMb: 0, usedPercent: 0, projectCount: 0, maxProjects: -1, repoTtlDays: 0 } });
});

// Admin setup status — always complete for local
app.get("/api/admin/setup-status", (_req, res) => {
  res.json({ isSetupComplete: true, steps: { hasAdmin: true, hasApiKey: true, hasPlans: true } });
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
});

export { io };
