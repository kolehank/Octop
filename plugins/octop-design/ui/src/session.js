// Module-level UI state that must survive between the chat card and the dock
// tab (the dock re-renders the SAME tool result through the same renderer, and
// the host contract exposes no explicit "card vs dock" mode flag).
//
// How the two shapes are told apart:
//  * The chat card has the 「打开画板」 button; clicking it marks the callId
//    here AND calls host.openSidePanel(...). The dock instance mounts with the
//    marker already set and renders the full canvas.
//  * The marker is sticky (sessionStorage) so reloads keep the dock shape.
//  * If the marker is somehow lost, the component falls back to the card shape
//    with an inline 「展开」 toggle — the same component, both shapes.

import { WS_FILE } from "./api.js";

const MARKER_KEY = (callId) => `octop-design-dock:${callId}`;
const HISTORY_KEY = (slug) => `octop-design-history:${slug}`;

export function markDocked(callId) {
  if (!callId) return;
  try {
    sessionStorage.setItem(MARKER_KEY(callId), "1");
  } catch {
    /* storage unavailable */
  }
}

export function isDocked(callId) {
  if (!callId) return false;
  try {
    return sessionStorage.getItem(MARKER_KEY(callId)) === "1";
  } catch {
    return false;
  }
}

/** Merge the latest history list into a per-slug cache (polling keeps it fresh). */
export function rememberHistory(slug, entries) {
  if (!slug || !Array.isArray(entries) || !entries.length) return;
  try {
    sessionStorage.setItem(HISTORY_KEY(slug), JSON.stringify(entries));
  } catch {
    /* storage unavailable */
  }
}

export function cachedHistory(slug) {
  if (!slug) return [];
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY(slug));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function mergeHistory(slug, incoming) {
  const seen = new Map();
  for (const entry of cachedHistory(slug)) seen.set(`${entry.rev}`, entry);
  for (const entry of Array.isArray(incoming) ? incoming : []) seen.set(`${entry.rev}`, entry);
  const merged = [...seen.values()].sort((a, b) => (b.rev || 0) - (a.rev || 0));
  rememberHistory(slug, merged);
  return merged;
}

export const WS_FILE_NAMES = WS_FILE;