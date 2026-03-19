/**
 * E2E tests for AgentHub Local Plugin
 *
 * Tests run against the live server at the port read from ~/.agenthub-local/port.
 * Start the server before running: npm run dev
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

let BASE_URL = "";

async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...opts?.headers },
    ...opts,
  });
  const body = await res.json() as T & { error?: string };
  return Object.assign(body, { _status: res.status }) as T & { _status: number };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const portFile = join(homedir(), ".agenthub-local", "port");
  if (!existsSync(portFile)) throw new Error("Server not running — port file not found");
  const port = readFileSync(portFile, "utf-8").trim();
  BASE_URL = `http://localhost:${port}/api`;

  const health = await api<{ status: string }>("/health");
  if (health.status !== "ok") throw new Error("Server health check failed");
});

// ─── 1. Health & Auth ─────────────────────────────────────────────────────────

describe("Health & Auth", () => {
  it("GET /health — returns ok status", async () => {
    const res = await api<{ status: string; version: string; uptime: number }>("/health");
    expect(res.status).toBe("ok");
    expect(res.version).toBe("1.0.0");
    expect(res.uptime).toBeGreaterThan(0);
  });

  it("GET /health — reports claudeToken presence", async () => {
    const res = await api<{ claudeToken: string }>("/health");
    expect(["found", "not_found"]).toContain(res.claudeToken);
  });

  it("GET /auth/me — returns local admin user", async () => {
    const res = await api<{ id: string; login: string; role: string }>("/auth/me");
    expect(res.id).toBe("local");
    expect(res.login).toBe("local");
    expect(res.role).toBe("admin");
  });

  it("POST /auth/refresh — returns ok", async () => {
    const res = await api<{ ok: boolean }>("/auth/refresh", { method: "POST" });
    expect(res.ok).toBe(true);
  });
});

// ─── 2. Admin & Setup ────────────────────────────────────────────────────────

describe("Admin & Setup", () => {
  it("GET /admin/setup-status — always complete in local mode", async () => {
    const res = await api<{ isSetupComplete: boolean; steps: Record<string, boolean> }>("/admin/setup-status");
    expect(res.isSetupComplete).toBe(true);
    expect(res.steps.hasAdmin).toBe(true);
    expect(res.steps.hasApiKey).toBe(true);
    expect(res.steps.hasPlans).toBe(true);
  });
});

// ─── 3. Agents CRUD ──────────────────────────────────────────────────────────

describe("Agents", () => {
  it("GET /agents — returns seeded agents with all properties", async () => {
    const res = await api<{ agents: Record<string, unknown>[] }>("/agents");
    expect(res.agents.length).toBeGreaterThanOrEqual(8);

    const roles = res.agents.map((a) => a.role);
    expect(roles).toContain("architect");
    expect(roles).toContain("tech_lead");
    expect(roles).toContain("frontend_dev");
    expect(roles).toContain("backend_dev");
    expect(roles).toContain("qa");
    expect(roles).toContain("doc_writer");
    expect(roles).toContain("receptionist");
    expect(roles).toContain("support");
  });

  it("GET /agents — seeded agents have color, avatar, soul", async () => {
    const res = await api<{ agents: Record<string, unknown>[] }>("/agents");
    const architect = res.agents.find((a) => a.role === "architect");
    expect(architect).toBeDefined();
    expect(architect!.color).toBe("#6366F1");
    expect(architect!.avatar).toBeTruthy();
    expect(architect!.soul).toBeTruthy();
    expect(architect!.systemPrompt).toBeTruthy();
  });

  it("GET /agents — default agents have correct models", async () => {
    const res = await api<{ agents: Record<string, unknown>[] }>("/agents");
    const architect = res.agents.find((a) => a.role === "architect");
    const techLead = res.agents.find((a) => a.role === "tech_lead");
    const support = res.agents.find((a) => a.role === "support");
    const receptionist = res.agents.find((a) => a.role === "receptionist");

    expect(architect!.model).toBe("claude-opus-4-6");
    expect(techLead!.model).toBe("claude-sonnet-4-6");
    expect(support!.model).toBe("claude-opus-4-6");
    expect(receptionist!.model).toBe("claude-haiku-4-5-20251001");
  });

  let customAgentId: string;

  it("POST /agents — create custom agent", async () => {
    const res = await api<{ agent: Record<string, unknown>; _status: number }>("/agents", {
      method: "POST",
      body: JSON.stringify({
        name: "Test Agent",
        role: "custom",
        systemPrompt: "You are a test agent.",
        description: "For testing",
      }),
    });
    expect(res._status).toBe(201);
    expect(res.agent.name).toBe("Test Agent");
    expect(res.agent.role).toBe("custom");
    customAgentId = res.agent.id as string;
  });

  it("POST /agents — validation: missing required fields", async () => {
    const res = await api<{ error: string; _status: number }>("/agents", {
      method: "POST",
      body: JSON.stringify({ name: "Incomplete" }),
    });
    expect(res._status).toBe(400);
  });

  it("PATCH /agents/:id — update agent", async () => {
    const res = await api<{ agent: Record<string, unknown> }>(`/agents/${customAgentId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Updated Agent", isActive: false }),
    });
    expect(res.agent.name).toBe("Updated Agent");
  });

  it("DELETE /agents/:id — delete custom agent", async () => {
    const res = await api<{ success: boolean }>(`/agents/${customAgentId}`, { method: "DELETE" });
    expect(res.success).toBe(true);
  });

  it("DELETE /agents/:id — cannot delete default agent", async () => {
    const agents = await api<{ agents: Record<string, unknown>[] }>("/agents");
    const defaultAgent = agents.agents.find((a) => a.isDefault === 1);
    if (defaultAgent) {
      const res = await api<{ error: string; _status: number }>(`/agents/${defaultAgent.id}`, { method: "DELETE" });
      expect(res._status).toBe(400);
    }
  });

  it("DELETE /agents/:id — 404 for non-existent", async () => {
    const res = await api<{ _status: number }>("/agents/non-existent-id", { method: "DELETE" });
    expect(res._status).toBe(404);
  });

  it("GET /agents/:id/skills — returns empty array", async () => {
    const agents = await api<{ agents: Record<string, unknown>[] }>("/agents");
    const first = agents.agents[0];
    const res = await api<{ skills: unknown[] }>(`/agents/${first.id}/skills`);
    expect(res.skills).toEqual([]);
  });

  it("GET /agents/:id/memories — returns array", async () => {
    const agents = await api<{ agents: Record<string, unknown>[] }>("/agents");
    const first = agents.agents[0];
    const res = await api<{ memories: unknown[] }>(`/agents/${first.id}/memories`);
    expect(Array.isArray(res.memories)).toBe(true);
  });
});

// ─── 4. Projects CRUD ────────────────────────────────────────────────────────

describe("Projects", () => {
  let createdProjectId: string;
  let importedProjectId: string;

  it("GET /projects — returns array", async () => {
    const res = await api<{ projects: unknown[] }>("/projects");
    expect(Array.isArray(res.projects)).toBe(true);
  });

  it("POST /projects/create — create local project", async () => {
    const name = `test-e2e-${Date.now()}`;
    const res = await api<{ project: Record<string, unknown>; _status: number }>("/projects/create", {
      method: "POST",
      body: JSON.stringify({ name, description: "E2E test project" }),
    });
    expect(res._status).toBe(201);
    expect(res.project.name).toBe(name);
    expect(res.project.path).toBeTruthy();
    expect(res.project.status).toBe("active");
    createdProjectId = res.project.id as string;
  });

  it("POST /projects/create — validation: empty name", async () => {
    const res = await api<{ error: string; _status: number }>("/projects/create", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    });
    expect(res._status).toBe(400);
  });

  it("POST /projects/create — duplicate path returns 409", async () => {
    const name = `test-e2e-${Date.now()}`;
    await api("/projects/create", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    const res = await api<{ error: string; _status: number }>("/projects/create", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    expect(res._status).toBe(409);
  });

  it("POST /projects/import — import local path", async () => {
    const path = join(homedir(), "Projects");
    const res = await api<{ project: Record<string, unknown>; _status: number }>("/projects/import", {
      method: "POST",
      body: JSON.stringify({
        repo: "test-import",
        cloneUrl: join(path, `import-test-${Date.now()}`),
        description: "Imported test",
      }),
    });
    expect(res._status).toBe(201);
    importedProjectId = res.project.id as string;
  });

  it("POST /projects/import — missing path returns 400", async () => {
    const res = await api<{ _status: number }>("/projects/import", {
      method: "POST",
      body: JSON.stringify({ repo: "test" }),
    });
    expect(res._status).toBe(400);
  });

  it("POST /projects/import — duplicate path returns 409", async () => {
    const path = join(homedir(), "Projects", `dup-test-${Date.now()}`);
    await api("/projects/import", {
      method: "POST",
      body: JSON.stringify({ cloneUrl: path }),
    });
    const res = await api<{ _status: number }>("/projects/import", {
      method: "POST",
      body: JSON.stringify({ cloneUrl: path }),
    });
    expect(res._status).toBe(409);
  });

  it("GET /projects/:id — returns single project", async () => {
    const res = await api<{ project: Record<string, unknown> }>(`/projects/${createdProjectId}`);
    expect(res.project.id).toBe(createdProjectId);
  });

  it("GET /projects/:id — 404 for non-existent", async () => {
    const res = await api<{ _status: number }>("/projects/non-existent-id");
    expect(res._status).toBe(404);
  });

  it("GET /projects/local-scan — scans local directories", async () => {
    const res = await api<{ repos: Record<string, unknown>[] }>("/projects/local-scan");
    expect(Array.isArray(res.repos)).toBe(true);
    // Should find at least the agenthub-plugin project itself
    if (res.repos.length > 0) {
      const first = res.repos[0];
      expect(first.name).toBeTruthy();
      expect(first.html_url).toBeTruthy();
      expect(typeof first.alreadyImported).toBe("boolean");
    }
  });

  it("DELETE /projects/:id — delete project", async () => {
    const res = await api<{ success: boolean }>(`/projects/${importedProjectId}`, { method: "DELETE" });
    expect(res.success).toBe(true);
  });

  it("DELETE /projects/:id — 404 for non-existent", async () => {
    const res = await api<{ _status: number }>("/projects/non-existent-id", { method: "DELETE" });
    expect(res._status).toBe(404);
  });
});

// ─── 5. Tasks Full Lifecycle ──────────────────────────────────────────────────

describe("Tasks", () => {
  let projectId: string;
  let taskId: string;
  let agentId: string;

  beforeAll(async () => {
    // Create a project for tasks
    const proj = await api<{ project: Record<string, unknown> }>("/projects/create", {
      method: "POST",
      body: JSON.stringify({ name: `task-test-${Date.now()}` }),
    });
    projectId = proj.project.id as string;

    // Get first agent
    const agents = await api<{ agents: Record<string, unknown>[] }>("/agents");
    agentId = agents.agents[0].id as string;
  });

  it("GET /tasks — returns empty list for new project", async () => {
    const res = await api<{ tasks: unknown[] }>(`/tasks?projectId=${projectId}`);
    expect(res.tasks).toEqual([]);
  });

  it("POST /tasks — create task with defaults", async () => {
    const res = await api<{ task: Record<string, unknown>; _status: number }>("/tasks", {
      method: "POST",
      body: JSON.stringify({ projectId, title: "E2E Task 1" }),
    });
    expect(res._status).toBe(201);
    expect(res.task.title).toBe("E2E Task 1");
    expect(res.task.status).toBe("created");
    expect(res.task.priority).toBe("medium");
    expect(res.task.category).toBe("feature");
    taskId = res.task.id as string;
  });

  it("POST /tasks — create task with all fields", async () => {
    const res = await api<{ task: Record<string, unknown>; _status: number }>("/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId,
        title: "E2E Task 2",
        description: "Full description",
        priority: "high",
        category: "bug",
        assignedAgentId: agentId,
      }),
    });
    expect(res._status).toBe(201);
    expect(res.task.priority).toBe("high");
    expect(res.task.category).toBe("bug");
    expect(res.task.assignedAgentId).toBe(agentId);
  });

  it("POST /tasks — validation: missing projectId", async () => {
    const res = await api<{ _status: number }>("/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "No project" }),
    });
    expect(res._status).toBe(400);
  });

  it("POST /tasks — validation: missing title", async () => {
    const res = await api<{ _status: number }>("/tasks", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    });
    expect(res._status).toBe(400);
  });

  it("GET /tasks — filter by projectId", async () => {
    const res = await api<{ tasks: Record<string, unknown>[] }>(`/tasks?projectId=${projectId}`);
    expect(res.tasks.length).toBeGreaterThanOrEqual(2);
    expect(res.tasks.every((t) => t.projectId === projectId)).toBe(true);
  });

  it("GET /tasks — filter by status", async () => {
    const res = await api<{ tasks: Record<string, unknown>[] }>("/tasks?status=created");
    expect(res.tasks.every((t) => t.status === "created")).toBe(true);
  });

  it("GET /tasks/:id — returns single task", async () => {
    const res = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`);
    expect(res.task.id).toBe(taskId);
    expect(res.task.title).toBe("E2E Task 1");
  });

  it("GET /tasks/:id — 404 for non-existent", async () => {
    const res = await api<{ _status: number }>("/tasks/non-existent-id");
    expect(res._status).toBe(404);
  });

  // Task state machine: created → pending → assigned → in_progress → review → done
  it("PATCH /tasks/:id — status: created → pending", async () => {
    const res = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "pending" }),
    });
    expect(res.task.status).toBe("pending");
  });

  it("PATCH /tasks/:id — status: pending → assigned", async () => {
    const res = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "assigned", assignedAgentId: agentId }),
    });
    expect(res.task.status).toBe("assigned");
    expect(res.task.assignedAgentId).toBe(agentId);
  });

  it("PATCH /tasks/:id — status: assigned → in_progress", async () => {
    const res = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "in_progress" }),
    });
    expect(res.task.status).toBe("in_progress");
  });

  it("PATCH /tasks/:id — update fields (branch, result)", async () => {
    const res = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ branch: "feat/e2e-test", result: "WIP" }),
    });
    expect(res.task.branch).toBe("feat/e2e-test");
    expect(res.task.result).toBe("WIP");
  });

  it("PATCH /tasks/:id — status: in_progress → review", async () => {
    const res = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "review" }),
    });
    expect(res.task.status).toBe("review");
  });

  it("PATCH /tasks/:id — status: review → done (sets completedAt)", async () => {
    const res = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "done" }),
    });
    expect(res.task.status).toBe("done");
    expect(res.task.completedAt).toBeTruthy();
  });

  it("PATCH /tasks/:id — same status is a no-op (done → done)", async () => {
    const res = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "done" }),
    });
    expect(res.task.status).toBe("done");
  });

  it("PATCH /tasks/:id — update fields without status on done task", async () => {
    const res = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ result: "Final result" }),
    });
    expect(res.task.result).toBe("Final result");
    expect(res.task.status).toBe("done");
  });

  it("PATCH /tasks/:id — invalid transition: done → in_progress", async () => {
    const res = await api<{ error: string; allowed: string[]; _status: number }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "in_progress" }),
    });
    expect(res._status).toBe(400);
    expect(res.error).toContain("Invalid transition");
    expect(res.allowed).toEqual([]);
  });

  it("PATCH /tasks/:id — 404 for non-existent", async () => {
    const res = await api<{ _status: number }>("/tasks/non-existent-id", {
      method: "PATCH",
      body: JSON.stringify({ status: "pending" }),
    });
    expect(res._status).toBe(404);
  });

  // Alternative state flows
  it("State machine: created → cancelled → pending (recovery)", async () => {
    const create = await api<{ task: Record<string, unknown> }>("/tasks", {
      method: "POST",
      body: JSON.stringify({ projectId, title: "Cancel test" }),
    });
    const id = create.task.id as string;

    const cancel = await api<{ task: Record<string, unknown> }>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled" }),
    });
    expect(cancel.task.status).toBe("cancelled");

    const recover = await api<{ task: Record<string, unknown> }>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "pending" }),
    });
    expect(recover.task.status).toBe("pending");
  });

  it("State machine: in_progress → failed → assigned (retry)", async () => {
    const create = await api<{ task: Record<string, unknown> }>("/tasks", {
      method: "POST",
      body: JSON.stringify({ projectId, title: "Fail test" }),
    });
    const id = create.task.id as string;

    // created → assigned → in_progress → failed → assigned
    await api(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status: "assigned" }) });
    await api(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) });
    await api(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status: "failed" }) });

    const retry = await api<{ task: Record<string, unknown> }>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "assigned" }),
    });
    expect(retry.task.status).toBe("assigned");
  });

  it("State machine: review → assigned (rejection)", async () => {
    const create = await api<{ task: Record<string, unknown> }>("/tasks", {
      method: "POST",
      body: JSON.stringify({ projectId, title: "Reject test" }),
    });
    const id = create.task.id as string;

    await api(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status: "assigned" }) });
    await api(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) });
    await api(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status: "review" }) });

    const reject = await api<{ task: Record<string, unknown> }>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "assigned" }),
    });
    expect(reject.task.status).toBe("assigned");
  });

  // Task logs
  it("GET /tasks/:id/logs — returns creation + status change logs", async () => {
    const res = await api<{ logs: Record<string, unknown>[] }>(`/tasks/${taskId}/logs`);
    expect(res.logs.length).toBeGreaterThanOrEqual(2);

    const actions = res.logs.map((l) => l.action);
    expect(actions).toContain("created");
    expect(actions).toContain("status_change");
  });

  it("GET /tasks/:id/logs — 404 for non-existent task", async () => {
    const res = await api<{ _status: number }>("/tasks/non-existent-id/logs");
    expect(res._status).toBe(404);
  });

  // Delete
  it("DELETE /tasks/:id — deletes task and logs", async () => {
    const create = await api<{ task: Record<string, unknown> }>("/tasks", {
      method: "POST",
      body: JSON.stringify({ projectId, title: "Delete me" }),
    });
    const id = create.task.id as string;

    const res = await api<{ success: boolean }>(`/tasks/${id}`, { method: "DELETE" });
    expect(res.success).toBe(true);

    // Verify gone
    const check = await api<{ _status: number }>(`/tasks/${id}`);
    expect(check._status).toBe(404);
  });

  it("DELETE /tasks/:id — 404 for non-existent", async () => {
    const res = await api<{ _status: number }>("/tasks/non-existent-id", { method: "DELETE" });
    expect(res._status).toBe(404);
  });
});

// ─── 6. Files ─────────────────────────────────────────────────────────────────

describe("Files", () => {
  let projectId: string;
  beforeAll(async () => {
    const proj = await api<{ project: Record<string, unknown> }>("/projects/create", {
      method: "POST",
      body: JSON.stringify({ name: `files-test-${Date.now()}` }),
    });
    projectId = proj.project.id as string;
  });

  it("GET /projects/:id/files — returns file tree", async () => {
    const res = await api<{ files: Record<string, unknown>[] }>(`/projects/${projectId}/files`);
    expect(Array.isArray(res.files)).toBe(true);
    // Created project has package.json and README.md
    const names = res.files.map((f) => f.name);
    expect(names).toContain("package.json");
    expect(names).toContain("README.md");
  });

  it("GET /projects/:id/files/content — read file content", async () => {
    const res = await api<{ content: string; path: string; extension: string }>(`/projects/${projectId}/files/content?path=package.json`);
    expect(res.content).toBeTruthy();
    expect(res.extension).toBe(".json");

    // Should be valid JSON
    const parsed = JSON.parse(res.content);
    expect(parsed.name).toBeTruthy();
  });

  it("GET /projects/:id/files/content — path traversal blocked", async () => {
    const res = await api<{ _status: number }>(`/projects/${projectId}/files/content?path=../../etc/passwd`);
    expect(res._status).toBe(403);
  });

  it("GET /projects/:id/files/content — missing path returns 400", async () => {
    const res = await api<{ _status: number }>(`/projects/${projectId}/files/content`);
    expect(res._status).toBe(400);
  });

  it("GET /projects/:id/files/content — non-existent file returns 404", async () => {
    const res = await api<{ _status: number }>(`/projects/${projectId}/files/content?path=non-existent.txt`);
    expect(res._status).toBe(404);
  });
});

// ─── 7. Dashboard Stats ───────────────────────────────────────────────────────

describe("Dashboard Stats", () => {
  it("GET /dashboard/stats — returns all expected fields", async () => {
    const res = await api<Record<string, unknown>>("/dashboard/stats");
    expect(typeof res.totalProjects).toBe("number");
    expect(typeof res.activeAgents).toBe("number");
    expect(typeof res.totalTasks).toBe("number");
    expect(typeof res.runningTasks).toBe("number");
    expect(typeof res.reviewTasks).toBe("number");
    expect(typeof res.doneTasks).toBe("number");
    expect(Array.isArray(res.projectStats)).toBe(true);
    expect(Array.isArray(res.recentActivities)).toBe(true);
  });

  it("GET /dashboard/stats — counts reflect real data", async () => {
    const res = await api<{ totalProjects: number; activeAgents: number }>("/dashboard/stats");
    expect(res.totalProjects).toBeGreaterThan(0);
    expect(res.activeAgents).toBeGreaterThanOrEqual(8);
  });
});

// ─── 8. Plans & Usage ─────────────────────────────────────────────────────────

describe("Plans & Usage", () => {
  it("GET /plans/my-usage — unlimited local", async () => {
    const res = await api<{ plan: null; usage: Record<string, number> }>("/plans/my-usage");
    expect(res.plan).toBeNull();
    expect(res.usage.projects).toBe(0);
    expect(res.usage.tasksThisMonth).toBe(0);
  });

  it("GET /plans — empty in local mode", async () => {
    const res = await api<{ plans: unknown[] }>("/plans");
    expect(res.plans).toEqual([]);
  });

  it("GET /plans/models — returns available models", async () => {
    const res = await api<{ models: Record<string, string>[] }>("/plans/models");
    expect(res.models.length).toBe(3);

    const ids = res.models.map((m) => m.id);
    expect(ids).toContain("claude-sonnet-4-5-20250929");
    expect(ids).toContain("claude-haiku-4-5-20251001");
    expect(ids).toContain("claude-opus-4-6");
  });

  it("GET /storage/usage — no limits in local mode", async () => {
    const res = await api<{ usage: Record<string, number> }>("/storage/usage");
    expect(res.usage.maxProjects).toBe(-1);
    expect(res.usage.limitMb).toBe(0);
  });
});

// ─── 9. Claude Usage ──────────────────────────────────────────────────────────

describe("Claude Usage", () => {
  it("GET /claude-usage — returns error or usage data", async () => {
    const res = await api<{ error: string | null; usage: unknown }>("/claude-usage");
    // Either has usage data or an error — never both undefined
    if (res.error) {
      expect(["no_token", "fetch_failed"].some((e) => res.error!.startsWith(e) || res.error!.startsWith("api_error"))).toBe(true);
      expect(res.usage).toBeNull();
    } else {
      expect(res.usage).toBeTruthy();
    }
  });
});

// ─── 10. Notifications & Misc Stubs ──────────────────────────────────────────

describe("Stubs", () => {
  it("GET /notifications/unread-count — returns 0", async () => {
    const res = await api<{ count: number }>("/notifications/unread-count");
    expect(res.count).toBe(0);
  });

  it("GET /notifications — returns empty array", async () => {
    const res = await api<{ notifications: unknown[] }>("/notifications");
    expect(res.notifications).toEqual([]);
  });

  it("GET /teams — returns empty array", async () => {
    const res = await api<{ teams: unknown[] }>("/teams");
    expect(res.teams).toEqual([]);
  });

  it("GET /messages — returns empty array", async () => {
    const res = await api<{ messages: unknown[] }>("/messages");
    expect(res.messages).toEqual([]);
  });

  it("GET /workflows — returns empty array", async () => {
    const res = await api<{ workflows: unknown[] }>("/workflows");
    expect(res.workflows).toEqual([]);
  });

  it("GET /skills — returns empty array", async () => {
    const res = await api<{ skills: unknown[] }>("/skills");
    expect(res.skills).toEqual([]);
  });
});

// ─── 11. Analytics Stubs ──────────────────────────────────────────────────────

describe("Analytics", () => {
  it("GET /analytics/agents — returns empty metrics", async () => {
    const res = await api<{ metrics: unknown[] }>("/analytics/agents");
    expect(res.metrics).toEqual([]);
  });

  it("GET /analytics/trends — returns empty trends", async () => {
    const res = await api<{ trends: unknown[] }>("/analytics/trends");
    expect(res.trends).toEqual([]);
  });

  it("GET /analytics/summary — returns zeroed summary", async () => {
    const res = await api<Record<string, unknown>>("/analytics/summary");
    expect(res.totalCostUsd).toBe(0);
    expect(res.totalTokens).toBe(0);
    expect(res.completedTasks).toBe(0);
  });

  it("GET /analytics/costs — returns array", async () => {
    const res = await api<unknown>("/analytics/costs");
    expect(Array.isArray(res)).toBe(true);
  });
});

// ─── 12. Integrations (WhatsApp) ──────────────────────────────────────────────

describe("Integrations — WhatsApp", () => {
  it("GET /integrations/whatsapp/status — returns status without projectId", async () => {
    const res = await api<{ status: string; integrationId: string | null }>("/integrations/whatsapp/status");
    expect(["disconnected", "connecting", "connected", "error"]).toContain(res.status);
  });

  it("PUT /integrations/whatsapp/config — 404 if no integration exists yet", async () => {
    // Clean state — may or may not have integration
    const status = await api<{ integrationId: string | null }>("/integrations/whatsapp/status");
    if (!status.integrationId) {
      const res = await api<{ _status: number }>("/integrations/whatsapp/config", {
        method: "PUT",
        body: JSON.stringify({ allowedNumber: "+5511999999999" }),
      });
      expect(res._status).toBe(404);
    }
  });
});

// ─── 13. Integrations (Telegram Stubs) ────────────────────────────────────────

describe("Integrations — Telegram", () => {
  it("GET /integrations/telegram/status — always disconnected", async () => {
    const res = await api<{ status: string }>("/integrations/telegram/status");
    expect(res.status).toBe("disconnected");
  });

  it("POST /integrations/telegram/connect — returns 501", async () => {
    const res = await api<{ error: string; _status: number }>("/integrations/telegram/connect", {
      method: "POST",
      body: JSON.stringify({ botToken: "test" }),
    });
    expect(res._status).toBe(501);
  });

  it("POST /integrations/telegram/disconnect — returns success", async () => {
    const res = await api<{ success: boolean }>("/integrations/telegram/disconnect", {
      method: "POST",
    });
    expect(res.success).toBe(true);
  });
});

// ─── 14. Full User Journey ────────────────────────────────────────────────────

describe("Full User Journey", () => {
  it("complete flow: create project → create task → assign → progress → review → done", async () => {
    // 1. Create project
    const projRes = await api<{ project: Record<string, unknown> }>("/projects/create", {
      method: "POST",
      body: JSON.stringify({ name: `journey-${Date.now()}`, description: "E2E journey test" }),
    });
    const projectId = projRes.project.id as string;

    // 2. Get agent to assign
    const agentsRes = await api<{ agents: Record<string, unknown>[] }>("/agents");
    const devAgent = agentsRes.agents.find((a) => a.role === "frontend_dev");
    expect(devAgent).toBeDefined();
    const agentId = devAgent!.id as string;

    // 3. Create task
    const taskRes = await api<{ task: Record<string, unknown> }>("/tasks", {
      method: "POST",
      body: JSON.stringify({
        projectId,
        title: "Build login page",
        description: "Create a responsive login page with email/password",
        priority: "high",
        category: "feature",
      }),
    });
    const taskId = taskRes.task.id as string;
    expect(taskRes.task.status).toBe("created");

    // 4. Assign to agent
    const assign = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "assigned", assignedAgentId: agentId }),
    });
    expect(assign.task.status).toBe("assigned");

    // 5. Start work
    const start = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "in_progress", branch: "feat/login-page" }),
    });
    expect(start.task.status).toBe("in_progress");
    expect(start.task.branch).toBe("feat/login-page");

    // 6. Submit for review
    const review = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "review", result: "Login page implemented with validation" }),
    });
    expect(review.task.status).toBe("review");

    // 7. Complete
    const done = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "done", costUsd: "0.15", tokensUsed: 5000 }),
    });
    expect(done.task.status).toBe("done");
    expect(done.task.completedAt).toBeTruthy();
    expect(done.task.costUsd).toBe("0.15");
    expect(done.task.tokensUsed).toBe(5000);

    // 8. Verify logs captured the full journey
    const logs = await api<{ logs: Record<string, unknown>[] }>(`/tasks/${taskId}/logs`);
    expect(logs.logs.length).toBeGreaterThanOrEqual(5); // created + 4 status changes

    // 9. Dashboard reflects the task
    const stats = await api<{ doneTasks: number }>("/dashboard/stats");
    expect(stats.doneTasks).toBeGreaterThanOrEqual(1);

    // 10. Browse project files
    const files = await api<{ files: Record<string, unknown>[] }>(`/projects/${projectId}/files`);
    expect(files.files.length).toBeGreaterThan(0);
  });

  it("rejection flow: review → assigned → in_progress → review → done", async () => {
    const projRes = await api<{ project: Record<string, unknown> }>("/projects/create", {
      method: "POST",
      body: JSON.stringify({ name: `reject-${Date.now()}` }),
    });
    const projectId = projRes.project.id as string;

    const taskRes = await api<{ task: Record<string, unknown> }>("/tasks", {
      method: "POST",
      body: JSON.stringify({ projectId, title: "Rejection flow test" }),
    });
    const taskId = taskRes.task.id as string;

    // created → assigned → in_progress → review
    await api(`/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "assigned" }) });
    await api(`/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) });
    await api(`/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "review" }) });

    // QA rejects → assigned
    const reject = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "assigned" }),
    });
    expect(reject.task.status).toBe("assigned");

    // Fix and resubmit → in_progress → review → done
    await api(`/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) });
    await api(`/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "review" }) });
    const done = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "done" }),
    });
    expect(done.task.status).toBe("done");

    // Should have 7+ log entries (created + 6 transitions)
    const logs = await api<{ logs: Record<string, unknown>[] }>(`/tasks/${taskId}/logs`);
    expect(logs.logs.length).toBeGreaterThanOrEqual(7);
  });

  it("failure recovery flow: in_progress → failed → pending → assigned", async () => {
    const projRes = await api<{ project: Record<string, unknown> }>("/projects/create", {
      method: "POST",
      body: JSON.stringify({ name: `fail-${Date.now()}` }),
    });
    const projectId = projRes.project.id as string;

    const taskRes = await api<{ task: Record<string, unknown> }>("/tasks", {
      method: "POST",
      body: JSON.stringify({ projectId, title: "Failure recovery test" }),
    });
    const taskId = taskRes.task.id as string;

    await api(`/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "assigned" }) });
    await api(`/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) });
    await api(`/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "failed" }) });

    // Recover from failure
    const recover = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "pending" }),
    });
    expect(recover.task.status).toBe("pending");

    const reassign = await api<{ task: Record<string, unknown> }>(`/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "assigned" }),
    });
    expect(reassign.task.status).toBe("assigned");
  });
});

// ─── 15. SPA & Static Serving ─────────────────────────────────────────────────

describe("SPA & Static", () => {
  it("GET / — returns HTML (SPA)", async () => {
    const port = readFileSync(join(homedir(), ".agenthub-local", "port"), "utf-8").trim();
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("GET /dashboard — SPA fallback returns HTML", async () => {
    const port = readFileSync(join(homedir(), ".agenthub-local", "port"), "utf-8").trim();
    const res = await fetch(`http://localhost:${port}/dashboard`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("GET /api/unknown-route — returns 404", async () => {
    const port = readFileSync(join(homedir(), ".agenthub-local", "port"), "utf-8").trim();
    const res = await fetch(`http://localhost:${port}/api/this-does-not-exist`);
    expect(res.status).toBe(404);
  });
});

// ─── 16. Docs CRUD ───────────────────────────────────────────────────────────

describe("Docs", () => {
  let docId: string;

  it("GET /docs — returns empty or existing docs", async () => {
    const res = await api<{ docs: unknown[] }>("/docs");
    expect(Array.isArray(res.docs)).toBe(true);
  });

  it("POST /docs — create document", async () => {
    const res = await api<{ doc: Record<string, unknown>; _status: number }>("/docs", {
      method: "POST",
      body: JSON.stringify({ title: "E2E Test Doc" }),
    });
    expect(res._status).toBe(201);
    expect(res.doc.title).toBe("E2E Test Doc");
    expect(res.doc.content).toBe("");
    docId = res.doc.id as string;
  });

  it("POST /docs — create with parentId", async () => {
    const res = await api<{ doc: Record<string, unknown>; _status: number }>("/docs", {
      method: "POST",
      body: JSON.stringify({ title: "Child Doc", parentId: docId }),
    });
    expect(res._status).toBe(201);
    expect(res.doc.parentId).toBe(docId);
  });

  it("PATCH /docs/:id — update content and category", async () => {
    const res = await api<{ doc: Record<string, unknown> }>(`/docs/${docId}`, {
      method: "PATCH",
      body: JSON.stringify({ content: "# Hello", category: "guide" }),
    });
    expect(res.doc.content).toBe("# Hello");
    expect(res.doc.category).toBe("guide");
  });

  it("PATCH /docs/:id — toggle pinned", async () => {
    const res = await api<{ doc: Record<string, unknown> }>(`/docs/${docId}`, {
      method: "PATCH",
      body: JSON.stringify({ pinned: true }),
    });
    expect(res.doc.pinned).toBe(1);
  });

  it("PATCH /docs/:id — 404 for non-existent", async () => {
    const res = await api<{ _status: number }>("/docs/non-existent", {
      method: "PATCH",
      body: JSON.stringify({ title: "nope" }),
    });
    expect(res._status).toBe(404);
  });

  it("DELETE /docs/:id — deletes document", async () => {
    const res = await api<{ success: boolean }>(`/docs/${docId}`, { method: "DELETE" });
    expect(res.success).toBe(true);
  });

  it("GET /docs-gen/api — returns endpoints list", async () => {
    const res = await api<{ endpoints: Record<string, unknown>[] }>("/docs-gen/api");
    expect(res.endpoints.length).toBeGreaterThan(0);
    const first = res.endpoints[0];
    expect(first.method).toBeTruthy();
    expect(first.path).toBeTruthy();
    expect(first.group).toBeTruthy();
  });
});

// ─── 17. Agent Memories CRUD ─────────────────────────────────────────────────

describe("Agent Memories", () => {
  let agentId: string;
  let memoryId: string;

  beforeAll(async () => {
    const agents = await api<{ agents: Record<string, unknown>[] }>("/agents");
    agentId = agents.agents[0].id as string;
  });

  it("POST /agents/:id/memories — create memory", async () => {
    const res = await api<{ memory: Record<string, unknown>; _status: number }>(`/agents/${agentId}/memories`, {
      method: "POST",
      body: JSON.stringify({
        content: "Always use parameterized queries",
        type: "learning",
        source: "task execution",
      }),
    });
    expect(res._status).toBe(201);
    expect(res.memory.content).toBe("Always use parameterized queries");
    expect(res.memory.type).toBe("learning");
    expect(res.memory.agentId).toBe(agentId);
    memoryId = res.memory.id as string;
  });

  it("GET /agents/:id/memories — lists memories", async () => {
    const res = await api<{ memories: Record<string, unknown>[] }>(`/agents/${agentId}/memories`);
    expect(res.memories.length).toBeGreaterThan(0);
    expect(res.memories.some((m) => m.id === memoryId)).toBe(true);
  });

  it("GET /agents/:id/context — includes memories in system prompt", async () => {
    const res = await api<{ agent: Record<string, unknown>; memoriesCount: number }>(`/agents/${agentId}/context`);
    expect(res.memoriesCount).toBeGreaterThan(0);
    const prompt = res.agent.systemPrompt as string;
    expect(prompt).toContain("Your Memories");
    expect(prompt).toContain("Always use parameterized queries");
    expect(prompt).toContain("Memory System");
  });

  it("DELETE /agents/:id/memories/:memoryId — deletes memory", async () => {
    const res = await api<{ success: boolean }>(`/agents/${agentId}/memories/${memoryId}`, { method: "DELETE" });
    expect(res.success).toBe(true);

    const check = await api<{ memories: Record<string, unknown>[] }>(`/agents/${agentId}/memories`);
    expect(check.memories.some((m) => m.id === memoryId)).toBe(false);
  });
});

// ─── 18. Git Routes ──────────────────────────────────────────────────────────

describe("Git", () => {
  let projectId: string;

  beforeAll(async () => {
    const proj = await api<{ project: Record<string, unknown> }>("/projects/create", {
      method: "POST",
      body: JSON.stringify({ name: `git-test-${Date.now()}` }),
    });
    projectId = proj.project.id as string;
  });

  it("GET /projects/:id/git/status — returns git info", async () => {
    const res = await api<{ isGitRepo: boolean; status: Record<string, unknown> | null }>(`/projects/${projectId}/git/status`);
    expect(typeof res.isGitRepo).toBe("boolean");
    if (res.isGitRepo) {
      expect(res.status).toBeTruthy();
      expect(res.status!.branch).toBeTruthy();
    }
  });

  it("GET /projects/:id/git/config — returns config", async () => {
    const res = await api<{ remoteUrl: string; defaultBranch: string }>(`/projects/${projectId}/git/config`);
    expect(typeof res.remoteUrl).toBe("string");
    expect(typeof res.defaultBranch).toBe("string");
  });

  it("GET /projects/:id/git/status — 404 for non-existent project", async () => {
    const res = await api<{ _status: number }>("/projects/non-existent/git/status");
    expect(res._status).toBe(404);
  });
});
