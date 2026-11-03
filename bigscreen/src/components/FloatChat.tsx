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
import type { ChatConfig, FloatChatConfig } from "@/lib/types";
import styles from "@/styles/board.module.css";

interface FloatChatProps {
  chatConfig: ChatConfig;
  float?: FloatChatConfig;
  /** Screen session key (ADR 004 D2) — shared with the board chat slot. */
  screenKey: string;
  pageLabel: string;
}

/**
 * Collapsed pill / expanded overlay chat for secondary pages (D10).
 * Shares the screen session and the same headless chat core as the board chat.
 */
export default function FloatChat({
  chatConfig,
  float,
  screenKey,
  pageLabel,
}: FloatChatProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const chat = useScreenChat({
    agentId: chatConfig.agentId,
    screenKey,
    pageLabel,
    contextInjection: float?.contextInjection ?? chatConfig.contextInjection,
    chatOptions: chatConfig.chatOptions,
  });

  // Stable wrappers (ref-backed) so the history list does not refetch on every
  // streaming delta re-render.
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const handleNew = useCallback(() => {
    setView("chat");
    return chatRef.current.newSession();
  }, []);
  const handleSwitch = useCallback((threadId: string) => {
    return chatRef.current.switchSession(threadId).then(() => {
      setView("chat");
    });
  }, []);
  const handleAuthExpired = useCallback(() => {
    setView("chat");
    void chatRef.current.retry();
  }, []);

  useEffect(() => {
    if (!open || view !== "chat") return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [open, view, chat.messages]);

  const title = float?.title ?? chatConfig.title ?? "演示助手";
  const subtitle =
    float?.subtitle ?? chatConfig.subtitle ?? "循证问答 · 报告生成";

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

  if (!open) {
    return (
      <button
        type="button"
        className={styles.floatPill}
        onClick={() => setOpen(true)}
      >
        <span className={styles.floatRobot} aria-hidden>
          <Robot />
        </span>
        <span className={styles.floatPillText}>
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
        <span className={styles.floatPillAction}>对话</span>
      </button>
    );
  }

  return (
    <section className={styles.floatPanel}>
      {view === "history" && !chat.needLogin ? (
        <>
          <ThreadHistory
            agentId={chatConfig.agentId}
            screenKey={screenKey}
            activeThreadId={chat.threadId}
            variant="float"
            disabled={chat.streaming}
            onClose={() => setView("chat")}
            onNew={handleNew}
            onSwitch={handleSwitch}
            onAuthExpired={handleAuthExpired}
          />
        </>
      ) : (
        <>
          <header className={styles.floatHeader}>
            <div className={styles.floatHeading}>
              <span className={styles.floatRobot} aria-hidden>
                <Robot />
              </span>
              <div>
                <strong>{title}</strong>
                <small>{subtitle}</small>
              </div>
            </div>
            <div className={styles.floatHeaderActions}>
              <button
                type="button"
                className={styles.floatHistoryButton}
                onClick={() => setView("history")}
                aria-label="历史会话"
              >
                历史
              </button>
              <button
                type="button"
                className={styles.floatCollapse}
                onClick={() => setOpen(false)}
              >
                收起
              </button>
            </div>
          </header>

          <div className={styles.floatContext}>当前页：{pageLabel}</div>

          {chat.needLogin ? (
            <LoginOverlay onSuccess={chat.retry} />
          ) : (
            <>
              <div className={styles.chatMessages} ref={listRef}>
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
                {chat.messages.length === 0 ? (
                  <div className={styles.floatEmpty}>
                    <p className={styles.chatWelcomeText}>
                      您好，我是{title}，可依据当前模块已接入数据回答问题。
                    </p>
                    <div className={styles.chatPrompts}>
                      {(
                        float?.quickPrompts ??
                        chatConfig.quickPrompts ??
                        []
                      ).map((prompt) => (
                        <button
                          key={prompt.label}
                          type="button"
                          className={styles.chatPrompt}
                          onClick={() => chat.send(prompt.prompt)}
                        >
                          {prompt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  chat.messages.map((message, index) => (
                    <div
                      key={index}
                      className={styles.messageRow}
                      data-role={message.role}
                    >
                      <div className={styles.bubble}>
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
                          <div className={styles.messageText}>
                            {message.text}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {chat.error ? (
                <div className={styles.chatError}>{chat.error}</div>
              ) : null}

              <form className={styles.chatComposer} onSubmit={onSubmit}>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={`和${title}说点什么吧…`}
                  rows={2}
                />
                {chat.streaming ? (
                  <button
                    type="button"
                    className={styles.stopButton}
                    onClick={chat.stop}
                  >
                    停止
                  </button>
                ) : (
                  <button
                    type="submit"
                    className={styles.sendButton}
                    disabled={!draft.trim() || !chat.threadId}
                  >
                    发送
                  </button>
                )}
              </form>

              <button
                type="button"
                className={styles.floatReport}
                onClick={() => chat.send("根据当前对话生成报告")}
              >
                根据当前对话生成报告
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
