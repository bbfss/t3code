import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";

import type { ThreadNotificationKind } from "../components/ThreadNotificationCoordinator.logic";
import {
  clearAllBbfssQuickReplies,
  closeBbfssQuickReplies,
  enqueueBbfssQuickReply,
} from "./quickReplyStore";
import { isBbfssQuickReplyEnabled, subscribeBbfssSettings } from "./settings";

export {
  clearAllBbfssQuickReplies,
  closeBbfssQuickReplies,
  isBbfssQuickReplyEnabled,
  subscribeBbfssSettings,
};

export function presentBbfssCompletionNotification(input: {
  readonly environmentId: EnvironmentId;
  readonly thread: EnvironmentThreadShell;
  readonly raw: OrchestrationV2ThreadShell;
  readonly kind: ThreadNotificationKind;
  readonly active: {
    readonly environmentId?: EnvironmentId;
    readonly threadId?: ThreadId;
  };
}): boolean {
  if (input.kind !== "completion" || !isBbfssQuickReplyEnabled()) {
    return false;
  }
  if (
    typeof document === "undefined" ||
    document.visibilityState !== "visible" ||
    !document.hasFocus()
  ) {
    return false;
  }
  if (
    input.active.environmentId === input.environmentId &&
    input.active.threadId === input.thread.id
  ) {
    return false;
  }

  enqueueBbfssQuickReply({
    environmentId: input.environmentId,
    threadId: input.thread.id,
    projectId: input.thread.projectId,
    title: input.thread.title,
    latestMessageText: input.raw.latestVisibleMessage?.text ?? null,
    latestMessageRole: input.raw.latestVisibleMessage?.role ?? null,
    runtimeMode: input.thread.runtimeMode,
    interactionMode: input.thread.interactionMode,
    modelSelection: input.thread.modelSelection,
  });
  return true;
}
