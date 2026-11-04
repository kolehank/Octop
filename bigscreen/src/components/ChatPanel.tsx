import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import LoginOverlay from "./LoginOverlay";
import Robot from "./Robot";
import ThreadHistory from "./ThreadHistory";
import { useScreenChat } from "@/hooks/useScreenChat";
import type { ChatConfig } from "@/lib/types";
import styles from "@/styles/board.module.css";

interface ChatPanelProps {
  /** Screen session key (ADR 004 D2) — the board chat is bound to one screen. */
  screenKey: string;
  /** S2 navigation label, e.g. 「招商引资/在谈项目」. */
  pageLabel: string;
  config: ChatConfig;
}

/** Main (board) agent area: robot + welcome, grouped prompts, composer. */
export default function ChatPanel({
  screenKey,
  pageLabel,
  config,
}: ChatPanelProps) {
  const chat = useScreenChat({
    agentId: config.agentId,
    screenKey,
    pageLabel,
    contextInjection: config.contextInjection,
    chatOptions: config.chatOptions,
  });
  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the latest chat handle in a ref so drawer callbacks stay stable while
  // streaming (otherwise every delta re-render would re-trigger list fetches).
  const chatRef = useRef(chat);
  chatRef.current = chat;

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [chat.messages]);

  const handleNew = useCallback(() => chatRef.current.newSession(), []);
  const handleSwitch = useCallback((threadId: string) => {
    return chatRef.current.switchSession(threadId).then(() => {
      setHistoryOpen(false);
    });
  }, []);
  const handleAuthExpired = useCallback(() => {
    setHistoryOpen(false);
    void chatRef.current.retry();
  }, []);

  const submit = () => {
    const text = draft.trim();
    if (!text || chat.streaming) return;
    chat.send(text);
    setDraft("");
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const title = config.title ?? "演示助手";
  const groups = config.quickGroups ?? [];
  const flatPrompts = config.quickPrompts ?? [];
  const hasMessages = chat.messages.length > 0;

  return (
    <section className={`${styles.panel} ${styles.agentPanel}`}>
      {chat.needLogin ? (
        <LoginOverlay onSuccess={chat.retry} />
      ) : (
        <>
          <div className={styles.chatPanelHeader}>
            <span className={styles.chatPanelTitle}>{title}</span>
            <button
              type="button"
              className={styles.historyEntryButton}
              onClick={() => setHistoryOpen(true)}
              aria-label="历史会话"
            >
              <HistoryIcon />
              历史
            </button>
          </div>

          <div className={styles.agentDialog}>
            <div className={styles.welcomeRow}>
              <Robot />
              <div className={styles.welcome}>
                {config.welcome ??
                  `您好！我是${title}，可以问数、问项目、问政策。`}
              </div>
            </div>

            {!hasMessages ? (
              <div className={styles.suggestions}>
                {groups.map((group) => (
                  <div key={group.title} className={styles.suggestionCard}>
                    <strong className={styles.suggestionLabel}>
                      {group.title}
                    </strong>
                    {group.prompts.map((prompt) => (
                      <button
                        key={prompt.label}
                        type="button"
                        className={styles.presetQuestion}
                        onClick={() => chat.send(prompt.prompt)}
                      >
                        {prompt.label}
                      </button>
                    ))}
                  </div>
                ))}
                {groups.length === 0 && flatPrompts.length > 0 ? (
                  <div className={styles.suggestionCard}>
                    <strong className={styles.suggestionLabel}>推荐问题</strong>
                    {flatPrompts.map((prompt) => (
                      <button
                        key={prompt.label}
                        type="button"
                        className={styles.presetQuestion}
                        onClick={() => chat.send(prompt.prompt)}
                      >
                        {prompt.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className={styles.conversationSpace} ref={listRef}>
              {chat.hasMoreHistory ? (
                <button
                  type="button"
                  className={styles.loadOlderButton}
                  onClick={() => void chat.loadMoreHistory()}
                  disabled={chat.moreLoading}
                >
                  {chat.moreLoading ? "加载中…" : "加载更早消息"}
                </button>
              ) : null}
              {chat.messages.map((message, index) => (
                <div
                  key={index}
                  className={styles.messageRow}
                  data-role={message.role}
                >
                  <div className={styles.messageBubble}>
                    {message.role === "assistant" ? (
                      message.text ? (
                        <div className={styles.messageText}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.text}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <span className={styles.typing}>思考中…</span>
                      )
                    ) : (
                      <div className={styles.messageText}>{message.text}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {chat.error ? (
            <div className={styles.chatError}>{chat.error}</div>
          ) : null}

          <form className={styles.composer} onSubmit={onSubmit}>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`和${title}说点什么吧～`}
              enterKeyHint="send"
            />
            <div className={styles.composerTools}>
              <div className={styles.composerLeading}>
                <button
                  className={styles.composerCircle}
                  type="button"
                  aria-label="功能菜单"
                  title="功能菜单"
                >
                  <PlusIcon />
                </button>
                <button
                  className={styles.composerCircle}
                  type="button"
                  aria-label="快捷指令"
                  title="快捷指令"
                >
                  <BoltIcon />
                </button>
                <button
                  className={styles.composerCircle}
                  type="button"
                  aria-label="添加附件"
                  title="添加附件"
                >
                  <ClipIcon />
                </button>
              </div>
              <div className={styles.composerActions}>
                <span className={styles.inputCount} aria-label="已输入字数">
                  {draft.length}
                </span>
                <button
                  className={styles.composerCircle}
                  type="button"
                  aria-label="扩大输入框"
                  title="扩大输入框"
                >
                  <ExpandIcon />
                </button>
                <button
                  className={`${styles.composerCircle} ${styles.microphone}`}
                  type="button"
                  aria-label="语音输入"
                  title="语音输入"
                >
                  <MicIcon />
                </button>
                {chat.streaming ? (
                  <button
                    type="button"
                    className={styles.sendCircle}
                    onClick={chat.stop}
                  >
                    停止
                  </button>
                ) : (
                  <button
                    type="submit"
                    className={styles.sendCircle}
                    aria-label="发送问题"
                    disabled={!draft.trim() || !chat.threadId}
                  >
                    <SendIcon />
                  </button>
                )}
              </div>
            </div>
          </form>
        </>
      )}

      {historyOpen && !chat.needLogin ? (
        <ThreadHistory
          agentId={config.agentId}
          screenKey={screenKey}
          activeThreadId={chat.threadId}
          variant="drawer"
          disabled={chat.streaming}
          onClose={() => setHistoryOpen(false)}
          onNew={handleNew}
          onSwitch={handleSwitch}
          onAuthExpired={handleAuthExpired}
        />
      ) : null}
    </section>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 6v6l4 2m4-2a8 8 0 1 1-3-6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="m13 2-8 12h6l-1 8 9-13h-6V2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClipIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="m9 12 6-6a4 4 0 0 1 6 6l-8 8a6 6 0 0 1-8-8l8-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect
        x="8"
        y="3"
        width="8"
        height="12"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="m3 11 18-8-7 18-3-7-8-3Z" fill="currentColor" />
      <path d="m11 14 4-5" fill="none" stroke="#c4dbf8" strokeWidth="1.2" />
    </svg>
  );
}
