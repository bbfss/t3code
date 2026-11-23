import { threadKey } from "@t3tools/client-runtime/state/entities";
import type {
  EnvironmentId,
  ModelSelection,
  OrchestrationV2ConversationMessage,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

/** Matches Base UI's default Toast.Provider timeout used by T3 Code notifications. */
export const DEFAULT_QUICK_REPLY_TIMEOUT_MS = 5_000;
export const MAX_QUICK_REPLY_HISTORY_MESSAGES = 8;

export interface QuickReplyEntry {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly latestMessageText: string | null;
  readonly latestMessageRole: "user" | "assistant" | "system" | null;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly modelSelection: ModelSelection;
  readonly draft: string;
  readonly enqueuedAtMs: number;
}

export interface EnqueueQuickReplyInput {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly latestMessageText: string | null;
  readonly latestMessageRole: "user" | "assistant" | "system" | null;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly modelSelection: ModelSelection;
  readonly nowMs?: number;
}

export interface QuickReplyStoreState {
  readonly entries: ReadonlyArray<QuickReplyEntry>;
  readonly activeKey: string | null;
}

export interface QuickReplyContextMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
}

const EMPTY_STATE: QuickReplyStoreState = Object.freeze({
  entries: Object.freeze([]),
  activeKey: null,
});

const listeners = new Set<() => void>();
let state: QuickReplyStoreState = EMPTY_STATE;

function setState(next: QuickReplyStoreState): void {
  if (next === state) {
    return;
  }
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

export function getBbfssQuickReplySnapshot(): QuickReplyStoreState {
  return state;
}

export function subscribeBbfssQuickReply(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBbfssQuickReplyState(): QuickReplyStoreState {
  return useSyncExternalStore(
    subscribeBbfssQuickReply,
    getBbfssQuickReplySnapshot,
    () => EMPTY_STATE,
  );
}

export function enqueueBbfssQuickReply(input: EnqueueQuickReplyInput): string {
  const key = threadKey({ environmentId: input.environmentId, threadId: input.threadId });
  const enqueuedAtMs = input.nowMs ?? Date.now();
  const existingIndex = state.entries.findIndex((entry) => entry.key === key);

  if (existingIndex >= 0) {
    const existing = state.entries[existingIndex]!;
    const updated: QuickReplyEntry = {
      ...existing,
      projectId: input.projectId,
      title: input.title,
      latestMessageText: input.latestMessageText,
      latestMessageRole: input.latestMessageRole,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
      modelSelection: input.modelSelection,
      enqueuedAtMs,
    };
    const nextEntries = state.entries.with(existingIndex, updated);
    setState({
      entries: nextEntries,
      activeKey: state.activeKey ?? key,
    });
    return key;
  }

  const created: QuickReplyEntry = {
    key,
    environmentId: input.environmentId,
    threadId: input.threadId,
    projectId: input.projectId,
    title: input.title,
    latestMessageText: input.latestMessageText,
    latestMessageRole: input.latestMessageRole,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    modelSelection: input.modelSelection,
    draft: "",
    enqueuedAtMs,
  };
  const nextEntries = [...state.entries, created];
  // Keep the user's current card active while another thread finishes in the background.
  const keepActive =
    state.activeKey !== null && state.entries.some((entry) => entry.key === state.activeKey);
  setState({
    entries: nextEntries,
    activeKey: keepActive ? state.activeKey : key,
  });
  return key;
}

export function dismissBbfssQuickReply(key: string): void {
  const index = state.entries.findIndex((entry) => entry.key === key);
  if (index < 0) {
    return;
  }
  const nextEntries = state.entries.filter((entry) => entry.key !== key);
  if (nextEntries.length === 0) {
    setState(EMPTY_STATE);
    return;
  }
  const nextActiveKey =
    state.activeKey === key
      ? (nextEntries[Math.min(index, nextEntries.length - 1)]?.key ?? null)
      : state.activeKey;
  setState({
    entries: nextEntries,
    activeKey: nextActiveKey,
  });
}

export function closeBbfssQuickReplies(shouldClose: (key: string) => boolean): void {
  if (state.entries.length === 0) {
    return;
  }
  const nextEntries = state.entries.filter((entry) => !shouldClose(entry.key));
  if (nextEntries.length === state.entries.length) {
    return;
  }
  if (nextEntries.length === 0) {
    setState(EMPTY_STATE);
    return;
  }
  const activeStillPresent =
    state.activeKey !== null && nextEntries.some((entry) => entry.key === state.activeKey);
  setState({
    entries: nextEntries,
    activeKey: activeStillPresent ? state.activeKey : nextEntries[0]!.key,
  });
}

export function selectBbfssQuickReply(key: string): void {
  if (state.activeKey === key) {
    return;
  }
  if (!state.entries.some((entry) => entry.key === key)) {
    return;
  }
  setState({
    ...state,
    activeKey: key,
  });
}

export function stepBbfssQuickReply(delta: -1 | 1): void {
  if (state.entries.length <= 1) {
    return;
  }
  const currentIndex = Math.max(
    0,
    state.entries.findIndex((entry) => entry.key === state.activeKey),
  );
  const nextIndex = (currentIndex + delta + state.entries.length) % state.entries.length;
  setState({
    ...state,
    activeKey: state.entries[nextIndex]!.key,
  });
}

export function setBbfssQuickReplyDraft(key: string, draft: string): void {
  const index = state.entries.findIndex((entry) => entry.key === key);
  if (index < 0) {
    return;
  }
  const existing = state.entries[index]!;
  if (existing.draft === draft) {
    return;
  }
  setState({
    ...state,
    entries: state.entries.with(index, { ...existing, draft }),
  });
}

export function clearAllBbfssQuickReplies(): void {
  if (state.entries.length === 0 && state.activeKey === null) {
    return;
  }
  setState(EMPTY_STATE);
}

export function selectQuickReplyContextMessages(
  messages: ReadonlyArray<
    Pick<OrchestrationV2ConversationMessage, "id" | "role" | "text" | "workflowScript">
  > | null,
  fallback: {
    readonly text: string | null;
    readonly role: "user" | "assistant" | "system" | null;
  },
  limit = MAX_QUICK_REPLY_HISTORY_MESSAGES,
): ReadonlyArray<QuickReplyContextMessage> {
  if (messages && messages.length > 0) {
    const visible: QuickReplyContextMessage[] = [];
    for (const message of messages) {
      if (message.role !== "user" && message.role !== "assistant") {
        continue;
      }
      if (message.workflowScript === true) {
        continue;
      }
      const trimmed = message.text.trim();
      if (trimmed.length === 0) {
        continue;
      }
      visible.push({
        id: message.id,
        role: message.role,
        text: trimmed,
      });
    }
    if (visible.length > 0) {
      return visible.slice(-limit);
    }
  }

  const fallbackText = fallback.text?.trim() ?? "";
  if (fallbackText.length === 0) {
    return [];
  }
  return [
    {
      id: "latest-visible-preview",
      role: fallback.role === "user" ? "user" : "assistant",
      text: fallbackText,
    },
  ];
}

export function shouldPauseQuickReplyTimer(input: {
  readonly hovered: boolean;
  readonly focused: boolean;
  readonly expanded: boolean;
  readonly sending: boolean;
  readonly hasDraft: boolean;
  readonly hasError: boolean;
  readonly windowActive: boolean;
}): boolean {
  return (
    input.hovered ||
    input.focused ||
    input.expanded ||
    input.sending ||
    input.hasDraft ||
    input.hasError ||
    !input.windowActive
  );
}
