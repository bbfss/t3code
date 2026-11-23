import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  clearAllBbfssQuickReplies,
  closeBbfssQuickReplies,
  dismissBbfssQuickReply,
  enqueueBbfssQuickReply,
  getBbfssQuickReplySnapshot,
  selectBbfssQuickReply,
  selectQuickReplyContextMessages,
  setBbfssQuickReplyDraft,
  shouldPauseQuickReplyTimer,
  stepBbfssQuickReply,
} from "./quickReplyStore";
import {
  DEFAULT_BBFSS_SETTINGS,
  getBbfssSettings,
  isBbfssQuickReplyEnabled,
  resetBbfssSettings,
  subscribeBbfssSettings,
  updateBbfssSettings,
} from "./settings";

const ENV_ONE = EnvironmentId.make("env-1");
const ENV_TWO = EnvironmentId.make("env-2");
const PROJECT_ONE = ProjectId.make("proj-1");
const MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
} as const;

function makeEntryInput(overrides: {
  readonly environmentId?: EnvironmentId;
  readonly threadId: string;
  readonly title?: string;
  readonly latestMessageText?: string | null;
  readonly nowMs?: number;
}) {
  return {
    environmentId: overrides.environmentId ?? ENV_ONE,
    threadId: ThreadId.make(overrides.threadId),
    projectId: PROJECT_ONE,
    title: overrides.title ?? `Thread ${overrides.threadId}`,
    latestMessageText: overrides.latestMessageText ?? `Summary for ${overrides.threadId}`,
    latestMessageRole: "assistant" as const,
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    modelSelection: MODEL_SELECTION,
    nowMs: overrides.nowMs ?? 1_000,
  };
}

describe("bbfss settings", () => {
  beforeEach(() => {
    resetBbfssSettings();
  });

  it("defaults to enabled and notifies subscribers on toggle", () => {
    expect(getBbfssSettings()).toEqual(DEFAULT_BBFSS_SETTINGS);
    expect(isBbfssQuickReplyEnabled()).toBe(true);

    let notifications = 0;
    const unsubscribe = subscribeBbfssSettings(() => {
      notifications += 1;
    });

    updateBbfssSettings({ completionQuickReplyEnabled: false });
    expect(isBbfssQuickReplyEnabled()).toBe(false);
    expect(notifications).toBe(1);

    // Identical patch does not emit redundant updates.
    updateBbfssSettings({ completionQuickReplyEnabled: false });
    expect(notifications).toBe(1);

    updateBbfssSettings({ completionQuickReplyEnabled: true });
    expect(isBbfssQuickReplyEnabled()).toBe(true);
    expect(notifications).toBe(2);

    unsubscribe();
  });
});

describe("bbfss quick reply store", () => {
  beforeEach(() => {
    clearAllBbfssQuickReplies();
  });

  it("keeps the active card steady when additional threads finish and preserves per-thread drafts", () => {
    const firstKey = enqueueBbfssQuickReply(makeEntryInput({ threadId: "t-1", nowMs: 1_000 }));
    setBbfssQuickReplyDraft(firstKey, "run unit tests next");

    const secondKey = enqueueBbfssQuickReply(makeEntryInput({ threadId: "t-2", nowMs: 2_000 }));
    expect(getBbfssQuickReplySnapshot().activeKey).toBe(firstKey);
    expect(getBbfssQuickReplySnapshot().entries).toHaveLength(2);

    // Re-enqueuing an existing thread updates its preview while keeping the user's draft.
    enqueueBbfssQuickReply(
      makeEntryInput({ threadId: "t-1", latestMessageText: "Updated output", nowMs: 3_000 }),
    );
    const firstEntry = getBbfssQuickReplySnapshot().entries.find((item) => item.key === firstKey);
    expect(firstEntry?.latestMessageText).toBe("Updated output");
    expect(firstEntry?.draft).toBe("run unit tests next");

    stepBbfssQuickReply(1);
    expect(getBbfssQuickReplySnapshot().activeKey).toBe(secondKey);
    stepBbfssQuickReply(-1);
    expect(getBbfssQuickReplySnapshot().activeKey).toBe(firstKey);

    selectBbfssQuickReply(secondKey);
    dismissBbfssQuickReply(secondKey);
    expect(getBbfssQuickReplySnapshot().activeKey).toBe(firstKey);
    expect(getBbfssQuickReplySnapshot().entries).toHaveLength(1);
  });

  it("closes matching threads across environments cleanly", () => {
    const keyOne = enqueueBbfssQuickReply(
      makeEntryInput({ environmentId: ENV_ONE, threadId: "t-1" }),
    );
    const keyTwo = enqueueBbfssQuickReply(
      makeEntryInput({ environmentId: ENV_TWO, threadId: "t-2" }),
    );

    closeBbfssQuickReplies((key) => key === keyOne);
    expect(getBbfssQuickReplySnapshot().entries.map((entry) => entry.key)).toEqual([keyTwo]);
    expect(getBbfssQuickReplySnapshot().activeKey).toBe(keyTwo);

    closeBbfssQuickReplies(() => true);
    expect(getBbfssQuickReplySnapshot().entries).toEqual([]);
    expect(getBbfssQuickReplySnapshot().activeKey).toBeNull();
  });

  it("selects visible user/assistant context messages and falls back to latestVisibleMessage", () => {
    expect(
      selectQuickReplyContextMessages(null, {
        text: "  Finished refactoring the router.  ",
        role: "assistant",
      }),
    ).toEqual([
      {
        id: "latest-visible-preview",
        role: "assistant",
        text: "Finished refactoring the router.",
      },
    ]);

    const messages = [
      { id: MessageId.make("m1"), role: "system" as const, text: "system note" },
      {
        id: MessageId.make("m2"),
        role: "user" as const,
        text: "workflow script",
        workflowScript: true,
      },
      { id: MessageId.make("m3"), role: "user" as const, text: "Check failing tests" },
      { id: MessageId.make("m4"), role: "assistant" as const, text: "   " },
      { id: MessageId.make("m5"), role: "assistant" as const, text: "All 12 tests now pass." },
    ];
    expect(selectQuickReplyContextMessages(messages, { text: "fallback", role: "assistant" }, 2)).toEqual(
      [
        { id: MessageId.make("m3"), role: "user", text: "Check failing tests" },
        { id: MessageId.make("m5"), role: "assistant", text: "All 12 tests now pass." },
      ],
    );
  });

  it("pauses auto-dismiss whenever the user interacts or leaves the window", () => {
    const idle = {
      hovered: false,
      focused: false,
      expanded: false,
      sending: false,
      hasDraft: false,
      hasError: false,
      windowActive: true,
    };
    expect(shouldPauseQuickReplyTimer(idle)).toBe(false);
    expect(shouldPauseQuickReplyTimer({ ...idle, hovered: true })).toBe(true);
    expect(shouldPauseQuickReplyTimer({ ...idle, focused: true })).toBe(true);
    expect(shouldPauseQuickReplyTimer({ ...idle, expanded: true })).toBe(true);
    expect(shouldPauseQuickReplyTimer({ ...idle, sending: true })).toBe(true);
    expect(shouldPauseQuickReplyTimer({ ...idle, hasDraft: true })).toBe(true);
    expect(shouldPauseQuickReplyTimer({ ...idle, hasError: true })).toBe(true);
    expect(shouldPauseQuickReplyTimer({ ...idle, windowActive: false })).toBe(true);
  });
});
