// Workspace HTTP API helpers (src/octop/api/routers/workspace.py).
//
// Design documents live inside the agent workspace at designs/<slug>/... and
// the workspace endpoints are the plugin UI's authenticated read/write surface:
//   GET  /agents/{id}/workspace/download?path=…&from_workspace=true
//   POST /agents/{id}/workspace/upload?path=…&from_workspace=true  (multipart file=)
//   PUT  /agents/{id}/workspace/file?path=…&from_workspace=true    ({"content": …})
// "host.request(path)" already prefixes /api and adds the auth header.

const REL_PREFIX = (slug) => `designs/${slug}/`;

function downloadPath(agentId, slug, rel) {
  return `/agents/${encodeURIComponent(agentId)}/workspace/download?path=${encodeURIComponent(
    REL_PREFIX(slug) + rel,
  )}&from_workspace=true`;
}

function uploadPath(agentId, slug, rel) {
  return `/agents/${encodeURIComponent(agentId)}/workspace/upload?path=${encodeURIComponent(
    REL_PREFIX(slug) + rel,
  )}&from_workspace=true`;
}

export function wsDownloadText(host, agentId, slug, rel) {
  return host.request(downloadPath(agentId, slug, rel));
}

export async function wsDownloadJson(host, agentId, slug, rel) {
  const text = await wsDownloadText(host, agentId, slug, rel);
  return typeof text === "string" && text ? JSON.parse(text) : null;
}

export function wsUploadText(host, agentId, slug, rel, content) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([content], { type: "application/octet-stream" }),
    encodeURIComponent(rel),
  );
  return host.request(uploadPath(agentId, slug, rel), { method: "POST", body: form });
}

export const WS_FILE = {
  INDEX: "index.html",
  META: "meta.json",
  ANNOTATIONS: "annotations.json",
};
export function wsMkdir(host, agentId, absPath) {
  return host.request(
    `/agents/${encodeURIComponent(agentId)}/workspace/mkdir?path=${encodeURIComponent(absPath)}`,
    { method: "POST" },
  );
}

/** Upload a Blob (e.g. a screenshot) into designs/<slug>/<rel>. */
export function wsUploadBlob(host, agentId, slug, rel, blob, mime) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([blob], { type: mime || "application/octet-stream" }),
    encodeURIComponent(rel),
  );
  return host.request(uploadPath(agentId, slug, rel), { method: "POST", body: form });
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Save a manually edited draft, mirroring design_store.py:
 * snapshot the old index.html into history/v<rev:04d>.html, bump rev, refresh
 * sha256, and refuse to write when the on-disk rev moved (CONFLICT).
 */
export async function saveDesignHtml(host, agentId, slug, html, expectedRevision) {
  const meta = await wsDownloadJson(host, agentId, slug, WS_FILE.META);
  const currentRev = meta && typeof meta.rev === "number" ? meta.rev : 0;
  if (currentRev !== expectedRevision) {
    return { ok: false, conflict: true, revision: currentRev, expected: expectedRevision };
  }
  const oldHtml = await wsDownloadText(host, agentId, slug, WS_FILE.INDEX);
  const snapshotRel = `history/v${String(currentRev).padStart(4, "0")}.html`;
  await wsUploadText(host, agentId, slug, snapshotRel, oldHtml);
  await wsUploadText(host, agentId, slug, WS_FILE.INDEX, html);
  const now = new Date().toISOString();
  const next = {
    slug,
    title: meta && typeof meta.title === "string" ? meta.title : slug,
    rev: currentRev + 1,
    sha256: await sha256Hex(html),
    updated_at: now,
    tool_call_id: "dashboard-edit",
    created_at: meta && typeof meta.created_at === "string" ? meta.created_at : now,
  };
  await wsUploadText(host, agentId, slug, WS_FILE.META, JSON.stringify(next, null, 2));
  return { ok: true, revision: next.rev };
}

/** Browser download of generated text (export HTML). */
export function downloadTextFile(filename, text, mime = "text/html;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
