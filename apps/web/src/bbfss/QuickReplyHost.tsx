import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { T, useGT, useMessages } from "gt-react";
import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "../components/ui/button";
import { Spinner } from "../components/ui/spinner";
import { toastManager } from "../components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { cn, newMessageId } from "../lib/utils";
import { useProject } from "../state/entities";
import { threadEnvironment, useEnvironmentThread } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import {
  DEFAULT_QUICK_REPLY_TIMEOUT_MS,
  dismissBbfssQuickReply,
  selectQuickReplyContextMessages,
  setBbfssQuickReplyDraft,
  shouldPauseQuickReplyTimer,
  stepBbfssQuickReply,
  useBbfssQuickReplyState,
  type QuickReplyEntry,
} from "./quickReplyStore";
import { useBbfssSettings } from "./settings";

const EXPAND_PREVIEW_CHAR_THRESHOLD = 180;

interface QuickReplyCardProps {
  readonly entry: QuickReplyEntry;
  readonly activeIndex: number;
  readonly totalCount: number;
  readonly timeoutMs: number;
}

function QuickReplyCard({ entry, activeIndex, totalCount, timeoutMs }: QuickReplyCardProps) {
  const gt = useGT();
  const messages = useMessages();
  const navigate = useNavigate();
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });

  const threadState = useEnvironmentThread(entry.environmentId, entry.threadId);
  const project = useProject(scopeProjectRef(entry.environmentId, entry.projectId));

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remainingMsRef = useRef(timeoutMs);

  const liveProjection = Option.isSome(threadState.data) ? threadState.data.value : null;
  const liveThread = liveProjection?.thread ?? null;
  const displayTitle = liveThread?.title ?? entry.title;
  const contextMessages = selectQuickReplyContextMessages(liveProjection?.messages ?? null, {
    text: entry.latestMessageText,
    role: entry.latestMessageRole,
  });
  const latestMessage = contextMessages.at(-1) ?? null;
  const canExpand =
    contextMessages.length > 1 ||
    (latestMessage !== null && latestMessage.text.length > EXPAND_PREVIEW_CHAR_THRESHOLD);
  const isLoadingContext =
    contextMessages.length === 0 &&
    (threadState.status === "empty" || threadState.status === "synchronizing");

  const hasDraft = entry.draft.trim().length > 0;
  const isPausedByInteraction = shouldPauseQuickReplyTimer({
    hovered,
    focused,
    expanded,
    sending,
    hasDraft,
    hasError: error !== null,
    windowActive: true,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- auto-dismiss timer synchronized with document focus, visibility, hover, input focus, and draft state
  useEffect(() => {
    if (timeoutMs <= 0 || isPausedByInteraction) {
      return;
    }
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    let startedAtMs: number | null = null;
    let timeoutId: number | null = null;
    let closed = false;

    const clearTimer = () => {
      if (timeoutId === null) return;
      window.clearTimeout(timeoutId);
      timeoutId = null;
    };

    const dismiss = () => {
      if (closed) return;
      closed = true;
      remainingMsRef.current = 0;
      dismissBbfssQuickReply(entry.key);
    };

    const pause = () => {
      if (startedAtMs === null) return;
      remainingMsRef.current = Math.max(0, remainingMsRef.current - (Date.now() - startedAtMs));
      startedAtMs = null;
      clearTimer();
    };

    const start = () => {
      if (closed || startedAtMs !== null) return;
      if (remainingMsRef.current <= 0) {
        dismiss();
        return;
      }
      startedAtMs = Date.now();
      clearTimer();
      timeoutId = window.setTimeout(() => {
        startedAtMs = null;
        dismiss();
      }, remainingMsRef.current);
    };

    const syncVisibility = () => {
      const windowActive = document.visibilityState === "visible" && document.hasFocus();
      if (
        !shouldPauseQuickReplyTimer({
          hovered: false,
          focused: false,
          expanded: false,
          sending: false,
          hasDraft: false,
          hasError: false,
          windowActive,
        })
      ) {
        start();
        return;
      }
      pause();
    };

    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    window.addEventListener("focus", syncVisibility);
    window.addEventListener("blur", syncVisibility);

    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      window.removeEventListener("focus", syncVisibility);
      window.removeEventListener("blur", syncVisibility);
      pause();
      clearTimer();
    };
  }, [entry.key, isPausedByInteraction, timeoutMs]);

  const handleOpenThread = () => {
    dismissBbfssQuickReply(entry.key);
    void navigate({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: entry.environmentId,
        threadId: entry.threadId,
      },
    });
  };

  const submitPrompt = async () => {
    const trimmed = entry.draft.trim();
    if (!trimmed || sending) {
      return;
    }
    setSending(true);
    setError(null);

    const result = await startThreadTurn({
      environmentId: entry.environmentId,
      input: {
        threadId: entry.threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: trimmed,
          attachments: [],
        },
        modelSelection: liveThread?.modelSelection ?? entry.modelSelection,
        runtimeMode: liveThread?.runtimeMode ?? entry.runtimeMode,
        interactionMode: liveThread?.interactionMode ?? entry.interactionMode,
        dispatchMode: "auto",
        createdAt: new Date().toISOString(),
      },
    });

    if (result._tag === "Failure") {
      setSending(false);
      setError(
        thrownErrorMessage(squashAtomCommandFailure(result), messages) ??
          gt("Failed to send follow-up."),
      );
      return;
    }

    setSending(false);
    dismissBbfssQuickReply(entry.key);
    toastManager.add({
      type: "success",
      title: gt("Follow-up sent"),
      description: displayTitle,
      timeout: 2_200,
      data: { hideCopyButton: true },
    });
  };

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitPrompt();
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      dismissBbfssQuickReply(entry.key);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      void submitPrompt();
    }
  };

  return (
    <section
      aria-label={gt("Completed thread quick reply")}
      className="dropdown-glass pointer-events-auto overflow-hidden rounded-xl border border-border/70 text-popover-foreground shadow-xl shadow-black/25"
      data-slot="bbfss-quick-reply-card"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
    >
      <div className="flex items-start gap-2 border-b border-border/50 px-3 py-2.5">
        <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
          <CircleCheckIcon aria-hidden className="size-4 text-success-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm leading-snug font-medium text-foreground">
            {displayTitle}
          </div>
          {project?.title ? (
            <div className="truncate text-2xs text-muted-foreground">{project.title}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {totalCount > 1 ? (
            <div className="mr-1 flex items-center gap-0.5 rounded-md border border-border/60 bg-background/50 px-1 py-0.5">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={gt("Previous completed thread")}
                      size="icon-tiny"
                      variant="ghost-muted"
                      onClick={() => stepBbfssQuickReply(-1)}
                    />
                  }
                >
                  <ChevronLeftIcon className="size-3" />
                </TooltipTrigger>
                <TooltipPopup side="bottom">{gt("Previous")}</TooltipPopup>
              </Tooltip>
              <span className="px-1 text-2xs font-medium text-muted-foreground tabular-nums">
                {activeIndex + 1}/{totalCount}
              </span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      aria-label={gt("Next completed thread")}
                      size="icon-tiny"
                      variant="ghost-muted"
                      onClick={() => stepBbfssQuickReply(1)}
                    />
                  }
                >
                  <ChevronRightIcon className="size-3" />
                </TooltipTrigger>
                <TooltipPopup side="bottom">{gt("Next")}</TooltipPopup>
              </Tooltip>
            </div>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={gt("Open thread")}
                  size="icon-xs"
                  variant="ghost-muted"
                  onClick={handleOpenThread}
                />
              }
            >
              <ArrowUpRightIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">{gt("Open thread")}</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={gt("Dismiss notification")}
                  size="icon-xs"
                  variant="ghost-muted"
                  onClick={() => dismissBbfssQuickReply(entry.key)}
                />
              }
            >
              <XIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">{gt("Dismiss")}</TooltipPopup>
          </Tooltip>
        </div>
      </div>

      <div className="px-3 py-2.5 select-text">
        {isLoadingContext ? (
          <p className="text-xs text-muted-foreground">
            <T>Loading recent reply...</T>
          </p>
        ) : contextMessages.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            <T>Thread completed.</T>
          </p>
        ) : expanded ? (
          <div className="space-y-2">
            <div className="max-h-56 space-y-2 overflow-y-auto overscroll-contain pr-1">
              {contextMessages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "space-y-0.5 text-xs leading-relaxed",
                    message.role === "user" && "rounded-lg bg-muted/45 px-2.5 py-1.5",
                  )}
                >
                  <div className="text-2xs font-medium text-muted-foreground">
                    {message.role === "user" ? <T>You</T> : <T>Assistant</T>}
                  </div>
                  <p className="whitespace-pre-wrap wrap-break-word text-foreground/92">
                    {message.text}
                  </p>
                </div>
              ))}
            </div>
            <button
              type="button"
              aria-expanded
              className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-2xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setExpanded(false)}
            >
              <ChevronUpIcon aria-hidden className="size-3" />
              <T>Collapse</T>
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {latestMessage ? (
              <p className="line-clamp-4 text-xs leading-relaxed whitespace-pre-wrap wrap-break-word text-foreground/92">
                {latestMessage.text}
              </p>
            ) : null}
            {canExpand ? (
              <button
                type="button"
                aria-expanded={false}
                className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-2xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setExpanded(true)}
              >
                <ChevronDownIcon aria-hidden className="size-3" />
                {contextMessages.length > 1
                  ? gt("Show earlier ({count})", { count: contextMessages.length })
                  : gt("Expand")}
              </button>
            ) : null}
          </div>
        )}
      </div>

      <form onSubmit={handleFormSubmit} className="border-t border-border/50 p-2">
        <div className="flex items-end gap-1.5">
          <textarea
            aria-label={gt("Follow-up prompt")}
            className="field-sizing-content max-h-28 min-h-8 flex-1 resize-none rounded-lg border border-input bg-background/85 px-2.5 py-1.5 text-xs leading-normal text-foreground outline-none placeholder:text-muted-foreground/75 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/24 disabled:opacity-60 dark:bg-input/32"
            disabled={sending}
            placeholder={gt("Continue this thread...")}
            rows={1}
            value={entry.draft}
            onChange={(event) => {
              setBbfssQuickReplyDraft(entry.key, event.target.value);
              if (error !== null) {
                setError(null);
              }
            }}
            onKeyDown={handleTextareaKeyDown}
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={gt("Send follow-up")}
                  disabled={sending || !hasDraft}
                  size="icon-sm"
                  type="submit"
                  variant="default"
                />
              }
            >
              {sending ? <Spinner className="size-3.5" /> : <ArrowUpIcon className="size-3.5" />}
            </TooltipTrigger>
            <TooltipPopup side="top">{gt("Send")}</TooltipPopup>
          </Tooltip>
        </div>
        {error !== null ? (
          <p role="alert" className="mt-1.5 px-1 text-2xs text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}

export function BbfssQuickReplyHost({
  timeoutMs = DEFAULT_QUICK_REPLY_TIMEOUT_MS,
}: {
  readonly timeoutMs?: number;
} = {}) {
  const { completionQuickReplyEnabled } = useBbfssSettings();
  const { entries, activeKey } = useBbfssQuickReplyState();

  if (!completionQuickReplyEnabled || entries.length === 0) {
    return null;
  }

  const foundIndex = activeKey ? entries.findIndex((entry) => entry.key === activeKey) : 0;
  const activeIndex = foundIndex >= 0 ? foundIndex : 0;
  const activeEntry = entries[activeIndex];
  if (!activeEntry) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed top-[calc(var(--toast-inset)+var(--toast-header-offset))] right-(--toast-inset) z-100 w-[min(calc(100vw-var(--toast-inset)*2),26rem)] [--toast-header-offset:var(--workspace-topbar-height)] [--toast-inset:--spacing(4)] sm:[--toast-inset:--spacing(8)]"
      data-slot="bbfss-quick-reply-host"
    >
      <QuickReplyCard
        key={activeEntry.key}
        entry={activeEntry}
        activeIndex={activeIndex}
        totalCount={entries.length}
        timeoutMs={timeoutMs}
      />
    </div>
  );
}
