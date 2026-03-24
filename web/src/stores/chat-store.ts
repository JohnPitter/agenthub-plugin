import { create } from "zustand";
import type { Message, AgentStatus } from "../shared";

interface AgentActivityInfo {
  status: AgentStatus;
  currentTask?: string;
  currentFile?: string;
  lastActivity: number;
  taskId?: string;
  progress: number;
}

interface ChatState {
  messages: Message[];
  streamingAgents: Set<string>;
  agentActivity: Map<string, AgentActivityInfo>;
  isLoadingMessages: boolean;
  hasMoreMessages: boolean;
  activeThread: Message | null;
  threadReplies: Message[];

  addMessage: (message: Message) => void;
  addMessages: (messages: Message[], prepend?: boolean) => void;
  setStreamingAgent: (agentId: string, isStreaming: boolean) => void;
  updateAgentActivity: (agentId: string, update: Partial<AgentActivityInfo>) => void;
  clearAgentActivity: () => void;
  setLoadingMessages: (loading: boolean) => void;
  setHasMoreMessages: (hasMore: boolean) => void;
  clearMessages: () => void;
  setActiveThread: (message: Message | null) => void;
  setThreadReplies: (replies: Message[]) => void;
  addThreadReply: (reply: Message) => void;
  incrementReplyCount: (messageId: string) => void;
}

/* ─── SessionStorage helpers for agentActivity persistence ─── */
const ACTIVITY_STORAGE_KEY = "agenthub:agentActivity";

function loadActivityFromStorage(): Map<string, AgentActivityInfo> {
  try {
    const raw = sessionStorage.getItem(ACTIVITY_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, AgentActivityInfo>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function saveActivityToStorage(activity: Map<string, AgentActivityInfo>): void {
  try {
    const obj: Record<string, AgentActivityInfo> = {};
    for (const [k, v] of activity) obj[k] = v;
    sessionStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(obj));
  } catch { /* storage full or unavailable */ }
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  streamingAgents: new Set(),
  agentActivity: loadActivityFromStorage(),
  isLoadingMessages: false,
  hasMoreMessages: true,
  activeThread: null,
  threadReplies: [],

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  addMessages: (messages, prepend = false) =>
    set((state) => ({
      messages: prepend
        ? [...messages, ...state.messages]
        : [...state.messages, ...messages],
    })),

  setStreamingAgent: (agentId, isStreaming) =>
    set((state) => {
      const next = new Set(state.streamingAgents);
      if (isStreaming) next.add(agentId);
      else next.delete(agentId);
      return { streamingAgents: next };
    }),

  updateAgentActivity: (agentId, update) =>
    set((state) => {
      const next = new Map(state.agentActivity);
      const current = next.get(agentId) ?? { status: "idle" as const, lastActivity: Date.now(), progress: 0 };
      const updated = { ...current, ...update };
      // Skip update if nothing changed (avoid unnecessary re-renders + storage writes)
      if (current.status === updated.status && current.progress === updated.progress && current.currentTask === updated.currentTask && current.currentFile === updated.currentFile) {
        return state;
      }
      next.set(agentId, updated);
      saveActivityToStorage(next);
      return { agentActivity: next };
    }),

  clearAgentActivity: () => {
    saveActivityToStorage(new Map());
    set({ agentActivity: new Map() });
  },

  setLoadingMessages: (loading) => set({ isLoadingMessages: loading }),
  setHasMoreMessages: (hasMore) => set({ hasMoreMessages: hasMore }),
  clearMessages: () => set({ messages: [], hasMoreMessages: true, activeThread: null, threadReplies: [] }),

  setActiveThread: (message) => set({ activeThread: message, threadReplies: [] }),
  setThreadReplies: (replies) => set({ threadReplies: replies }),
  addThreadReply: (reply) =>
    set((state) => ({ threadReplies: [...state.threadReplies, reply] })),
  incrementReplyCount: (messageId) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, replyCount: (m.replyCount ?? 0) + 1 } : m,
      ),
    })),
}));
