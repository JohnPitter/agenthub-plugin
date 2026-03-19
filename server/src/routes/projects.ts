import { Router } from "express";
import { db, projects } from "../db.js";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { scanWorkspace } from "../lib/scanner.js";

const router: ReturnType<typeof Router> = Router();

// GET / — list all projects
router.get("/", (_req, res) => {
  const rows = db.select().from(projects).all();
  res.json({ projects: rows });
});

// POST / — create project
router.post("/", (req, res) => {
  const { name, path, stack, description, githubUrl } = req.body;

  if (!name || !path) {
    res.status(400).json({ error: "name and path are required" });
    return;
  }

  // Check if project with same path already exists
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
    stack: Array.isArray(stack) ? JSON.stringify(stack) : (stack ?? null),
    description: description ?? null,
    githubUrl: githubUrl ?? null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  db.insert(projects).values(project).run();
  res.status(201).json({ project });
});

// POST /scan — scan a directory and return found projects
router.post("/scan", (req, res) => {
  const { directory } = req.body;

  if (!directory || typeof directory !== "string") {
    res.status(400).json({ error: "directory path is required" });
    return;
  }

  const found = scanWorkspace(directory);
  res.json(found);
});

// GET /:id — get single project
router.get("/:id", (req, res) => {
  const project = db.select().from(projects).where(eq(projects.id, req.params.id)).get();
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  res.json({ project });
});

// DELETE /:id — delete project
router.delete("/:id", (req, res) => {
  const project = db.select().from(projects).where(eq(projects.id, req.params.id)).get();
  if (!project) {
    res.status(404).json({ error: "project not found" });
    return;
  }
  db.delete(projects).where(eq(projects.id, req.params.id)).run();
  res.json({ success: true });
});

export default router;
