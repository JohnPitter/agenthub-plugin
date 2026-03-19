import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import open from "open";

import projectsRouter from "./routes/projects.js";
import tasksRouter from "./routes/tasks.js";
import agentsRouter from "./routes/agents.js";
import filesRouter from "./routes/files.js";
import { seedAgents } from "./seed.js";
import { getClaudeToken } from "./lib/claude-token.js";

const PORT = parseInt(process.env.PORT ?? "4200", 10);
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
httpServer.listen(PORT, () => {
  console.log(`\nAgentHub Local running at http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/health\n`);

  // Open browser unless NO_OPEN env is set
  if (!process.env.NO_OPEN) {
    open(`http://localhost:${PORT}`).catch(() => {
      // Ignore if browser can't be opened
    });
  }
});

export { io };
