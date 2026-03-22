import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { db, agents } from "../db.js";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriageResult {
  complexity: "simple" | "moderate" | "complex";
  plan: string;
  phases: {
    agents: string[];
    parallel: boolean;
    context?: string;
  }[];
  maxTurns: Record<string, number>;
  skipQa: boolean;
}

export interface MergeReviewResult {
  approved: boolean;
  issues: string[];
}

// ---------------------------------------------------------------------------
// Agent role descriptions (used in system prompt for triage)
// ---------------------------------------------------------------------------

const AGENT_ROLE_DESCRIPTIONS: Record<string, string> = {
  architect: "Plans system architecture, designs data models, makes high-level technical decisions.",
  tech_lead: "Coordinates team, triages tasks, manages project flow.",
  frontend_dev: "Implements React UI components, responsive design, animations, UX flows.",
  backend_dev: "Implements API routes, database operations, server-side logic, integrations.",
  qa: "Reviews code quality, writes tests, validates features against requirements.",
  doc_writer: "Generates API docs, task change summaries, maintains project documentation.",
  support: "Resolves critical infrastructure issues, DevOps, environment problems.",
};

// ---------------------------------------------------------------------------
// Anthropic client (OAuth token from ~/.claude/.credentials.json)
// ---------------------------------------------------------------------------

function createAnthropicClient(): Anthropic | null {
  try {
    const raw = readFileSync(join(homedir(), ".claude", ".credentials.json"), "utf-8");
    const token = JSON.parse(raw)?.claudeAiOauth?.accessToken;
    if (!token) return null;
    return new Anthropic({
      apiKey: token,
      defaultHeaders: {
        "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14",
      },
    });
  } catch {
    return null;
  }
}

/** Auto-refresh Claude token by running `claude login` in background */
async function autoRefreshClaudeToken(): Promise<boolean> {
  const { execFile } = await import("child_process");
  return new Promise((resolve) => {
    console.log("[Orchestrator] Auto-refreshing Claude token via 'claude login'...");
    execFile("claude", ["login"], { timeout: 120000 }, (err) => {
      if (err) {
        console.error("[Orchestrator] Auto-login failed:", err.message);
        resolve(false);
      } else {
        console.log("[Orchestrator] Auto-login successful — token refreshed");
        resolve(true);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Internal: call Haiku with auto-retry on 401
// ---------------------------------------------------------------------------

async function callHaiku(
  systemPrompt: string,
  userPrompt: string,
  retried = false,
): Promise<string> {
  const client = createAnthropicClient();
  if (!client) {
    if (!retried) {
      const refreshed = await autoRefreshClaudeToken();
      if (refreshed) return callHaiku(systemPrompt, userPrompt, true);
    }
    throw new Error("[Orchestrator] Claude token not found. Run `claude login`.");
  }

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const textParts = response.content.filter((block) => block.type === "text");
    return textParts.map((block) => ("text" in block ? block.text : "")).join("");
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError && !retried) {
      console.error("[Orchestrator] Claude API 401 — token expired");
      const refreshed = await autoRefreshClaudeToken();
      if (refreshed) return callHaiku(systemPrompt, userPrompt, true);
      throw new Error("[Orchestrator] Token expired and auto-login failed.");
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read project package.json if it exists */
function readPackageJson(projectPath: string): Record<string, unknown> | null {
  try {
    const pkgPath = join(projectPath, "package.json");
    if (!existsSync(pkgPath)) return null;
    return JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return null;
  }
}

/** List root directory files (max 30) */
function listRootFiles(projectPath: string): string[] {
  try {
    if (!existsSync(projectPath)) return [];
    const entries = readdirSync(projectPath, { withFileTypes: true });
    return entries
      .slice(0, 30)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  } catch {
    return [];
  }
}

/** Get available agent roles from the database */
function getAvailableAgentRoles(): string[] {
  const allAgents = db
    .select({ role: agents.role })
    .from(agents)
    .where(eq(agents.isActive, 1))
    .all();
  return [...new Set(allAgents.map((a) => a.role))];
}

/** Parse JSON from LLM response, stripping markdown fences if present */
function parseJsonResponse<T>(text: string): T {
  let cleaned = text.trim();
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return JSON.parse(cleaned);
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

const TRIAGE_SYSTEM_PROMPT = `You are a Tech Lead performing task triage for a software development team.

## Available Agent Roles
{{AGENT_ROLES}}

## Your Job
Analyze the task and create an execution plan. Output ONLY valid JSON matching this exact schema — no explanation, no markdown, no text before or after:

{
  "complexity": "simple" | "moderate" | "complex",
  "plan": "<one-sentence summary of what needs to be done>",
  "phases": [
    {
      "agents": ["<role1>", "<role2>"],
      "parallel": <true|false>,
      "context": "<specific instruction for this phase>"
    }
  ],
  "maxTurns": { "<role>": <number> },
  "skipQa": <true|false>
}

## Rules
- **simple** tasks (bug fix, config change, small UI tweak): 1 agent, NO architect. maxTurns per agent = 8. skipQa = true for trivial changes.
- **moderate** tasks (new endpoint, component, moderate feature): architect + 1-2 devs. maxTurns per agent = 12. skipQa = false.
- **complex** tasks (new feature spanning multiple layers, refactoring): architect + multiple devs (can be parallel). maxTurns per agent = 15. skipQa = false.
- Only use agent roles from the available list.
- phases are executed sequentially; agents WITHIN a phase run in parallel if "parallel" is true.
- **MAXIMUM 3 phases total.** Typical: [architect] → [devs in parallel] → done. Do NOT create more than 3 phases.
- Architect always goes in the FIRST phase alone (when used).
- Put ALL dev agents (backend_dev, frontend_dev) in a SINGLE parallel phase — do NOT split into separate phases.
- If the task involves BOTH frontend and backend work, recommend monorepo structure (apps/web + apps/server)
- QA is handled separately by the system — do NOT include "qa" or "doc_writer" in phases.

Output ONLY the JSON object.`;

export async function triage(
  task: { title: string; description: string | null; priority: string; category: string | null },
  project: { name: string; path: string; stack: string | null },
): Promise<TriageResult> {
  console.log(`[Orchestrator] Triaging task: "${task.title}" for project "${project.name}"`);

  // Gather project context
  const pkg = readPackageJson(project.path);
  const rootFiles = listRootFiles(project.path);
  const availableRoles = getAvailableAgentRoles();

  // Build agent roles description for system prompt
  const rolesText = availableRoles
    .map((role) => `- **${role}**: ${AGENT_ROLE_DESCRIPTIONS[role] ?? "Custom agent role."}`)
    .join("\n");

  const systemPrompt = TRIAGE_SYSTEM_PROMPT.replace("{{AGENT_ROLES}}", rolesText);

  // Build user prompt
  const parts: string[] = [
    `## Task`,
    `- Title: ${task.title}`,
    `- Description: ${task.description ?? "(none)"}`,
    `- Priority: ${task.priority}`,
    `- Category: ${task.category ?? "general"}`,
    "",
    `## Project`,
    `- Name: ${project.name}`,
    `- Stack: ${project.stack ?? "unknown"}`,
  ];

  if (pkg) {
    const deps = Object.keys((pkg.dependencies as Record<string, string>) ?? {});
    const devDeps = Object.keys((pkg.devDependencies as Record<string, string>) ?? {});
    parts.push(`- Dependencies: ${deps.slice(0, 15).join(", ")}${deps.length > 15 ? ` (+${deps.length - 15} more)` : ""}`);
    parts.push(`- DevDependencies: ${devDeps.slice(0, 10).join(", ")}${devDeps.length > 10 ? ` (+${devDeps.length - 10} more)` : ""}`);
  }

  if (rootFiles.length > 0) {
    parts.push(`- Root files: ${rootFiles.join(", ")}`);
  }

    // Detect project structure type
    const hasAppsDir = rootFiles.includes("apps/");
    const hasPackagesDir = rootFiles.includes("packages/");
    const hasWorkspaceConfig = rootFiles.some(f => ["pnpm-workspace.yaml", "lerna.json", "turbo.json"].includes(f));
    if (hasAppsDir || hasPackagesDir || hasWorkspaceConfig) {
      parts.push(`- Structure: MONOREPO`);
    }

  const userPrompt = parts.join("\n");

  // Default fallback
  const fallback: TriageResult = {
    complexity: "moderate",
    plan: task.title,
    phases: [{ agents: ["backend_dev"], parallel: false }],
    maxTurns: { backend_dev: 15 },
    skipQa: false,
  };

  try {
    const responseText = await callHaiku(systemPrompt, userPrompt);
    console.log(`[Orchestrator] Triage raw response: ${responseText.slice(0, 200)}`);

    const result = parseJsonResponse<TriageResult>(responseText);

    // Validate required fields
    if (!result.complexity || !result.phases || !Array.isArray(result.phases) || result.phases.length === 0) {
      console.warn("[Orchestrator] Triage response missing required fields, using fallback");
      return fallback;
    }

    // Validate complexity value
    if (!["simple", "moderate", "complex"].includes(result.complexity)) {
      result.complexity = "moderate";
    }

    // Cap phases at 3 max — merge excess into last phase
    if (result.phases.length > 3) {
      console.warn(`[Orchestrator] Triage returned ${result.phases.length} phases, capping at 3`);
      const first = result.phases[0]; // architect
      const allDevAgents = result.phases.slice(1).flatMap((p) => p.agents);
      const uniqueDevs = [...new Set(allDevAgents)].filter((a) => a !== "qa" && a !== "doc_writer");
      result.phases = [first, { agents: uniqueDevs, parallel: uniqueDevs.length > 1 }];
    }

    // Remove qa/doc_writer from phases (handled separately)
    for (const phase of result.phases) {
      phase.agents = phase.agents.filter((a) => a !== "qa" && a !== "doc_writer");
    }
    result.phases = result.phases.filter((p) => p.agents.length > 0);

    // Ensure maxTurns has entries for all agents in phases
    if (!result.maxTurns || typeof result.maxTurns !== "object") {
      result.maxTurns = {};
    }
    const defaultTurns = result.complexity === "simple" ? 8 : result.complexity === "moderate" ? 12 : 15;
    for (const phase of result.phases) {
      for (const agent of phase.agents) {
        if (!result.maxTurns[agent]) {
          result.maxTurns[agent] = defaultTurns;
        }
      }
    }

    // Ensure skipQa is boolean
    if (typeof result.skipQa !== "boolean") {
      result.skipQa = false;
    }

    console.log(`[Orchestrator] Triage result: complexity=${result.complexity}, phases=${result.phases.length}, skipQa=${result.skipQa}`);
    return result;
  } catch (err) {
    console.error("[Orchestrator] Triage failed, using fallback:", err instanceof Error ? err.message : err);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Review Merge
// ---------------------------------------------------------------------------

const MERGE_REVIEW_SYSTEM_PROMPT = `You are a senior code reviewer checking merge results.
Analyze the merge conflicts and determine if the result looks correct.

Output ONLY valid JSON matching this schema — no explanation, no markdown:

{
  "approved": <true|false>,
  "issues": ["<issue description>", ...]
}

Rules:
- If there are no real problems, set approved=true and issues=[]
- If agents modified the same file with conflicting logic, flag it
- Be concise in issue descriptions`;

export async function reviewMerge(
  mergeConflicts: { file: string; agents: string[] }[],
  taskTitle: string,
): Promise<MergeReviewResult> {
  console.log(`[Orchestrator] Reviewing merge for task: "${taskTitle}" (${mergeConflicts.length} conflict(s))`);

  if (mergeConflicts.length === 0) {
    return { approved: true, issues: [] };
  }

  const userPrompt = [
    `## Task: ${taskTitle}`,
    "",
    "## Merge Conflicts",
    ...mergeConflicts.map((c) => `- **${c.file}** — modified by: ${c.agents.join(", ")}`),
  ].join("\n");

  try {
    const responseText = await callHaiku(MERGE_REVIEW_SYSTEM_PROMPT, userPrompt);
    const result = parseJsonResponse<MergeReviewResult>(responseText);

    if (typeof result.approved !== "boolean") {
      result.approved = false;
    }
    if (!Array.isArray(result.issues)) {
      result.issues = [];
    }

    console.log(`[Orchestrator] Merge review: approved=${result.approved}, issues=${result.issues.length}`);
    return result;
  } catch (err) {
    console.error("[Orchestrator] Merge review failed:", err instanceof Error ? err.message : err);
    return { approved: false, issues: ["Merge review failed — manual check recommended."] };
  }
}

// ---------------------------------------------------------------------------
// Route QA
// ---------------------------------------------------------------------------

export function routeQa(complexity: "simple" | "moderate" | "complex"): string {
  switch (complexity) {
    case "simple":
      return "claude-haiku-4-5-20251001";
    case "moderate":
      return "claude-sonnet-4-6";
    case "complex":
      return "claude-opus-4-6";
    default:
      return "claude-sonnet-4-6";
  }
}
