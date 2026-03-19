import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync } from "fs";

// Data directory
const DATA_DIR = join(homedir(), ".agenthub-local");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, "db.sqlite");

// Schema
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  stack: text("stack"),
  description: text("description"),
  githubUrl: text("github_url"),
  status: text("status").default("active").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  model: text("model").notNull().default("claude-sonnet-4-5-20250929"),
  maxThinkingTokens: integer("max_thinking_tokens"),
  systemPrompt: text("system_prompt").notNull(),
  description: text("description").default(""),
  allowedTools: text("allowed_tools"),
  permissionMode: text("permission_mode").default("default"),
  level: text("level").default("senior"),
  color: text("color"),
  avatar: text("avatar"),
  soul: text("soul"),
  isActive: integer("is_active").notNull().default(1),
  isDefault: integer("is_default").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  assignedAgentId: text("assigned_agent_id"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("created"),
  priority: text("priority").notNull().default("medium"),
  category: text("category").default("feature"),
  branch: text("branch"),
  result: text("result"),
  costUsd: text("cost_usd").default("0"),
  tokensUsed: integer("tokens_used").default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at"),
});

export const taskLogs = sqliteTable("task_logs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  agentId: text("agent_id"),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: integer("created_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  taskId: text("task_id"),
  agentId: text("agent_id"),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const agentMemories = sqliteTable("agent_memories", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  taskId: text("task_id"),
  type: text("type").notNull().default("learning"), // learning | correction | pattern | context
  content: text("content").notNull(),
  source: text("source"), // task execution, user feedback, self-reflection
  createdAt: integer("created_at").notNull(),
});

export const docs = sqliteTable("docs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").default(""),
  category: text("category"),
  pinned: integer("pinned").notNull().default(0),
  parentId: text("parent_id"),
  order: integer("order").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const integrations = sqliteTable("integrations", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // whatsapp | telegram
  status: text("status").notNull().default("disconnected"),
  config: text("config"), // JSON: { allowedNumber }
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// Database connection
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Create tables using raw SQL (DDL)
const DDL = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
    stack TEXT, description TEXT, github_url TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
    max_thinking_tokens INTEGER, system_prompt TEXT NOT NULL,
    description TEXT DEFAULT '', allowed_tools TEXT,
    permission_mode TEXT DEFAULT 'default', level TEXT DEFAULT 'senior',
    color TEXT, avatar TEXT, soul TEXT,
    is_active INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
    assigned_agent_id TEXT, title TEXT NOT NULL, description TEXT,
    status TEXT NOT NULL DEFAULT 'created', priority TEXT NOT NULL DEFAULT 'medium',
    category TEXT DEFAULT 'feature', branch TEXT, result TEXT,
    cost_usd TEXT DEFAULT '0', tokens_used INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS task_logs (
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL, agent_id TEXT,
    action TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT,
    agent_id TEXT, role TEXT NOT NULL, content TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_task_logs_task ON task_logs(task_id);
  CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id);
  CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY, type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'disconnected',
    config TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_memories (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, task_id TEXT,
    type TEXT NOT NULL DEFAULT 'learning', content TEXT NOT NULL,
    source TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_memories_agent ON agent_memories(agent_id);
  CREATE TABLE IF NOT EXISTS docs (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT DEFAULT '',
    category TEXT, pinned INTEGER NOT NULL DEFAULT 0,
    parent_id TEXT, "order" INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
`;

for (const stmt of DDL.split(";").filter(s => s.trim())) {
  sqlite.prepare(stmt + ";").run();
}

// Migrations — add new columns to existing tables (safe: IF NOT EXISTS via try/catch)
const MIGRATIONS = [
  "ALTER TABLE agents ADD COLUMN permission_mode TEXT DEFAULT 'default'",
  "ALTER TABLE agents ADD COLUMN level TEXT DEFAULT 'senior'",
  "ALTER TABLE agents ADD COLUMN color TEXT",
  "ALTER TABLE agents ADD COLUMN avatar TEXT",
  "ALTER TABLE agents ADD COLUMN soul TEXT",
];
for (const migration of MIGRATIONS) {
  try { sqlite.prepare(migration).run(); } catch { /* column already exists */ }
}

export const schema = { projects, agents, tasks, taskLogs, messages, integrations, agentMemories, docs };
export const db = drizzle(sqlite, { schema });
export { DATA_DIR };
