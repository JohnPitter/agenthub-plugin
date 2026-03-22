/**
 * Server-side in-memory store for agent execution state.
 * Survives page refreshes — frontend fetches this on mount.
 * Updated by task-executor (v1) and task-executor-v2 via socket events.
 */

// ─── Types ───

export interface AgentExecutionState {
  agentId: string;
  agentRole: string;
  agentName: string;
  status: "running" | "idle" | "error" | "done";
  taskId: string;
  taskTitle: string;
  progress: number;
  currentFile: string;
  currentTool: string;
  lastActivity: number;
}

export interface V2TaskState {
  taskId: string;
  complexity: string;
  plan: string;
  phases: {
    agents: string[];
    parallel: boolean;
    status: "pending" | "running" | "done";
  }[];
  agentProgress: Record<string, {
    progress: number;
    status: string;
    currentFile: string;
  }>;
  startedAt: number;
}

// ─── In-memory stores ───

const agentStates = new Map<string, AgentExecutionState>();
const v2TaskStates = new Map<string, V2TaskState>();

// ─── Agent state operations ───

export function updateAgentState(agentId: string, update: Partial<AgentExecutionState>): void {
  const current = agentStates.get(agentId) ?? {
    agentId,
    agentRole: "",
    agentName: "",
    status: "idle" as const,
    taskId: "",
    taskTitle: "",
    progress: 0,
    currentFile: "",
    currentTool: "",
    lastActivity: Date.now(),
  };
  agentStates.set(agentId, { ...current, ...update, lastActivity: Date.now() });
}

export function clearAgentState(agentId: string): void {
  agentStates.delete(agentId);
}

export function getAgentStates(): Record<string, AgentExecutionState> {
  const result: Record<string, AgentExecutionState> = {};
  agentStates.forEach((state, id) => {
    // Only return active agents (running/error), not idle
    if (state.status === "running" || state.status === "error") {
      result[id] = state;
    }
  });
  return result;
}

// ─── V2 task state operations ───

export function setV2TaskState(taskId: string, state: V2TaskState): void {
  v2TaskStates.set(taskId, state);
}

export function updateV2PhaseStatus(taskId: string, phaseIndex: number, status: "pending" | "running" | "done"): void {
  const state = v2TaskStates.get(taskId);
  if (state && state.phases[phaseIndex]) {
    state.phases[phaseIndex].status = status;
  }
}

export function updateV2AgentProgress(taskId: string, agentRole: string, progress: number, status: string, currentFile: string): void {
  const state = v2TaskStates.get(taskId);
  if (state) {
    state.agentProgress[agentRole] = { progress, status, currentFile };
  }
}

export function clearV2TaskState(taskId: string): void {
  v2TaskStates.delete(taskId);
}

export function getV2TaskStates(): Record<string, V2TaskState> {
  const result: Record<string, V2TaskState> = {};
  v2TaskStates.forEach((state, id) => {
    result[id] = state;
  });
  return result;
}

// ─── Full activity response (for /api/agents/activity) ───

export function getFullActivityState(): {
  agents: Record<string, AgentExecutionState>;
  v2Tasks: Record<string, V2TaskState>;
} {
  return {
    agents: getAgentStates(),
    v2Tasks: getV2TaskStates(),
  };
}
