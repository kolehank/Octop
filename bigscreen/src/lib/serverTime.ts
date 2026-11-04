/**
 * Server-timezone display helpers for the big screen (ADR 004 D8).
 *
 * History list grouping and row timestamps must use the server timezone
 * (GET /api/settings/timezone), never the browser's local timezone. These are
 * intentional light-weight local utilities — the big screen does not import
 * dashboard code.
 */

import { apiFetch } from "./auth";

let cachedZone: string | null = null;
let pending: Promise<string> | null = null;

/** Resolve the server timezone (cached; retries on failure). */
export function getServerTimezone(): Promise<string> {
  if (cachedZone) return Promise.resolve(cachedZone);
  if (!pending) {
    pending = apiFetch("/settings/timezone")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`获取时区失败（${response.status}）`);
        }
        const data = (await response.json()) as { timezone?: string };
        cachedZone = String(data.timezone ?? "").trim() || "Asia/Shanghai";
        return cachedZone;
      })
      .catch((error) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}

const DAY_MS = 86_400_000;

/** Calendar date (YYYY-MM-DD) of *timestampMs* in the given timezone. */
function dateKeyInTz(timestampMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(timestampMs));
}

export type HistoryGroupKey = "today" | "yesterday" | "earlier";

/** Group bucket (今天 / 昨天 / 更早) relative to the server timezone. */
export function historyGroup(
  timestampMs: number,
  nowMs: number,
  timeZone: string,
): HistoryGroupKey {
  const today = dateKeyInTz(nowMs, timeZone);
  const day = dateKeyInTz(timestampMs, timeZone);
  if (day === today) return "today";
  if (day === dateKeyInTz(nowMs - DAY_MS, timeZone)) return "yesterday";
  return "earlier";
}

/** HH:MM clock time of a row timestamp in the server timezone. */
export function formatHistoryTime(
  timestampMs: number,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(timestampMs));
}

/** Compact "M月D日" / "YYYY年M月D日" label for rows older than yesterday. */
export function formatHistoryDate(
  timestampMs: number,
  nowMs: number,
  timeZone: string,
): string {
  const row = new Date(timestampMs);
  const years = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    timeZone,
  });
  const monthDay = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    timeZone,
  });
  if (years.format(row) === years.format(new Date(nowMs))) {
    return monthDay.format(row);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone,
  }).format(row);
}
