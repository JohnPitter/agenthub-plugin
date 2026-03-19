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
import { DATA_DIR } from "./db.js";

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
