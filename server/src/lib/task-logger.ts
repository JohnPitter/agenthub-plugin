/**
 * Persistent task execution logger.
 * Writes logs to ~/.agenthub-local/logs/task-{taskId}.log
 * Also outputs to console for real-time monitoring.
 */

import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const LOGS_DIR = join(homedir(), ".agenthub-local", "logs");

// Ensure logs directory exists
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true });
}

export function taskLog(taskId: string, tag: string, message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${tag}] ${message}\n`;

  // Console output
  console.log(`[${tag}] ${message}`);

  // File output
  try {
    const logFile = join(LOGS_DIR, `task-${taskId.slice(0, 12)}.log`);
    appendFileSync(logFile, line);
  } catch { /* non-critical */ }
}

export function taskError(taskId: string, tag: string, message: string, err?: unknown): void {
  const errMsg = err instanceof Error ? err.message : err ? String(err) : "";
  const full = errMsg ? `${message}: ${errMsg}` : message;
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${tag}] ERROR: ${full}\n`;

  // Console output
  console.error(`[${tag}] ERROR: ${full}`);

  // File output
  try {
    const logFile = join(LOGS_DIR, `task-${taskId.slice(0, 12)}.log`);
    appendFileSync(logFile, line);
  } catch { /* non-critical */ }
}

/** Get the log file path for a task */
export function getTaskLogPath(taskId: string): string {
  return join(LOGS_DIR, `task-${taskId.slice(0, 12)}.log`);
}

/** Get the logs directory path */
export function getLogsDir(): string {
  return LOGS_DIR;
}
