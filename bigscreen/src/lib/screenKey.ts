/**
 * Route → screenKey normalization for the big screen (ADR 004 D2).
 *
 * A screenKey is a *route template* (通道标识按屏隔离), never a concrete URL:
 * drill-down page item ids are dropped so every entry shares the session of
 * its dimension. The server enforces the final format; this module only knows
 * how to derive a safe key from the router pathname.
 */

const SCREEN_ROOT_KEY = "demo/overview";

/** Split a pathname into segments, tolerating the "/screen" SPA base. */
function pathSegments(pathname: string): string[] {
  const segments = String(pathname)
    .split("/")
    .filter((part) => part.length > 0);
  if (segments[0] === "screen") segments.shift();
  return segments;
}

/** Keep only characters safe inside a screenKey segment. */
function sanitizeSegment(segment: string): string {
  return segment.replace(/[^A-Za-z0-9_-]/g, "");
}

/**
 * Map a big-screen route to its session screenKey. Accepts either the router
 * local path (location.pathname under basename "/screen", e.g. `/demo/…`) or
 * the full URL path (`/screen/demo/…`).
 *
 *   /screen/demo/                → "demo/overview"
 *   /screen/demo/:topic          → "demo/:topic"
 *   /screen/demo/:topic/:dim/:id → "demo/:topic/:dim"
 */
export function screenKeyFor(pathname: string): string {
  const segments = pathSegments(pathname);
  if (segments[0] !== "demo") return SCREEN_ROOT_KEY;
  const topic = segments[1];
  if (!topic) return SCREEN_ROOT_KEY;
  const dimension = segments[2];
  if (!dimension) return `demo/${sanitizeSegment(topic)}`;
  return `demo/${sanitizeSegment(topic)}/${sanitizeSegment(dimension)}`;
}

/** Loose client-side validity pre-check (server still enforces D2 strictly). */
export function isValidScreenKey(key: string): boolean {
  if (typeof key !== "string" || key.length === 0 || key.length > 120) {
    return false;
  }
  if (!/^[A-Za-z0-9_/-]+$/.test(key)) return false;
  if (/[:%\s]/.test(key)) return false;
  return key.split("/").length <= 3;
}
