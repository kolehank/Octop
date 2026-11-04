import { useCallback, useEffect, useRef, useState } from "react";
import { UnauthorizedError } from "@/lib/auth";
import {
  listScreenThreads,
  setThreadPinned,
  type ScreenThreadRow,
} from "@/lib/chatClient";
import {
  formatHistoryDate,
  formatHistoryTime,
  getServerTimezone,
  historyGroup,
  type HistoryGroupKey,
} from "@/lib/serverTime";
import styles from "@/styles/board.module.css";

type HistoryScope = "screen" | "topic" | "all";

const SCOPE_TABS: Array<{ key: HistoryScope; label: string }> = [
  { key: "screen", label: "当前屏" },
  { key: "topic", label: "本专题" },
  { key: "all", label: "全部" },
];

const GROUP_LABELS: Record<HistoryGroupKey, string> = {
  today: "今天",
  yesterday: "昨天",
  earlier: "更早",
};

const DEFAULT_TIME_ZONE = "Asia/Shanghai";

interface ThreadHistoryProps {
  agentId: string;
  screenKey: string;
  activeThreadId: string | null;
  /** Drawer overlays the board chat; float swaps the floating panel in place. */
  variant: "drawer" | "float";
  /** Streams in progress disable new/switch until stopped (ADR D5/D6). */
  disabled?: boolean;
  onClose: () => void;
  onNew: () => Promise<void>;
  onSwitch: (threadId: string) => Promise<void>;
  /** Raise the host login overlay after a 401. */
  onAuthExpired: () => void;
}

interface GroupedRow {
  key: HistoryGroupKey;
  label: string;
  items: ScreenThreadRow[];
}

function rowTimestampMs(row: ScreenThreadRow): number {
  const value = row.last_active > 0 ? row.last_active : row.created_at;
  return value * 1000;
}

function groupRows(
  rows: ScreenThreadRow[],
  nowMs: number,
  timeZone: string,
): GroupedRow[] {
  const buckets: Record<HistoryGroupKey, ScreenThreadRow[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };
  for (const row of rows) {
    const key = historyGroup(rowTimestampMs(row), nowMs, timeZone);
    buckets[key].push(row);
  }
  return (Object.keys(buckets) as HistoryGroupKey[])
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({
      key,
      label: GROUP_LABELS[key],
      items: buckets[key],
    }));
}

function rowTimeLabel(
  row: ScreenThreadRow,
  nowMs: number,
  timeZone: string,
): string {
  const ts = rowTimestampMs(row);
  const group = historyGroup(ts, nowMs, timeZone);
  if (group === "today") return formatHistoryTime(ts, timeZone);
  if (group === "yesterday") return "昨天";
  return formatHistoryDate(ts, nowMs, timeZone);
}

/**
 * Screen history list (ADR 004 D7/D8): search + tabs + time grouping + pin,
 * shared by the board drawer and the floating panel.
 */
export default function ThreadHistory({
  agentId,
  screenKey,
  activeThreadId,
  variant,
  disabled = false,
  onClose,
  onNew,
  onSwitch,
  onAuthExpired,
}: ThreadHistoryProps) {
  const [scope, setScope] = useState<HistoryScope>("screen");
  const [search, setSearch] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [rows, setRows] = useState<ScreenThreadRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const [pinning, setPinning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const loadSeq = useRef(0);

  // Debounced search input (300ms, ADR D8).
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQ(search.trim());
    }, 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  // Server timezone for date/time grouping (never the browser's).
  useEffect(() => {
    let cancelled = false;
    getServerTimezone()
      .then((zone) => {
        if (!cancelled) setTimeZone(zone);
      })
      .catch(() => {
        if (!cancelled) setTimeZone(DEFAULT_TIME_ZONE);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(() => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setListError(null);
    listScreenThreads(agentId, {
      screenKey,
      scope,
      q: debouncedQ || undefined,
      limit: 100,
    })
      .then((data) => {
        if (loadSeq.current !== seq) return;
        setRows(data);
        setLoading(false);
      })
      .catch((listError_: unknown) => {
        if (loadSeq.current !== seq) return;
        setLoading(false);
        if (listError_ instanceof UnauthorizedError) {
          onAuthExpired();
          return;
        }
        setListError(
          listError_ instanceof Error ? listError_.message : String(listError_),
        );
      });
  }, [agentId, screenKey, scope, debouncedQ, onAuthExpired]);

  useEffect(() => {
    reload();
  }, [reload, refreshTick]);

  const refresh = () => setRefreshTick((tick) => tick + 1);

  const handleNew = async () => {
    if (busy || disabled) return;
    setBusy(true);
    setListError(null);
    try {
      await onNew();
      refresh();
    } catch (newError: unknown) {
      if (newError instanceof UnauthorizedError) {
        onAuthExpired();
        return;
      }
      setListError(
        newError instanceof Error ? newError.message : String(newError),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSwitch = async (threadId: string) => {
    if (busy || disabled || threadId === activeThreadId) return;
    setBusy(true);
    setListError(null);
    try {
      await onSwitch(threadId);
      refresh();
    } catch (switchError: unknown) {
      if (switchError instanceof UnauthorizedError) {
        onAuthExpired();
        return;
      }
      setListError(
        switchError instanceof Error
          ? switchError.message
          : String(switchError),
      );
    } finally {
      setBusy(false);
    }
  };

  const handlePin = async (row: ScreenThreadRow) => {
    if (pinning) return;
    setPinning(row.thread_id);
    setListError(null);
    try {
      await setThreadPinned(agentId, row.thread_id, !row.pinned);
      refresh();
    } catch (pinError: unknown) {
      if (pinError instanceof UnauthorizedError) {
        onAuthExpired();
        return;
      }
      setListError(
        pinError instanceof Error ? pinError.message : String(pinError),
      );
    } finally {
      setPinning(null);
    }
  };

  const nowMs = Date.now();
  const ready = timeZone !== null;
  const isEmpty = !loading && rows !== null && rows.length === 0 && !debouncedQ;
  const noMatch =
    !loading && rows !== null && rows.length === 0 && !!debouncedQ;
  const groups = rows
    ? groupRows(rows, nowMs, timeZone ?? DEFAULT_TIME_ZONE)
    : [];

  const listBody = (
    <>
      <div className={styles.historyToolbar}>
        <input
          className={styles.historySearch}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索标题或问题"
          aria-label="搜索历史会话"
        />
        <button
          type="button"
          className={styles.historyNewButton}
          onClick={() => void handleNew()}
          disabled={busy || disabled}
        >
          新建会话
        </button>
      </div>

      <nav className={styles.historyTabs} aria-label="历史范围">
        {SCOPE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`${styles.historyTab} ${
              scope === tab.key ? styles.historyTabActive : ""
            }`}
            onClick={() => setScope(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className={styles.historyList}>
        {listError ? (
          <div className={styles.historyHint}>{listError}</div>
        ) : loading || !ready ? (
          <div className={styles.historyHint}>加载中…</div>
        ) : noMatch ? (
          <div className={styles.historyHint}>未找到相关会话</div>
        ) : isEmpty ? (
          <div className={styles.historyEmpty}>
            <p>还没有历史会话</p>
            <button
              type="button"
              className={styles.historyNewButton}
              onClick={() => void handleNew()}
              disabled={busy || disabled}
            >
              新建会话
            </button>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.key} className={styles.historyGroup}>
              <h4 className={styles.historyGroupLabel}>{group.label}</h4>
              {group.items.map((row) => {
                const active = row.is_active;
                const title = row.title || row.summary || "未命名会话";
                const preview = row.title && row.summary ? row.summary : "";
                return (
                  <div
                    key={row.thread_id}
                    className={`${styles.historyRow} ${
                      active ? styles.historyRowActive : ""
                    }`}
                    data-pinpressed={
                      pinning === row.thread_id ? "true" : undefined
                    }
                  >
                    <button
                      type="button"
                      className={styles.historyRowMain}
                      onClick={() => void handleSwitch(row.thread_id)}
                      disabled={busy || disabled || active}
                    >
                      <span className={styles.historyRowTop}>
                        <strong className={styles.historyRowTitle}>
                          {title}
                        </strong>
                        <time className={styles.historyRowTime}>
                          {rowTimeLabel(
                            row,
                            nowMs,
                            timeZone ?? DEFAULT_TIME_ZONE,
                          )}
                        </time>
                        {active ? (
                          <span className={styles.historyActiveTag}>当前</span>
                        ) : null}
                      </span>
                      {preview ? (
                        <span className={styles.historyRowPreview}>
                          {preview}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className={`${styles.historyPinButton} ${
                        row.pinned ? styles.historyPinButtonActive : ""
                      }`}
                      aria-label={row.pinned ? "取消置顶" : "置顶"}
                      title={row.pinned ? "取消置顶" : "置顶"}
                      onClick={() => void handlePin(row)}
                      disabled={pinning === row.thread_id}
                    >
                      <PinIcon filled={row.pinned} />
                    </button>
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>
    </>
  );

  if (variant === "drawer") {
    return (
      <>
        <div className={styles.historyBackdrop} onClick={onClose} />
        <aside
          className={styles.historyDrawer}
          role="dialog"
          aria-label="历史会话"
        >
          <header className={styles.historyHeader}>
            <strong className={styles.historyTitle}>历史会话</strong>
            <button
              type="button"
              className={styles.historyCloseButton}
              aria-label="关闭"
              onClick={onClose}
            >
              ×
            </button>
          </header>
          {listBody}
        </aside>
      </>
    );
  }

  return (
    <div className={styles.historyFloat}>
      <header className={styles.historyHeader}>
        <button
          type="button"
          className={styles.historyBackButton}
          onClick={onClose}
        >
          ‹ 返回
        </button>
        <strong className={styles.historyTitle}>历史会话</strong>
      </header>
      {listBody}
    </div>
  );
}

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M9 4h6l-1 5 3 3v2H8v-2l3-3-2-5Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 14v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
