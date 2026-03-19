import { Router } from "express";
import { db, agents } from "../db.js";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

const router: ReturnType<typeof Router> = Router();

// GET / — list all agents
router.get("/", (_req, res) => {
  const rows = db.select().from(agents).all();
  res.json({ agents: rows });
});

// POST / — create agent
router.post("/", (req, res) => {
  const { name, role, model, systemPrompt, description, allowedTools, maxThinkingTokens } = req.body;

  if (!name || !role || !systemPrompt) {
    res.status(400).json({ error: "name, role, and systemPrompt are required" });
    return;
  }

  const now = Date.now();
  const agent = {
    id: nanoid(),
    name,
    role,
    model: model ?? "claude-sonnet-4-5-20250929",
    maxThinkingTokens: maxThinkingTokens ?? null,
    systemPrompt,
    description: description ?? "",
    allowedTools: Array.isArray(allowedTools) ? JSON.stringify(allowedTools) : (allowedTools ?? null),
    isActive: 1,
    isDefault: 0,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(agents).values(agent).run();
  res.status(201).json({ agent });
});

// PATCH /:id — update agent
router.patch("/:id", (req, res) => {
  const agent = db.select().from(agents).where(eq(agents.id, req.params.id)).get();
  if (!agent) {
    res.status(404).json({ error: "agent not found" });
    return;
  }

  const { name, role, model, systemPrompt, description, allowedTools, isActive, maxThinkingTokens } = req.body;
  const now = Date.now();

  const updates: Record<string, unknown> = { updatedAt: now };

  if (name !== undefined) updates.name = name;
  if (role !== undefined) updates.role = role;
  if (model !== undefined) updates.model = model;
  if (systemPrompt !== undefined) updates.systemPrompt = systemPrompt;
  if (description !== undefined) updates.description = description;
  if (maxThinkingTokens !== undefined) updates.maxThinkingTokens = maxThinkingTokens;
  if (isActive !== undefined) updates.isActive = isActive ? 1 : 0;
  if (allowedTools !== undefined) {
    updates.allowedTools = Array.isArray(allowedTools) ? JSON.stringify(allowedTools) : allowedTools;
  }

  db.update(agents).set(updates).where(eq(agents.id, req.params.id)).run();

  const updated = db.select().from(agents).where(eq(agents.id, req.params.id)).get();
  res.json({ agent: updated });
});

// DELETE /:id — delete agent
router.delete("/:id", (req, res) => {
  const agent = db.select().from(agents).where(eq(agents.id, req.params.id)).get();
  if (!agent) {
    res.status(404).json({ error: "agent not found" });
    return;
  }

  if (agent.isDefault) {
    res.status(400).json({ error: "cannot delete default agents" });
    return;
  }

  db.delete(agents).where(eq(agents.id, req.params.id)).run();
  res.json({ success: true });
});

export default router;
