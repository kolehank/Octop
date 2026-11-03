import { useCallback, useEffect, useRef, useState } from "react";
import { UnauthorizedError } from "@/lib/auth";
import {
  ChatSession,
  buildPageContext,
  createScreenThread,
  HttpError,
  loadThreadHistory,
  rebindScreenSession,
  resolveScreenSession,
  type ThreadHistoryPage,
  type HistoryMessage,
} from "@/lib/chatClient";
import { isValidScreenKey } from "@/lib/screenKey";
import type { ChatOptions } from "@/lib/types";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

/** Default page size for restored history (ADR 004 D9, 最近 30 条). */
export const HISTORY_PAGE_SIZE = 30;

/** Fixed S2 page-context prefix, e.g. 「〔当前页：××（仅供参考…〕」. */
const PAGE_CONTEXT_PREFIX = /^〔当前页：[^〕]*（仅供参考，以用户问题为准）〕/;

/** Strip the S2 page-context prefix when showing user text (ADR 004 D9). */
export function stripPageContext(text: string): string {
  return text.replace(PAGE_CONTEXT_PREFIX, "").trim();
}

/** Concatenate the visible text blocks of one history message. */
function messageText(entry: HistoryMessage): string {
  const content = entry.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const blocks: string[] = [];
  for (const block of content) {
    if (
      typeof block !== "object" ||
      block === null ||
      typeof (block as { type?: unknown }).type !== "string"
    ) {
      continue;
    }
    const type = (block as { type: string }).type.toLowerCase();
    if (type === "text") {
      const text = String((block as { text?: unknown }).text ?? "");
      if (text) blocks.push(text);
    }
  }
  return blocks.join("\n\n").trim();
}

/**
 * Project history wire messages into big-screen chat bubbles: only user /
 * assistant text, thinking/tool blocks dropped, S2 prefix stripped (ADR D9).
 */
export function convertHistory(messages: HistoryMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const entry of messages) {
    if (entry.role !== "user" && entry.role !== "assistant") continue;
    const text = messageText(entry);
    if (!text.trim()) continue;
    out.push({
      role: entry.role,
      text: entry.role === "user" ? stripPageContext(text) : text,
    });
  }
  return out;
}

interface UseScreenChatOptions {
  agentId: string;
  /** Screen session key (ADR 004 D2) — one session per screen slot. */
  screenKey: string;
  /** Navigation label injected under S2 ("nav"), e.g. 「招商引资/在谈项目」. */
  pageLabel: string;
  contextInjection?: "nav" | "off";
  chatOptions?: ChatOptions;
}

export function useScreenChat({
  agentId,
  screenKey,
  pageLabel,
  contextInjection = "nav",
  chatOptions,
}: UseScreenChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  /** Restored history snapshot (empty for a brand-new session). */
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  /** Wire-message count already loaded, used as the next history offset. */
  const [historyOffset, setHistoryOffset] = useState(0);
  const sessionRef = useRef<ChatSession | null>(null);
  /** Guards session-level operations (boot / new / switch). */
  const loadSeq = useRef(0);
  /** Guards incremental "load older" fetches. */
  const moreSeq = useRef(0);

  const finishLoad = (seq: number) => {
    if (loadSeq.current === seq) setHistoryLoading(false);
  };

  const applyHistory = useCallback((page: ThreadHistoryPage) => {
    const converted = convertHistory(page.messages);
    setHistory(converted);
    setMessages(converted);
    setHasMoreHistory(page.has_more);
    setHistoryOffset((page.offset ?? 0) + page.messages.length);
  }, []);

  /** Boot: resolve the screen session → restore history, or create one. */
  const boot = useCallback(() => {
    setError(null);
    setNeedLogin(false);
    setStreaming(false);
    if (!agentId || agentId.startsWith("TODO")) {
      setError("尚未配置专家（agentId），请在大屏配置中填写真实专家 ID");
      return;
    }
    if (!isValidScreenKey(screenKey)) {
      setError(`无效的屏标识：${screenKey}`);
      return;
    }
    const seq = ++loadSeq.current;
    moreSeq.current += 1;
    setHistoryLoading(true);
    setThreadId(null);
    setHasMoreHistory(false);
    setMoreLoading(false);
    setHistoryOffset(0);

    resolveScreenSession(agentId, screenKey)
      .then((session) => {
        if (!session.thread_id) return null; // 未绑定 → 新建
        return loadThreadHistory(agentId, session.thread_id, {
          limit: HISTORY_PAGE_SIZE,
        }).catch((historyError: unknown) => {
          // Bound thread deleted / no longer owned → treat as unbound.
          if (
            historyError instanceof HttpError &&
            (historyError.status === 404 || historyError.status === 403)
          ) {
            return null;
          }
          throw historyError;
        });
      })
      .then((page: ThreadHistoryPage | null) => {
        if (loadSeq.current !== seq) return;
        if (page) {
          setThreadId(page.thread_id);
          applyHistory(page);
        } else {
          return createScreenThread(agentId, screenKey).then((created) => {
            if (loadSeq.current !== seq) return;
            setThreadId(created.thread_id);
            setHistory([]);
            setMessages([]);
            setHasMoreHistory(false);
          });
        }
      })
      .catch((bootError: unknown) => {
        if (loadSeq.current !== seq) return;
        if (bootError instanceof UnauthorizedError) setNeedLogin(true);
        else
          setError(
            bootError instanceof Error ? bootError.message : String(bootError),
          );
      })
      .finally(() => finishLoad(seq));
  }, [agentId, screenKey, applyHistory]);

  useEffect(() => {
    boot();
    return () => {
      sessionRef.current?.close();
      loadSeq.current += 1;
      moreSeq.current += 1;
    };
  }, [boot]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !threadId) return;
      setError(null);
      setMessages((prev) => [
        ...prev,
        { role: "user", text: trimmed },
        { role: "assistant", text: "" },
      ]);
      loadSeq.current += 1;
      moreSeq.current += 1;
      setMoreLoading(false);
      setStreaming(true);

      const session = new ChatSession(agentId, threadId, {
        onDelta: (delta) =>
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, text: last.text + delta };
            return next;
          }),
        onDone: () => setStreaming(false),
        onError: (message) => {
          setError(message);
          setStreaming(false);
        },
      });
      sessionRef.current = session;

      const context =
        contextInjection === "nav" ? buildPageContext(pageLabel) : undefined;
      session.send(context ? `${context}${trimmed}` : trimmed, chatOptions);
    },
    [agentId, threadId, pageLabel, contextInjection, chatOptions],
  );

  const stop = useCallback(() => {
    sessionRef.current?.cancel();
    setStreaming(false);
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  /** New session: create a fresh thread in this screen session and reset UI. */
  const newSession = useCallback((): Promise<void> => {
    sessionRef.current?.close();
    setStreaming(false);
    setError(null);
    setNeedLogin(false);
    const seq = ++loadSeq.current;
    moreSeq.current += 1;
    setHistoryLoading(true);
    setMoreLoading(false);
    setHasMoreHistory(false);
    setHistoryOffset(0);
    return createScreenThread(agentId, screenKey)
      .then((created) => {
        if (loadSeq.current !== seq) return;
        sessionRef.current?.close();
        setThreadId(created.thread_id);
        setHistory([]);
        setMessages([]);
      })
      .catch((sessionError: unknown) => {
        if (loadSeq.current !== seq) return;
        if (sessionError instanceof UnauthorizedError) setNeedLogin(true);
        else
          setError(
            sessionError instanceof Error
              ? sessionError.message
              : String(sessionError),
          );
        throw sessionError;
      })
      .finally(() => finishLoad(seq));
  }, [agentId, screenKey]);

  /** Switch to a history thread: rebind the screen session, then restore. */
  const switchSession = useCallback(
    (targetThreadId: string): Promise<void> => {
      if (targetThreadId === threadId) return Promise.resolve();
      sessionRef.current?.close();
      setStreaming(false);
      setError(null);
      setNeedLogin(false);
      const seq = ++loadSeq.current;
      moreSeq.current += 1;
      setHistoryLoading(true);
      setMoreLoading(false);
      setHasMoreHistory(false);
      setHistoryOffset(0);
      return rebindScreenSession(agentId, targetThreadId, screenKey)
        .then(() =>
          loadThreadHistory(agentId, targetThreadId, {
            limit: HISTORY_PAGE_SIZE,
          }),
        )
        .then((page) => {
          if (loadSeq.current !== seq) return;
          sessionRef.current?.close();
          setThreadId(page.thread_id);
          applyHistory(page);
        })
        .catch((sessionError: unknown) => {
          if (loadSeq.current !== seq) return;
          if (sessionError instanceof UnauthorizedError) setNeedLogin(true);
          else
            setError(
              sessionError instanceof Error
                ? sessionError.message
                : String(sessionError),
            );
          throw sessionError;
        })
        .finally(() => finishLoad(seq));
    },
    [agentId, screenKey, threadId, applyHistory],
  );

  /** Load an older history page and prepend it (scroll-up paging, ADR D9). */
  const loadMoreHistory = useCallback((): Promise<void> => {
    const current = threadId;
    if (!current || moreLoading) return Promise.resolve();
    const seq = ++moreSeq.current;
    setMoreLoading(true);
    return loadThreadHistory(agentId, current, {
      limit: HISTORY_PAGE_SIZE,
      offset: historyOffset,
    })
      .then((page) => {
        if (moreSeq.current !== seq) return;
        const older = convertHistory(page.messages);
        if (older.length > 0) {
          setHistory((prev) => [...older, ...prev]);
          setMessages((prev) => [...older, ...prev]);
        }
        setHasMoreHistory(page.has_more);
        setHistoryOffset((prev) => prev + page.messages.length);
      })
      .catch((moreError: unknown) => {
        if (moreSeq.current !== seq) return;
        if (moreError instanceof UnauthorizedError) setNeedLogin(true);
        else
          setError(
            moreError instanceof Error ? moreError.message : String(moreError),
          );
        throw moreError;
      })
      .finally(() => {
        if (moreSeq.current === seq) setMoreLoading(false);
      });
  }, [agentId, threadId, historyOffset, moreLoading]);

  return {
    messages,
    streaming,
    error,
    needLogin,
    threadId,
    history,
    historyLoading,
    hasMoreHistory,
    moreLoading,
    send,
    stop,
    clear,
    retry: boot,
    newSession,
    switchSession,
    loadMoreHistory,
  };
}
