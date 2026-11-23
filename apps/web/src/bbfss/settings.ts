import { useSyncExternalStore } from "react";

export const BBFSS_SETTINGS_STORAGE_KEY = "t3code.bbfss.settings.v1";

export interface BbfssSettings {
  readonly completionQuickReplyEnabled: boolean;
}

export const DEFAULT_BBFSS_SETTINGS: BbfssSettings = Object.freeze({
  completionQuickReplyEnabled: true,
});

const listeners = new Set<() => void>();
let snapshot: BbfssSettings = readStoredSettings();
let storageListenerAttached = false;

function readStoredSettings(): BbfssSettings {
  if (typeof window === "undefined") {
    return DEFAULT_BBFSS_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(BBFSS_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_BBFSS_SETTINGS;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_BBFSS_SETTINGS;
    }
    const record = parsed as Record<string, unknown>;
    return {
      completionQuickReplyEnabled:
        typeof record.completionQuickReplyEnabled === "boolean"
          ? record.completionQuickReplyEnabled
          : DEFAULT_BBFSS_SETTINGS.completionQuickReplyEnabled,
    };
  } catch {
    return DEFAULT_BBFSS_SETTINGS;
  }
}

function writeStoredSettings(next: BbfssSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(BBFSS_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota or private-mode restrictions; keep in-memory state.
  }
}

function sameSettings(left: BbfssSettings, right: BbfssSettings): boolean {
  return left.completionQuickReplyEnabled === right.completionQuickReplyEnabled;
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function handleStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== BBFSS_SETTINGS_STORAGE_KEY) {
    return;
  }
  const next = readStoredSettings();
  if (sameSettings(snapshot, next)) {
    return;
  }
  snapshot = next;
  emit();
}

function syncStorageSubscription(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (listeners.size > 0 && !storageListenerAttached) {
    window.addEventListener("storage", handleStorageEvent);
    storageListenerAttached = true;
  } else if (listeners.size === 0 && storageListenerAttached) {
    window.removeEventListener("storage", handleStorageEvent);
    storageListenerAttached = false;
  }
}

export function getBbfssSettings(): BbfssSettings {
  return snapshot;
}

export function isBbfssQuickReplyEnabled(): boolean {
  return snapshot.completionQuickReplyEnabled;
}

export function updateBbfssSettings(patch: Partial<BbfssSettings>): void {
  const next: BbfssSettings = {
    ...snapshot,
    ...patch,
  };
  if (sameSettings(snapshot, next)) {
    return;
  }
  snapshot = next;
  writeStoredSettings(next);
  emit();
}

export function resetBbfssSettings(): void {
  snapshot = DEFAULT_BBFSS_SETTINGS;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(BBFSS_SETTINGS_STORAGE_KEY);
    } catch {
      // Ignore storage restrictions.
    }
  }
  emit();
}

export function subscribeBbfssSettings(listener: () => void): () => void {
  listeners.add(listener);
  syncStorageSubscription();
  return () => {
    listeners.delete(listener);
    syncStorageSubscription();
  };
}

export function useBbfssSettings(): BbfssSettings {
  return useSyncExternalStore(
    subscribeBbfssSettings,
    getBbfssSettings,
    () => DEFAULT_BBFSS_SETTINGS,
  );
}
