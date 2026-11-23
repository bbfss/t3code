import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../test/render";

const mockState = vi.hoisted(() => ({
  startTurn: vi.fn(),
  threadMessages: [] as Array<{
    readonly id: string;
    readonly role: "user" | "assistant" | "system";
    readonly text: string;
  }>,
  projectTitle: "t3code" as string | null,
}));

vi.mock("../state/use-orchestration-command", () => ({
  useOrchestrationCommand: () => mockState.startTurn,
}));

vi.mock("../state/threads", () => ({
  threadEnvironment: {
    startTurn: { label: "test:start-turn" },
  },
  useEnvironmentThread: (environmentId: EnvironmentId | null, threadId: ThreadId | null) => ({
    status: "live",
    data:
      environmentId && threadId && mockState.threadMessages.length > 0
        ? Option.some({
            thread: {
              id: threadId,
              title: "Background build",
              runtimeMode: "full-access",
              interactionMode: "default",
              modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
            },
            messages: mockState.threadMessages,
          })
        : Option.none(),
    error: Option.none(),
    history: { hasMoreHistory: false, historyCursor: null, latestLocalTurnOrdinal: null },
    sequence: 1,
  }),
}));

vi.mock("../state/entities", () => ({
  useProject: () => (mockState.projectTitle ? { title: mockState.projectTitle } : null),
}));

import { BbfssSettingsPanel } from "./BbfssSettingsPanel";
import { presentBbfssCompletionNotification } from "./notificationBridge";
import { BbfssQuickReplyHost } from "./QuickReplyHost";
import {
  clearAllBbfssQuickReplies,
  DEFAULT_QUICK_REPLY_TIMEOUT_MS,
  enqueueBbfssQuickReply,
  getBbfssQuickReplySnapshot,
} from "./quickReplyStore";
import { isBbfssQuickReplyEnabled, resetBbfssSettings } from "./settings";

const ENV_ONE = EnvironmentId.make("env-1");
const PROJECT_ONE = ProjectId.make("proj-1");
const MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
} as const;

function enqueueSample(id: string, title: string, preview: string) {
  return enqueueBbfssQuickReply({
    environmentId: ENV_ONE,
    threadId: ThreadId.make(id),
    projectId: PROJECT_ONE,
    title,
    latestMessageText: preview,
    latestMessageRole: "assistant",
    runtimeMode: "full-access",
    interactionMode: "default",
    modelSelection: MODEL_SELECTION,
    nowMs: 1_000,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetBbfssSettings();
  clearAllBbfssQuickReplies();
  mockState.threadMessages = [];
  mockState.projectTitle = "t3code";
  mockState.startTurn.mockResolvedValue(AsyncResult.success({ sequence: 2 }));
});

afterEach(() => {
  clearAllBbfssQuickReplies();
  resetBbfssSettings();
});

it("shows prior context, expands earlier messages, and sends a follow-up without switching routes", async () => {
  mockState.threadMessages = [
    { id: MessageId.make("m1"), role: "user", text: "Fix the notification badge test" },
    { id: MessageId.make("m2"), role: "assistant", text: "Fixed and verified all 8 assertions." },
  ];
  enqueueSample("thread-a", "Background build", "Fixed and verified all 8 assertions.");

  await using screen = await render(<BbfssQuickReplyHost timeoutMs={0} />, {
    router: "/env-1/current-thread",
  });

  await expect.element(screen.getByText("Background build")).toBeVisible();
  await expect.element(screen.getByText("Fixed and verified all 8 assertions.")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: /Show earlier/i }));
  await expect.element(screen.getByText("Fix the notification badge test")).toBeVisible();

  const input = screen.getByRole("textbox", { name: "Follow-up prompt" });
  await input.fill("Now run typecheck too");

  // IME composition Enter must not submit prematurely.
  const composingEnter = new KeyboardEvent("keydown", {
    key: "Enter",
    isComposing: true,
    keyCode: 229,
    bubbles: true,
    cancelable: true,
  });
  await act(() => input.element().dispatchEvent(composingEnter));
  expect(mockState.startTurn).not.toHaveBeenCalled();

  await userEvent.keyboard("{Enter}");

  await vi.waitFor(() => expect(mockState.startTurn).toHaveBeenCalledTimes(1));
  expect(mockState.startTurn).toHaveBeenCalledWith(
    expect.objectContaining({
      environmentId: ENV_ONE,
      input: expect.objectContaining({
        threadId: ThreadId.make("thread-a"),
        dispatchMode: "auto",
        message: expect.objectContaining({
          role: "user",
          text: "Now run typecheck too",
          attachments: [],
        }),
      }),
    }),
  );
  // Stays on the active thread instead of navigating away.
  expect(screen.router?.state.location.pathname).toBe("/env-1/current-thread");
  expect(getBbfssQuickReplySnapshot().entries).toHaveLength(0);
});

it("keeps the draft and displays an inline error when follow-up dispatch fails", async () => {
  mockState.startTurn.mockResolvedValueOnce(
    AsyncResult.failure(Cause.fail(new Error("Server disconnected"))),
  );
  enqueueSample("thread-err", "Deploy check", "Ready for final confirmation.");

  await using screen = await render(<BbfssQuickReplyHost timeoutMs={0} />, {
    router: "/env-1/current-thread",
  });

  const input = screen.getByRole("textbox", { name: "Follow-up prompt" });
  await input.fill("Proceed with deploy");
  await userEvent.keyboard("{Enter}");

  await expect.element(screen.getByRole("alert")).toHaveTextContent("Server disconnected");
  await expect.element(input).toHaveValue("Proceed with deploy");
  expect(getBbfssQuickReplySnapshot().entries).toHaveLength(1);
});

it("auto-dismisses after the default T3 toast timeout when untouched and pauses while typing", async () => {
  using _timers = fakeTimers();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  enqueueSample("thread-auto", "Idle thread", "Task finished cleanly.");

  await using screen = await render(<BbfssQuickReplyHost />, {
    router: "/env-1/current-thread",
  });

  await expect.element(screen.getByText("Idle thread")).toBeVisible();
  await act(() => {
    vi.advanceTimersByTime(DEFAULT_QUICK_REPLY_TIMEOUT_MS - 500);
  });
  await expect.element(screen.getByText("Idle thread")).toBeVisible();

  await act(() => {
    vi.advanceTimersByTime(600);
  });
  expect(getBbfssQuickReplySnapshot().entries).toHaveLength(0);

  // Enqueue another thread and focus/type: it must stay open well past the timeout.
  await act(() => {
    enqueueSample("thread-paused", "Paused thread", "Waiting for next prompt.");
  });
  const input = screen.getByRole("textbox", { name: "Follow-up prompt" });
  await input.fill("Keep going");
  await act(() => {
    vi.advanceTimersByTime(DEFAULT_QUICK_REPLY_TIMEOUT_MS * 3);
  });
  await expect.element(screen.getByText("Paused thread")).toBeVisible();
});

it("navigates across queued completed threads without stacking multiple cards", async () => {
  enqueueSample("thread-1", "First completed", "First summary");
  enqueueSample("thread-2", "Second completed", "Second summary");

  await using screen = await render(<BbfssQuickReplyHost timeoutMs={0} />, {
    router: "/env-1/current-thread",
  });

  await expect.element(screen.getByText("First completed")).toBeVisible();
  await expect.element(screen.getByText("1/2")).toBeVisible();

  await userEvent.click(screen.getByRole("button", { name: "Next completed thread" }));
  await expect.element(screen.getByText("Second completed")).toBeVisible();
  await expect.element(screen.getByText("2/2")).toBeVisible();
});

it("toggles quick reply on and off from the bbfss settings panel", async () => {
  await using screen = await render(<BbfssSettingsPanel />, {
    router: "/settings/bbfss",
  });

  const toggle = page.getByRole("switch", { name: "会话完成快捷续聊弹窗" });
  await expect.element(toggle).toHaveAttribute("aria-checked", "true");

  await userEvent.click(toggle);
  await expect.element(toggle).toHaveAttribute("aria-checked", "false");
  expect(isBbfssQuickReplyEnabled()).toBe(false);

  await userEvent.click(toggle);
  await expect.element(toggle).toHaveAttribute("aria-checked", "true");
  expect(isBbfssQuickReplyEnabled()).toBe(true);
});

it("intercepts foreground completion notifications only when enabled and ignores active thread", () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const thread = {
    id: ThreadId.make("thread-bg"),
    projectId: PROJECT_ONE,
    title: "Background job",
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    modelSelection: MODEL_SELECTION,
  };
  const raw = {
    latestVisibleMessage: {
      id: MessageId.make("m-bg"),
      role: "assistant" as const,
      text: "Done building artifacts.",
      updatedAt: null,
    },
  };

  // Active thread is ignored so the user is not interrupted where they already are.
  expect(
    presentBbfssCompletionNotification({
      environmentId: ENV_ONE,
      thread: thread as never,
      raw: raw as never,
      kind: "completion",
      active: { environmentId: ENV_ONE, threadId: ThreadId.make("thread-bg") },
    }),
  ).toBe(false);

  // Background completion is intercepted and queued with its latest reply preview.
  expect(
    presentBbfssCompletionNotification({
      environmentId: ENV_ONE,
      thread: thread as never,
      raw: raw as never,
      kind: "completion",
      active: { environmentId: ENV_ONE, threadId: ThreadId.make("thread-other") },
    }),
  ).toBe(true);
  expect(getBbfssQuickReplySnapshot().entries[0]?.latestMessageText).toBe(
    "Done building artifacts.",
  );

  // Non-completion notifications fall through to the stock notification path.
  expect(
    presentBbfssCompletionNotification({
      environmentId: ENV_ONE,
      thread: thread as never,
      raw: raw as never,
      kind: "attention",
      active: { environmentId: ENV_ONE, threadId: ThreadId.make("thread-other") },
    }),
  ).toBe(false);
});
