import { Router } from "express";
import { db, tasks, taskLogs } from "../db.js";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";

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
