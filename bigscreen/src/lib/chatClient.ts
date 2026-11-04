/**
 * Chat transport for the big screen: thread bootstrap + dashboard WebSocket
 * protocol (same-origin) + automatic HITL approval (big screens never prompt).
 */

import { apiFetch, getToken, UnauthorizedError } from "./auth";
import type { ChatOptions } from "./types";

export interface ChatHandlers {
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

const HITL_POLICY = { mode: "allow_all" } as const;

/** Workspace error carrying the HTTP status (401 is thrown by apiFetch). */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** Parse a JSON body or raise a status-tagged error. */
async function readJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    throw new HttpError(response.status, `${fallback}（${response.status}）`);
  }
  return (await response.json()) as T;
}

// ── Screen session model (ADR 004) ─────────────────────────────────────────
// 用户 × 专家 × screenKey → 一条 session → 一个当前 thread。会话绑定以服务端
// 为准；大屏 localStorage 只保留 UI 偏好，不再作为绑定来源。

export interface ScreenSessionInfo {
  session_key: string;
  thread_id: string | null;
}

export interface CreatedThreadInfo {
  thread_id: string;
  session_key: string;
}

export interface ScreenThreadRow {
  thread_id: string;
  title: string | null;
  summary: string | null;
  session_key: string;
  last_active: number;
  created_at: number;
  pinned: boolean;
  is_active: boolean;
  has_messages: boolean;
}

export interface HistoryMessage {
  id?: string;
  role: string;
  content: unknown;
  timestamp?: number;
  agent_id?: string;
}

export interface ThreadHistoryPage {
  thread_id: string;
  messages: HistoryMessage[];
  has_more: boolean;
  next_cursor: string | null;
  limit: number;
  offset: number;
}

/** GET /agents/{id}/screen-session?screen= — resolve the bound session. */
export async function resolveScreenSession(
  agentId: string,
  screenKey: string,
): Promise<ScreenSessionInfo> {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(
      agentId,
    )}/screen-session?screen=${encodeURIComponent(screenKey)}`,
  );
  return readJson(response, "获取屏会话失败");
}

/** POST /agents/{id}/threads — new thread inside the screen session. */
export async function createScreenThread(
  agentId: string,
  screenKey: string,
): Promise<CreatedThreadInfo> {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/threads`,
    { method: "POST", body: JSON.stringify({ screen_key: screenKey }) },
  );
  return readJson(response, "创建会话失败");
}

/** PATCH /agents/{id}/session — rebind the screen session to a thread. */
export async function rebindScreenSession(
  agentId: string,
  threadId: string,
  screenKey: string,
): Promise<ScreenSessionInfo> {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/session`,
    {
      method: "PATCH",
      body: JSON.stringify({ thread_id: threadId, screen_key: screenKey }),
    },
  );
  return readJson(response, "切换会话失败");
}

export interface ListScreenThreadsOptions {
  screenKey?: string;
  scope?: "screen" | "topic" | "all";
  q?: string;
  limit?: number;
  offset?: number;
}

/** GET /agents/{id}/threads — history list filtered by screen scope. */
export async function listScreenThreads(
  agentId: string,
  options: ListScreenThreadsOptions = {},
): Promise<ScreenThreadRow[]> {
  const params = new URLSearchParams();
  if (options.screenKey) params.set("screen_key", options.screenKey);
  if (options.scope) params.set("scope", options.scope);
  if (options.q) params.set("q", options.q);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined)
    params.set("offset", String(options.offset));
  const query = params.toString();
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/threads${query ? `?${query}` : ""}`,
  );
  return readJson(response, "加载历史会话失败");
}

/** PATCH /agents/{id}/threads/{tid} — pin / unpin a thread. */
export async function setThreadPinned(
  agentId: string,
  threadId: string,
  pinned: boolean,
): Promise<void> {
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(
      threadId,
    )}`,
    { method: "PATCH", body: JSON.stringify({ pinned }) },
  );
  if (!response.ok) {
    throw new HttpError(response.status, `置顶失败（${response.status}）`);
  }
}

/** GET /agents/{id}/threads/{tid}/history — one history page (limit/offset). */
export async function loadThreadHistory(
  agentId: string,
  threadId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<ThreadHistoryPage> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined)
    params.set("offset", String(options.offset));
  const query = params.toString();
  const response = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/threads/${encodeURIComponent(
      threadId,
    )}/history${query ? `?${query}` : ""}`,
  );
  return readJson(response, "加载对话历史失败");
}

// ── S2 page-context injection (navigation only, never filters/data) ─────────

/** Build the S2 weak context line: 「〔当前页：专题/视角（仅供参考…）〕」. */
export function buildPageContext(page: string): string {
  const label = page.trim() || "大屏";
  return `〔当前页：${label}（仅供参考，以用户问题为准）〕`;
}

// ── SSE (HITL resume) ───────────────────────────────────────────────────────

interface Frame {
  type?: string;
  content?: unknown;
  message?: unknown;
  pending_id?: unknown;
  action_requests?: unknown;
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: Frame) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (data) {
        try {
          onFrame(JSON.parse(data) as Frame);
        } catch {
          // Ignore non-JSON keepalive frames.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

// ── Chat session ────────────────────────────────────────────────────────────

export class ChatSession {
  private ws: WebSocket | null = null;
  private pingTimer: number | null = null;
  private active = false;
  private readonly agentId: string;
  private readonly threadId: string;
  private readonly handlers: ChatHandlers;

  constructor(agentId: string, threadId: string, handlers: ChatHandlers) {
    this.agentId = agentId;
    this.threadId = threadId;
    this.handlers = handlers;
  }

  send(text: string, chatOptions?: ChatOptions): void {
    this.close();
    const token = getToken();
    if (!token) {
      this.handlers.onError("未登录");
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${
      window.location.host
    }/api/agents/${encodeURIComponent(
      this.agentId,
    )}/chat/ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.active = true;

    ws.onopen = () => {
      this.startPing();
      const payload: Record<string, unknown> = {
        type: "user_turn",
        text,
        messages: [{ role: "user", content: text }],
        thread_id: this.threadId,
        hitl_policy: HITL_POLICY,
      };
      if (chatOptions?.skills !== undefined)
        payload.skills = chatOptions.skills;
      if (chatOptions?.mcpServers !== undefined) {
        payload.mcp_servers = chatOptions.mcpServers;
      }
      if (chatOptions?.knowledgeBaseIds !== undefined) {
        payload.knowledge_base_ids = chatOptions.knowledgeBaseIds;
      }
      if (chatOptions?.conversationMode) {
        payload.conversation_mode = chatOptions.conversationMode;
      }
      ws.send(JSON.stringify(payload));
    };

    ws.onmessage = (event) => {
      let frame: Frame;
      try {
        frame = JSON.parse(String(event.data)) as Frame;
      } catch {
        return;
      }
      if (!frame || typeof frame !== "object") return;
      switch (frame.type) {
        case "token":
          if (typeof frame.content === "string")
            this.handlers.onDelta(frame.content);
          break;
        case "done":
          this.finish();
          break;
        case "error":
          this.handlers.onError(String(frame.message ?? "对话出错"));
          this.finish();
          break;
        case "hitl_required":
          void this.resumeHitl(frame);
          break;
        default:
          break;
      }
    };

    ws.onerror = () => {
      if (this.active) this.handlers.onError("连接失败，请检查网络");
    };
    ws.onclose = () => {
      this.stopPing();
      if (this.active) this.finish();
    };
  }

  cancel(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(
          JSON.stringify({ type: "cancel", thread_id: this.threadId }),
        );
      } catch {
        // ignore
      }
    }
    this.finish();
  }

  close(): void {
    this.active = false;
    this.stopPing();
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
  }

  /** Auto-approve a paused tool call (big screens are configured to never ask). */
  private async resumeHitl(frame: Frame): Promise<void> {
    const pendingId =
      typeof frame.pending_id === "string" ? frame.pending_id : undefined;
    const actions = Array.isArray(frame.action_requests)
      ? frame.action_requests
      : [];
    const decisions =
      actions.length > 0
        ? actions.map(() => ({ type: "approve" }))
        : [{ type: "approve" }];

    try {
      const response = await apiFetch(
        `/agents/${encodeURIComponent(this.agentId)}/chat/hitl/resume`,
        {
          method: "POST",
          headers: { Accept: "text/event-stream" },
          body: JSON.stringify({
            thread_id: this.threadId,
            decisions,
            ...(pendingId ? { pending_id: pendingId } : {}),
            hitl_policy: HITL_POLICY,
          }),
        },
      );
      if (!response.ok || !response.body) {
        this.handlers.onError(`自动审批失败（${response.status}）`);
        this.finish();
        return;
      }
      await readSse(response.body, (chunk) => {
        if (chunk.type === "token" && typeof chunk.content === "string") {
          this.handlers.onDelta(chunk.content);
        } else if (chunk.type === "done") {
          this.finish();
        } else if (chunk.type === "error") {
          this.handlers.onError(String(chunk.message ?? "自动审批失败"));
          this.finish();
        } else if (chunk.type === "hitl_required") {
          void this.resumeHitl(chunk);
        }
      });
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        this.handlers.onError(error.message);
      } else {
        this.handlers.onError(
          error instanceof Error ? error.message : String(error),
        );
      }
      this.finish();
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          // ignore
        }
      }
    }, 25_000);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private finish(): void {
    if (!this.active) return;
    this.active = false;
    this.stopPing();
    this.handlers.onDone();
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    this.ws = null;
  }
}
