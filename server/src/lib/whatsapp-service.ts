import wppconnect from "@wppconnect-team/wppconnect";
import type { Whatsapp } from "@wppconnect-team/wppconnect";
import { join } from "path";
import { existsSync, readdirSync, unlinkSync, readFileSync } from "fs";
import https from "https";
import { homedir } from "os";
import Anthropic from "@anthropic-ai/sdk";
import { DATA_DIR, db, schema } from "../db.js";
import { eq } from "drizzle-orm";

import { nanoid } from "nanoid";
import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

/** Execute Team Lead action and return formatted result */
async function executeAction(action: Record<string, unknown>, io?: { emit: (e: string, d: unknown) => void }): Promise<string> {
  switch (action.action) {
    case "list_projects": {
      const projects = db.select().from(schema.projects).all();
      if (projects.length === 0) return "Nenhum projeto cadastrado.";
      return projects.map((p, i) => {
        const stack = p.stack ? JSON.parse(p.stack).slice(0, 3).join(", ") : "—";
        return `${i + 1}. *${p.name}* — ${stack}`;
      }).join("\n");
    }

    case "create_project": {
      const name = action.name as string;
      if (!name?.trim()) return "Nome do projeto e obrigatorio.";

      const dirName = name.trim().replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
      const projectsDir = join(homedir(), "Projects");
      mkdirSync(projectsDir, { recursive: true });
      const projectPath = join(projectsDir, dirName);

      if (existsSync(projectPath)) return `Projeto "${name}" ja existe.`;

      const stackArr = Array.isArray(action.stack) && action.stack.length > 0
        ? action.stack as string[]
        : ["nodejs"];

      mkdirSync(projectPath, { recursive: true });
      writeFileSync(join(projectPath, "package.json"), JSON.stringify({
        name: dirName, version: "1.0.0", description: (action.description as string) || "", private: true,
        scripts: { dev: "echo 'Configure your dev script'", build: "echo 'Configure your build script'" },
      }, null, 2));
      writeFileSync(join(projectPath, "README.md"), `# ${name.trim()}\n\n${(action.description as string) || ""}\n`);

      try {
        execFileSync("git", ["init"], { cwd: projectPath, timeout: 5000 });
        execFileSync("git", ["add", "."], { cwd: projectPath, timeout: 5000 });
        execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: projectPath, timeout: 5000 });
      } catch { /* optional */ }

      // GitHub repo creation if requested and token available
      let githubUrl: string | null = null;
      if (action.createOnGithub) {
        const ghInt = db.select().from(schema.integrations)
          .where(eq(schema.integrations.type, "github")).get();
        const ghToken = ghInt?.config ? JSON.parse(ghInt.config).token : null;
        if (ghToken) {
          try {
            const ghBody = JSON.stringify({ name: dirName, description: (action.description as string) || "", private: true, auto_init: false });
            const ghResult = await new Promise<{ status: number; html_url?: string }>((resolve) => {
              const req = https.request({
                hostname: "api.github.com", path: "/user/repos", method: "POST",
                headers: {
                  Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json",
                  "User-Agent": "agenthub-local/1.0.0", "X-GitHub-Api-Version": "2022-11-28",
                  "Content-Type": "application/json", "Content-Length": Buffer.byteLength(ghBody),
                },
              }, (res) => {
                let data = "";
                res.on("data", (chunk: string) => { data += chunk; });
                res.on("end", () => {
                  try { const d = JSON.parse(data); resolve({ status: res.statusCode ?? 500, html_url: d.html_url }); }
                  catch { resolve({ status: 500 }); }
                });
              });
              req.on("error", () => resolve({ status: 500 }));
              req.setTimeout(15000, () => { req.destroy(); resolve({ status: 408 }); });
              req.write(ghBody);
              req.end();
            });
            if (ghResult.status === 201 && ghResult.html_url) {
              githubUrl = ghResult.html_url;
              try {
                execFileSync("git", ["remote", "add", "origin", `${githubUrl}.git`], { cwd: projectPath, timeout: 5000 });
                execFileSync("git", ["push", "-u", "origin", "main"], { cwd: projectPath, timeout: 30000 });
              } catch { /* best-effort */ }
            }
          } catch { /* GitHub creation failed, continue locally */ }
        }
      }

      const now = Date.now();
      const projectId = nanoid();
      const project = {
        id: projectId, name: name.trim(), path: projectPath,
        stack: JSON.stringify(stackArr), description: (action.description as string) || null,
        githubUrl, status: "active", createdAt: now, updatedAt: now,
      };
      db.insert(schema.projects).values(project).run();
      if (io) io.emit("project:created", project);

      const stackLabel = stackArr.join(", ");
      const ghLabel = githubUrl ? `\nGitHub: ${githubUrl}` : "";
      return `Projeto *${name.trim()}* criado com sucesso!\nStack: ${stackLabel}\nLocal: ${projectPath}${ghLabel}`;
    }

    case "list_tasks": {
      const status = action.status as string | undefined;
      let tasks;
      if (status) {
        tasks = db.select().from(schema.tasks).where(eq(schema.tasks.status, status)).all();
      } else {
        tasks = db.select().from(schema.tasks).all();
      }
      if (tasks.length === 0) return status ? `Nenhuma task com status "${status}".` : "Nenhuma task cadastrada.";
      return tasks.slice(0, 20).map((t, i) => `${i + 1}. [${t.status}] *${t.title}* (${t.priority})`).join("\n");
    }

    case "get_task": {
      const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, action.taskId as string)).get();
      if (!task) return "Task nao encontrada.";
      return `*${task.title}*\nStatus: ${task.status}\nPrioridade: ${task.priority}\nCategoria: ${task.category}\n${task.description || ""}`;
    }

    case "create_task": {
      const title = (action.title as string)?.trim();
      if (!title) return "Titulo da task e obrigatorio.";

      const allProjects = db.select().from(schema.projects).all();
      if (allProjects.length === 0) return "Nenhum projeto cadastrado. Crie ou importe um projeto primeiro.";

      // Use specified project or first available
      let projectId = allProjects[0].id;
      let projectName = allProjects[0].name;
      if (action.projectId) {
        const match = allProjects.find(p => p.id === action.projectId || p.name.toLowerCase() === (action.projectId as string).toLowerCase());
        if (match) { projectId = match.id; projectName = match.name; }
      }

      const now = Date.now();
      const task = {
        id: nanoid(), projectId, assignedAgentId: null,
        title, description: (action.description as string) || null,
        status: "created", priority: (action.priority as string) || "medium",
        category: "feature", branch: null, result: null, costUsd: "0", tokensUsed: 0,
        createdAt: now, updatedAt: now, completedAt: null,
      };
      db.insert(schema.tasks).values(task).run();
      if (io) {
        io.emit("task:created", { task });
        io.emit("task:status", { taskId: task.id, status: task.status, projectId: task.projectId });
      }
      return `Task criada: *${title}* (${task.priority}) no projeto *${projectName}*`;
    }

    case "advance_status": {
      let task = db.select().from(schema.tasks).where(eq(schema.tasks.id, action.taskId as string)).get();
      // Fallback: search by title if ID not found
      if (!task && action.taskId) {
        const allTasks = db.select().from(schema.tasks).all();
        task = allTasks.find(t => t.title.toLowerCase().includes((action.taskId as string).toLowerCase())) ?? undefined;
      }
      if (!task) return "Task nao encontrada. Use list_tasks para ver as tasks disponiveis.";
      const newStatus = action.status as string;

      // Validate transition
      const VALID: Record<string, string[]> = {
        created: ["pending", "assigned", "cancelled"],
        pending: ["assigned", "cancelled"],
        assigned: ["in_progress", "cancelled"],
        in_progress: ["review", "failed", "cancelled"],
        review: ["done", "assigned", "failed"],
        failed: ["pending", "assigned"],
        done: [],
        cancelled: ["pending"],
      };
      const allowed = VALID[task.status] ?? [];
      if (!allowed.includes(newStatus)) {
        return `Transicao invalida: ${task.status} → ${newStatus}. Permitidos: ${allowed.join(", ") || "nenhum"}`;
      }

      const updatedAt = Date.now();
      db.update(schema.tasks).set({ status: newStatus, updatedAt })
        .where(eq(schema.tasks.id, task.id)).run();
      const updatedTask = db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get();
      if (io && updatedTask) io.emit("task:updated", { task: updatedTask });
      return `Task *${task.title}* atualizada: ${task.status} → ${newStatus}`;
    }

    case "scan_projects": {
      const { scanWorkspace } = await import("../lib/scanner.js");
      const scanDirs = [
        join(homedir(), "Projects"),
      ].filter(d => existsSync(d));

      const existingPaths = new Set(
        db.select().from(schema.projects).all().map(p => p.path)
      );

      const available: { name: string; path: string; stack: string }[] = [];
      for (const dir of scanDirs) {
        try {
          const found = scanWorkspace(dir);
          for (const p of found) {
            if (!existingPaths.has(p.path)) {
              available.push({ name: p.name, path: p.path, stack: p.stack.slice(0, 3).join(", ") });
            }
          }
        } catch { /* skip */ }
      }

      if (available.length === 0) return "Nenhum projeto novo encontrado para importar.";
      return `*Projetos disponiveis para importar:*\n${available.slice(0, 15).map((p, i) =>
        `${i + 1}. *${p.name}* — ${p.stack || "unknown"}\n   _${p.path}_`
      ).join("\n")}\n\nDiga o nome ou numero do projeto para importar.`;
    }

    case "import_project": {
      const name = (action.name as string)?.trim();
      const path = (action.path as string)?.trim();
      if (!path) return "Caminho do projeto e obrigatorio.";

      const existing = db.select().from(schema.projects).where(eq(schema.projects.path, path)).get();
      if (existing) return `Projeto "${name || path}" ja esta importado.`;

      let stack: string[] = [];
      try {
        const { scanWorkspace } = await import("../lib/scanner.js");
        const parentDir = join(path, "..");
        if (existsSync(parentDir)) {
          const found = scanWorkspace(parentDir);
          const match = found.find((p: { path: string }) => p.path === path);
          if (match) stack = match.stack;
        }
      } catch { /* ignore */ }

      const now = Date.now();
      const importedProject = {
        id: nanoid(), name: name || path.split(/[/\\]/).pop() || "unknown",
        path, stack: JSON.stringify(stack), description: null,
        githubUrl: null, status: "active", createdAt: now, updatedAt: now,
      };
      db.insert(schema.projects).values(importedProject).run();
      if (io) io.emit("project:created", importedProject);

      return `Projeto *${importedProject.name}* importado com sucesso!`;
    }

    case "list_agents": {
      const agents = db.select().from(schema.agents).where(eq(schema.agents.isActive, 1)).all();
      return agents.map((a, i) => `${i + 1}. *${a.name}* — ${a.role}`).join("\n");
    }

    case "project_overview": {
      const projects = db.select().from(schema.projects).all();
      const tasks = db.select().from(schema.tasks).all();
      const agents = db.select().from(schema.agents).where(eq(schema.agents.isActive, 1)).all();
      const done = tasks.filter(t => t.status === "done").length;
      const inProgress = tasks.filter(t => t.status === "in_progress").length;
      return `*Resumo*\nProjetos: ${projects.length}\nTasks: ${tasks.length} (${inProgress} em progresso, ${done} concluidas)\nAgentes ativos: ${agents.length}`;
    }

    default:
      return "Acao nao reconhecida.";
  }
}

/** Create Anthropic client using OAuth token from Claude credentials */
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

/** Conversation history per phone number */
const conversationHistory = new Map<string, { role: string; content: string }[]>();
const MAX_HISTORY = 20;

function getHistory(from: string): { role: string; content: string }[] {
  if (!conversationHistory.has(from)) conversationHistory.set(from, []);
  return conversationHistory.get(from)!;
}

function addToHistory(from: string, role: string, content: string) {
  const history = getHistory(from);
  history.push({ role, content });
  // Keep last N messages to avoid token overflow
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

/** Call Claude API using the official Anthropic SDK */
async function callClaude(systemPrompt: string, messages: { role: string; content: string }[], model: string): Promise<string> {
  const client = createAnthropicClient();
  if (!client) return "Erro: token Claude não encontrado. Execute /login no Claude Code.";

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages as Anthropic.MessageParam[],
    });

    const textParts = response.content.filter((block) => block.type === "text");
    if (textParts.length > 0) {
      return textParts.map((block) => ("text" in block ? block.text : "")).join("");
    }
    return "Desculpe, não consegui processar sua mensagem.";
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

/** Safely extract a serialized WID string from any value */
function serializeWid(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    return value.includes("@") ? value : `${value.replace(/\D/g, "")}@c.us`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj._serialized === "string" && obj._serialized) return obj._serialized;
    if (typeof obj.user === "string" && typeof obj.server === "string") return `${obj.user}@${obj.server}`;
  }
  return null;
}

export class WhatsAppService {
  private client: Whatsapp | null = null;
  private status: ConnectionStatus = "disconnected";
  private allowedNumber: string | null = null;
  private qrCallback: ((qr: string) => void) | null = null;
  private statusCallback: ((status: ConnectionStatus) => void) | null = null;
  private isConnecting = false;
  private _io: { emit: (e: string, d: unknown) => void } | null = null;

  private readonly tokenDir = join(DATA_DIR, "whatsapp-tokens");

  setIo(io: { emit: (e: string, d: unknown) => void }) {
    this._io = io;
  }

  getConnectionStatus(): ConnectionStatus {
    return this.status;
  }

  setAllowedNumber(num: string | undefined) {
    this.allowedNumber = num || null;
  }

  onQr(cb: (qr: string) => void) {
    this.qrCallback = cb;
  }

  onStatusChange(cb: (status: ConnectionStatus) => void) {
    this.statusCallback = cb;
  }

  private setStatus(s: ConnectionStatus) {
    this.status = s;
    this.statusCallback?.(s);
  }

  /** Remove Chromium singleton locks that prevent reconnection */
  private cleanSingletonLocks() {
    const chromiumDataDir = join(this.tokenDir, "session-local");
    if (!existsSync(chromiumDataDir)) return;
    try {
      for (const entry of readdirSync(chromiumDataDir)) {
        if (entry.startsWith("Singleton")) {
          try { unlinkSync(join(chromiumDataDir, entry)); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  async connect(): Promise<void> {
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
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        },
        catchQR: (base64Qr: string) => {
          this.qrCallback?.(base64Qr);
        },
        statusFind: (statusSession: string) => {
          console.log(`[WhatsApp] Session status: ${statusSession}`);
          if (statusSession === "isLogged" || statusSession === "inChat") {
            this.setStatus("connected");
          }
        },
        logQR: false,
      });

      this.client = client;
      this.setStatus("connected");

      // Listen for incoming messages
      client.onMessage((msg) => {
        const from = serializeWid(msg.from);
        if (!from || from.endsWith("@g.us")) return; // ignore groups

        // Filter by allowed number if configured
        if (this.allowedNumber) {
          const normalized = this.allowedNumber.replace(/\D/g, "");
          if (!from.includes(normalized)) return;
        }

        const messageBody = msg.body?.trim();
        console.log(`[WhatsApp] Message from ${from}: ${messageBody?.slice(0, 100)}`);

        if (!messageBody || !client) return;

        // Get Team Lead agent (receptionist) for WhatsApp responses
        const teamLead = db.select().from(schema.agents)
          .where(eq(schema.agents.role, "receptionist")).get();

        if (!teamLead || !teamLead.isActive) return;

        // Build enriched prompt with language + app capabilities
        const allProjects = db.select().from(schema.projects).all();
        const allTasks = db.select().from(schema.tasks).all();
        const projectCount = allProjects.length;
        const taskCount = allTasks.length;
        const agentCount = db.select().from(schema.agents).all().filter(a => a.isActive).length;

        // Include recent tasks with IDs for context
        const recentTasks = allTasks.slice(0, 10).map(t =>
          `  id:${t.id} | "${t.title}" | status:${t.status} | priority:${t.priority}`
        ).join("\n");

        const langSetting = db.select().from(schema.integrations)
          .where(eq(schema.integrations.type, "user_language")).get();
        const userLang = langSetting?.config ?? "pt-BR";
        const langMap: Record<string, string> = {
          "pt-BR": "Portuguese (Brazilian)", "en": "English", "es": "Spanish",
          "fr": "French", "de": "German", "zh": "Chinese", "ja": "Japanese", "ko": "Korean",
        };
        const langName = langMap[userLang] ?? userLang;

        // Check if GitHub is configured
        const ghIntegration = db.select().from(schema.integrations)
          .where(eq(schema.integrations.type, "github")).get();
        const hasGithub = ghIntegration?.config ? !!JSON.parse(ghIntegration.config).token : false;

        const contextBlock = `
LANGUAGE: Always respond in ${langName}. The user's preferred language is ${userLang}.

WHATSAPP FORMATTING RULES (CRITICAL — follow these exactly):
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
${recentTasks ? `\nCURRENT TASKS (use these IDs for advance_status):\n${recentTasks}` : ""}

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
created → pending → assigned → in_progress → review → done
Also: any → cancelled, cancelled → pending, failed → pending/assigned, review → assigned (reject)

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
- "assigned" = available/ready (this is when the workflow actually starts — the "Disponivel" column)
- NEVER use "pending" — use "assigned" for available/ready tasks
- The user may say status names in their language. Map them:
  "backlog/rascunho" → created, "disponivel/pronto/disponivel" → assigned,
  "em progresso" → in_progress, "revisao" → review, "concluido/feito" → done,
  "falhou" → failed, "cancelado" → cancelled
- Always use the English status name in the JSON action

WHEN ADVANCING TASK STATUS:
1. If user doesn't specify which task, use list_tasks to show them and ask which one
2. Map the user's language to the correct English status name
3. Use advance_status with the task ID and English status
`;

        const fullPrompt = teamLead.systemPrompt + "\n" + contextBlock;

        // Add user message to conversation history
        addToHistory(from, "user", messageBody);
        const messages = getHistory(from);

        // Call Claude API with conversation history
        callClaude(fullPrompt, messages, teamLead.model).then(async (reply) => {
          try {
            // Parse action JSON from last line
            const lines = reply.trim().split("\n");
            const lastLine = lines[lines.length - 1].trim();
            let actionResult: string | null = null;

            if (lastLine.startsWith("{")) {
              try {
                const action = JSON.parse(lastLine);
                actionResult = await executeAction(action, this._io ?? undefined);
                // Send text part (without JSON line) + action result
                const textPart = lines.slice(0, -1).join("\n").trim();
                const finalReply = textPart
                  ? `${textPart}\n\n${actionResult}`
                  : actionResult;
                await client.sendText(msg.from as string, finalReply);
              } catch {
                // Not valid JSON, send as-is
                await client.sendText(msg.from as string, reply);
              }
            } else {
              await client.sendText(msg.from as string, reply);
            }
            // Save assistant response to history
            const sentReply = actionResult ? (lines.slice(0, -1).join("\n").trim() + "\n\n" + actionResult).trim() : reply;
            addToHistory(from!, "assistant", sentReply);
            console.log(`[WhatsApp] Replied to ${from}: ${sentReply.slice(0, 100)}`);
          } catch (err) {
            console.error("[WhatsApp] Failed to send reply:", err);
          }
        }).catch(() => {});
      });

    } catch (err) {
      console.error("[WhatsApp] Connection failed:", err);
      this.setStatus("error");
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch { /* ignore */ }
      this.client = null;
    }
    this.setStatus("disconnected");
  }
}

// Singleton
let instance: WhatsAppService | null = null;

export function getWhatsAppService(): WhatsAppService {
  if (!instance) {
    instance = new WhatsAppService();
  }
  return instance;
}

export function resetWhatsAppService() {
  instance = null;
}
