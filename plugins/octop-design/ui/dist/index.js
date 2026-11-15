const __AGENTBUDDY_REACT__ = window.__AGENTBUDDY_REACT__;
const useState = __AGENTBUDDY_REACT__.useState;
const useEffect = __AGENTBUDDY_REACT__.useEffect;
const useRef = __AGENTBUDDY_REACT__.useRef;
const useMemo = __AGENTBUDDY_REACT__.useMemo;
const useCallback = __AGENTBUDDY_REACT__.useCallback;
const REL_PREFIX = (slug) => `designs/${slug}/`;
function downloadPath(agentId, slug, rel) {
  return `/agents/${encodeURIComponent(agentId)}/workspace/download?path=${encodeURIComponent(
    REL_PREFIX(slug) + rel
  )}&from_workspace=true`;
}
function uploadPath(agentId, slug, rel) {
  return `/agents/${encodeURIComponent(agentId)}/workspace/upload?path=${encodeURIComponent(
    REL_PREFIX(slug) + rel
  )}&from_workspace=true`;
}
function wsDownloadText(host, agentId, slug, rel) {
  return host.request(downloadPath(agentId, slug, rel));
}
async function wsDownloadJson(host, agentId, slug, rel) {
  const text = await wsDownloadText(host, agentId, slug, rel);
  return typeof text === "string" && text ? JSON.parse(text) : null;
}
function wsUploadText(host, agentId, slug, rel, content) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([content], { type: "application/octet-stream" }),
    encodeURIComponent(rel)
  );
  return host.request(uploadPath(agentId, slug, rel), { method: "POST", body: form });
}
const WS_FILE = {
  INDEX: "index.html",
  META: "meta.json",
  ANNOTATIONS: "annotations.json"
};
function wsMkdir(host, agentId, absPath) {
  return host.request(
    `/agents/${encodeURIComponent(agentId)}/workspace/mkdir?path=${encodeURIComponent(absPath)}`,
    { method: "POST" }
  );
}
function wsUploadBlob(host, agentId, slug, rel, blob, mime) {
  const form = new FormData();
  form.append(
    "file",
    new Blob([blob], { type: mime }),
    encodeURIComponent(rel)
  );
  return host.request(uploadPath(agentId, slug, rel), { method: "POST", body: form });
}
async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function saveDesignHtml(host, agentId, slug, html, expectedRevision) {
  const meta = await wsDownloadJson(host, agentId, slug, WS_FILE.META);
  const currentRev = meta && typeof meta.rev === "number" ? meta.rev : 0;
  if (currentRev !== expectedRevision) {
    return { ok: false, conflict: true, revision: currentRev, expected: expectedRevision };
  }
  const oldHtml = await wsDownloadText(host, agentId, slug, WS_FILE.INDEX);
  const snapshotRel = `history/v${String(currentRev).padStart(4, "0")}.html`;
  await wsUploadText(host, agentId, slug, snapshotRel, oldHtml);
  await wsUploadText(host, agentId, slug, WS_FILE.INDEX, html);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const next = {
    slug,
    title: meta && typeof meta.title === "string" ? meta.title : slug,
    rev: currentRev + 1,
    sha256: await sha256Hex(html),
    updated_at: now,
    tool_call_id: "dashboard-edit",
    created_at: meta && typeof meta.created_at === "string" ? meta.created_at : now
  };
  await wsUploadText(host, agentId, slug, WS_FILE.META, JSON.stringify(next, null, 2));
  return { ok: true, revision: next.rev };
}
function downloadTextFile(filename, text, mime = "text/html;charset=utf-8") {
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
const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;
function sanitizeForXml(root) {
  const elements = [root, ...root.querySelectorAll("*")];
  for (const el of elements) {
    if (el.nodeType !== 1) continue;
    for (const attr of Array.from(el.attributes || [])) {
      if (!XML_NAME.test(attr.name)) el.removeAttribute(attr.name);
    }
  }
}
function captureIframePng(iframe, opts = {}) {
  return new Promise((resolve, reject) => {
    const doc = iframe && iframe.contentDocument;
    const root = doc && doc.documentElement;
    if (!root) {
      reject(new Error("稿件尚未就绪"));
      return;
    }
    try {
      const full = opts.full !== false;
      const width = Math.max(full ? root.scrollWidth : iframe.clientWidth || 0, 1);
      const height = Math.max(full ? root.scrollHeight : iframe.clientHeight || 0, 1);
      const clone = root.cloneNode(true);
      clone.querySelectorAll("[data-octop-design-highlight]").forEach((node) => node.remove());
      clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      sanitizeForXml(clone);
      const serialized = new XMLSerializer().serializeToString(clone);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="${width}" height="${height}">${serialized}</foreignObject></svg>`;
      const image = new Image();
      image.onload = () => {
        try {
          const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(width * dpr);
          canvas.height = Math.round(height * dpr);
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("无法创建画布上下文");
          ctx.scale(dpr, dpr);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL("image/png"));
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };
      image.onerror = () => reject(new Error("截图渲染失败（稿件包含无法嵌入的资源）"));
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}
function captureTimestamp() {
  const d = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
const MARKER_KEY = (callId) => `octop-design-dock:${callId}`;
const HISTORY_KEY = (slug) => `octop-design-history:${slug}`;
function markDocked(callId) {
  if (!callId) return;
  try {
    sessionStorage.setItem(MARKER_KEY(callId), "1");
  } catch {
  }
}
function isDocked(callId) {
  if (!callId) return false;
  try {
    return sessionStorage.getItem(MARKER_KEY(callId)) === "1";
  } catch {
    return false;
  }
}
function rememberHistory(slug, entries) {
  if (!slug || !Array.isArray(entries) || !entries.length) return;
  try {
    sessionStorage.setItem(HISTORY_KEY(slug), JSON.stringify(entries));
  } catch {
  }
}
function cachedHistory(slug) {
  if (!slug) return [];
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY(slug));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function mergeHistory(slug, incoming) {
  const seen = /* @__PURE__ */ new Map();
  for (const entry of cachedHistory(slug)) seen.set(`${entry.rev}`, entry);
  for (const entry of Array.isArray(incoming) ? incoming : []) seen.set(`${entry.rev}`, entry);
  const merged = [...seen.values()].sort((a, b) => (b.rev || 0) - (a.rev || 0));
  rememberHistory(slug, merged);
  return merged;
}
const INTERACTIVE = /* @__PURE__ */ new Set([
  "A",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "OPTION",
  "LABEL"
]);
function isInteractive(el) {
  return INTERACTIVE.has(el.tagName) || Boolean(el.closest && el.closest("a,button,input,select,textarea"));
}
function buildSelector(el) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node.tagName !== "BODY" && node.tagName !== "HTML") {
    const parent = node.parentElement;
    if (!parent) break;
    let index2 = 1;
    let sib = parent.firstElementChild;
    while (sib !== node) {
      if (sib && sib.tagName === node.tagName) index2 += 1;
      sib = sib.nextElementSibling;
    }
    parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index2})`);
    node = parent;
  }
  const chain = parts.join(" > ");
  if (el.id) return `#${el.id} ${chain}`.trim();
  return chain;
}
function pageRect(el) {
  const rect = el.getBoundingClientRect();
  const doc = el.ownerDocument;
  const scrollX = doc.documentElement.scrollLeft || doc.body?.scrollLeft || 0;
  const scrollY = doc.documentElement.scrollTop || doc.body?.scrollTop || 0;
  return {
    x: rect.left + scrollX,
    y: rect.top + scrollY,
    w: rect.width,
    h: rect.height,
    docWidth: doc.documentElement.scrollWidth || doc.body?.scrollWidth || rect.width,
    docHeight: doc.documentElement.scrollHeight || doc.body?.scrollHeight || rect.height
  };
}
function installCanvas(iframe, opts) {
  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!doc || !doc.body) {
    return { dispose() {
    } };
  }
  const blockLinkNavigation = (event) => {
    const target = event.target;
    if (!target || target.nodeType !== 1 || !target.closest) return;
    const link = target.closest("a[href], area[href]");
    if (!link) return;
    const href = link.getAttribute("href") ?? "";
    if (href === "" || href === "#" || href.startsWith("#")) {
      event.preventDefault();
      if (href === "" || href === "#") {
        const docEl = doc.documentElement;
        if (docEl) docEl.scrollTop = 0;
        if (doc.body) doc.body.scrollTop = 0;
        return;
      }
      const targetId = href.slice(1);
      const el = targetId ? doc.getElementById(targetId) : null;
      if (el && el.scrollIntoView) el.scrollIntoView();
      try {
        win.location.hash = href;
      } catch {
      }
      return;
    }
    if (/^(https?:|mailto:)/i.test(href)) {
      event.preventDefault();
      try {
        win.open(href, "_blank", "noopener,noreferrer");
      } catch {
      }
      return;
    }
    event.preventDefault();
  };
  const blockFormSubmit = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  doc.addEventListener("click", blockLinkNavigation, true);
  doc.addEventListener("submit", blockFormSubmit, true);
  let overlay = null;
  let disposed = false;
  let enabled = Boolean(opts.enabled);
  function ensureOverlay() {
    if (overlay && overlay.isConnected) return overlay;
    overlay = doc.createElement("div");
    overlay.setAttribute("data-octop-design-highlight", "");
    Object.assign(overlay.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: "2147483646",
      display: "none",
      border: "2px dashed #ff6d3d",
      boxShadow: "0 0 0 9999px rgba(20,24,40,0.12)",
      borderRadius: "3px",
      boxSizing: "border-box"
    });
    doc.body.appendChild(overlay);
    return overlay;
  }
  function hide() {
    if (overlay) overlay.style.display = "none";
  }
  const onMove = (event) => {
    if (disposed || !enabled) return hide();
    const target = event.target;
    if (!target || target.nodeType !== 1 || isInteractive(target)) return hide();
    const box = ensureOverlay();
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return hide();
    Object.assign(box.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
  };
  const onClick = (event) => {
    if (disposed || !enabled) return;
    const target = event.target;
    if (!target || target.nodeType !== 1 || !target.closest) return;
    if (target.tagName === "BODY" || target.tagName === "HTML") return;
    if (isInteractive(target)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = pageRect(target);
    if (rect.w === 0 && rect.h === 0) return;
    opts.onPick?.({
      selector: buildSelector(target),
      tag: target.tagName || "ELEMENT",
      text: (target.textContent || "").trim().slice(0, 120),
      rect
    });
  };
  doc.addEventListener("mousemove", onMove, true);
  doc.addEventListener("click", onClick, true);
  return {
    dispose() {
      disposed = true;
      doc.removeEventListener("mousemove", onMove, true);
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("click", blockLinkNavigation, true);
      doc.removeEventListener("submit", blockFormSubmit, true);
      if (overlay && overlay.isConnected) overlay.remove();
    }
  };
}
const PALETTE = {
  light: {
    bg: "#ffffff",
    panel: "#f6f7f9",
    line: "#dfe3ea",
    text: "#1f2937",
    muted: "#75809a",
    accent: "#2f6fd0",
    accentText: "#ffffff",
    warnBg: "#fff1e6",
    warnLine: "#ffb37a",
    warnText: "#8a3a08",
    ok: "#1d9e6a"
  },
  dark: {
    bg: "#181c26",
    panel: "#202636",
    line: "#323b4f",
    text: "#e8ecf4",
    muted: "#93a1bd",
    accent: "#4e86e0",
    accentText: "#ffffff",
    warnBg: "#3a2a1c",
    warnLine: "#b36a33",
    warnText: "#ffcf9c",
    ok: "#3fbf8a"
  }
};
function ThemePalette(props) {
  const theme = props.host?.getToolContext?.().theme || "light";
  return PALETTE[theme] || PALETTE.light;
}
function normalizePayload(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return data;
}
function liveAnnotation(a) {
  const status = a && a.status;
  return !status || status === "open";
}
function rgbToHex(value) {
  const match = String(value || "").match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!match) return "#000000";
  return "#" + [match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("");
}
const EMPTY_EDIT_DRAFT = {
  text: "",
  fontSize: "",
  color: "#000000",
  background: "",
  padding: "",
  margin: "",
  textAlign: "",
  borderRadius: ""
};
function DesignCanvas(props) {
  const { host, callId, data, textFallback, toolName } = props;
  const agentId = props.agentId || null;
  const palette = ThemePalette(props);
  const payload = useMemo(() => normalizePayload(data), [data]);
  const slug = typeof payload.slug === "string" ? payload.slug : "";
  const [title, setTitle] = useState(
    () => typeof payload.title === "string" ? payload.title : slug || "Design"
  );
  useEffect(() => {
    if (typeof payload.title === "string") setTitle(payload.title);
  }, [payload.title]);
  const toolConflict = payload.status === "CONFLICT" ? {
    expected: payload.expected,
    revision: payload.revision,
    reason: payload.reason
  } : null;
  const [mode, setMode] = useState(() => isDocked(callId) ? "dock" : "card");
  const [html, setHtml] = useState(
    typeof payload.html === "string" ? payload.html : ""
  );
  const [rev, setRev] = useState(typeof payload.revision === "number" ? payload.revision : 0);
  const [annotations, setAnnotations] = useState(
    Array.isArray(payload.annotations) ? payload.annotations : []
  );
  const [history, setHistory] = useState(
    () => mergeHistory(slug, payload.history)
  );
  const [updatedAt, setUpdatedAt] = useState(
    typeof payload.updated_at === "string" ? payload.updated_at : ""
  );
  const [conflict, setConflict] = useState(toolConflict);
  const [annotate, setAnnotate] = useState(false);
  const [pick, setPick] = useState(null);
  const [note, setNote] = useState("");
  const [sideTab, setSideTab] = useState("notes");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [preview, setPreview] = useState(null);
  const [view, setView] = useState("preview");
  const [viewport, setViewport] = useState("desktop");
  const [zoomMode, setZoomMode] = useState("auto");
  const [zoomPercent, setZoomPercent] = useState(100);
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });
  const [contentBox, setContentBox] = useState({ w: 0, h: 0 });
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureWithNote, setCaptureWithNote] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editDraft, setEditDraft] = useState(EMPTY_EDIT_DRAFT);
  const [editDirty, setEditDirty] = useState(false);
  const iframeRef = useRef(null);
  const stageRef = useRef(null);
  const [docEpoch, setDocEpoch] = useState(0);
  const revRef = useRef(rev);
  useEffect(() => {
    revRef.current = rev;
  }, [rev]);
  const showToast = useCallback(
    (message) => {
      setToast(message);
      if (message) {
        window.setTimeout(() => setToast((cur) => cur === message ? null : cur), 4e3);
      }
    },
    []
  );
  const mustFetch = agentId && slug;
  const refresh = useCallback(async () => {
    if (!mustFetch) return;
    setBusy(true);
    try {
      const [indexHtml, metaText, annText] = await Promise.all([
        wsDownloadText(host, agentId, slug, WS_FILE.INDEX),
        wsDownloadText(host, agentId, slug, WS_FILE.META),
        wsDownloadText(host, agentId, slug, WS_FILE.ANNOTATIONS)
      ]);
      let meta = null;
      let annotationsNext = [];
      try {
        meta = metaText && JSON.parse(metaText);
      } catch {
        meta = null;
      }
      try {
        const parsed = annText ? JSON.parse(annText) : [];
        annotationsNext = Array.isArray(parsed) ? parsed : [];
      } catch {
        annotationsNext = [];
      }
      setHtml(indexHtml || "");
      setRev(meta && typeof meta.rev === "number" ? meta.rev : 0);
      setTitle(meta && typeof meta.title === "string" ? meta.title : slug);
      setUpdatedAt(meta && typeof meta.updated_at === "string" ? meta.updated_at : "");
      setAnnotations(annotationsNext);
      setConflict(null);
      setDocEpoch((n) => n + 1);
    } catch (err) {
      showToast(`读取稿件失败：${err && err.message ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }, [mustFetch, host, agentId, slug, showToast]);
  const initialRefresh = useRef(false);
  useEffect(() => {
    if (mode !== "dock" || initialRefresh.current || !mustFetch) return;
    initialRefresh.current = true;
    void refresh();
  }, [mode, mustFetch]);
  useEffect(() => {
    if (mode !== "dock" || !mustFetch || props.isStreaming || editMode) return void 0;
    const timer = window.setInterval(async () => {
      try {
        const meta = await wsDownloadJson(host, agentId, slug, WS_FILE.META);
        if (meta && typeof meta.rev === "number" && meta.rev !== revRef.current) {
          await refresh();
        }
      } catch {
      }
    }, 3e3);
    return () => window.clearInterval(timer);
  }, [mode, mustFetch, host, agentId, slug, props.isStreaming, refresh, editMode]);
  useEffect(() => {
    if (Array.isArray(payload.history) && payload.history.length) {
      setHistory(mergeHistory(slug, payload.history));
    }
  }, [slug, payload.history]);
  const saveAnnotations = useCallback(
    async (next) => {
      setAnnotations(next);
      if (!mustFetch) return;
      try {
        await wsUploadText(
          host,
          agentId,
          slug,
          WS_FILE.ANNOTATIONS,
          JSON.stringify(next, null, 2)
        );
        showToast("批注已保存");
      } catch (err) {
        showToast(`批注保存失败：${err && err.message ? err.message : err}`);
      }
    },
    [mustFetch, host, agentId, slug, showToast]
  );
  const updateAnnotation = useCallback(
    (id, patch) => {
      saveAnnotations(
        annotations.map((a) => a && a.id === id ? { ...a, ...patch } : a)
      );
    },
    [annotations, saveAnnotations]
  );
  const removeAnnotation = useCallback(
    (id) => {
      saveAnnotations(annotations.filter((a) => a && a.id !== id));
    },
    [annotations, saveAnnotations]
  );
  const submitPick = useCallback(async () => {
    if (!pick) return;
    let screenshot = "";
    if (captureWithNote && mustFetch) {
      try {
        const dataUrl = await captureIframePng(iframeRef.current);
        const rel = `captures/note-${captureTimestamp()}.png`;
        await wsMkdir(host, agentId, `designs/${slug}/captures`);
        await wsUploadBlob(host, agentId, slug, rel, dataUrlToBlob(dataUrl), "image/png");
        screenshot = rel;
      } catch {
      }
    }
    const record = {
      id: `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      selector: pick.selector,
      tag: String(pick.tag || "element").toLowerCase(),
      text: pick.text || "",
      note: note.trim() || pick.text || "",
      rect: pick.rect || null,
      created_at: (/* @__PURE__ */ new Date()).toISOString(),
      status: "open",
      ...screenshot ? { screenshot } : {}
    };
    void saveAnnotations([...annotations, record]);
    setPick(null);
    setNote("");
    setCaptureWithNote(false);
  }, [
    pick,
    note,
    annotations,
    saveAnnotations,
    captureWithNote,
    mustFetch,
    host,
    agentId,
    slug
  ]);
  const sendToAgent = useCallback(
    (text) => {
      if (typeof host.sendUserTurn === "function") {
        try {
          host.sendUserTurn(text);
          showToast("已发送给 agent");
          return true;
        } catch (err) {
          showToast(`发送失败：${err && err.message ? err.message : err}`);
          return false;
        }
      }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          void navigator.clipboard.writeText(text);
        }
      } catch {
      }
      showToast("已复制；请粘贴发送给 agent");
      return false;
    },
    [host, showToast]
  );
  const requestAgentFix = useCallback(() => {
    const pending = annotations.filter(liveAnnotation);
    if (!pending.length) {
      showToast("没有待处理的批注");
      return;
    }
    const lines = pending.map(
      (a, index2) => `${index2 + 1}. [${a.selector || a.tag || "element"}] ${a.note || a.text || ""}`
    );
    sendToAgent(
      `按以下批注修改稿件 ${slug}（当前 rev ${rev}）：
${lines.join("\n")}`
    );
  }, [annotations, slug, rev, sendToAgent, showToast]);
  const rollbackTo = useCallback(
    (entry) => {
      sendToAgent(
        `把稿件 ${slug}（当前 rev ${rev}）回滚到历史版本 rev ${entry.rev}。做法：读取 designs/${slug}/history/${entry.file} 的内容作为新稿，先 design_context，再 design_update(html=该内容, expectedRevision=${rev}, slug=${slug})。`
      );
    },
    [slug, rev, sendToAgent]
  );
  const previewHistory = useCallback(
    async (entry) => {
      if (!mustFetch) return;
      try {
        const fileHtml = await wsDownloadText(
          host,
          agentId,
          slug,
          `history/${entry.file}`
        );
        setPreview({ ...entry, html: fileHtml });
      } catch (err) {
        showToast(`读取快照失败：${err && err.message ? err.message : err}`);
      }
    },
    [mustFetch, host, agentId, slug, showToast]
  );
  const measureContent = useCallback(() => {
    const frame = iframeRef.current;
    const doc = frame && frame.contentDocument;
    if (!doc || !doc.documentElement) return;
    const w = Math.max(doc.documentElement.scrollWidth || 0, doc.body?.scrollWidth || 0);
    const h = Math.max(doc.documentElement.scrollHeight || 0, doc.body?.scrollHeight || 0);
    if (w > 0 && h > 0) {
      setContentBox((prev) => prev.w === w && prev.h === h ? prev : { w, h });
    }
  }, []);
  useEffect(() => {
    if (mode !== "dock" || view !== "preview") return void 0;
    const el = stageRef.current;
    if (!el) return void 0;
    const sync = () => {
      const w = Math.max(0, el.clientWidth - 20);
      const h = Math.max(0, el.clientHeight - 20);
      setStageBox((prev) => prev.w === w && prev.h === h ? prev : { w, h });
      measureContent();
    };
    sync();
    let observer = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(sync);
      observer.observe(el);
    }
    return () => {
      if (observer) observer.disconnect();
    };
  }, [mode, view, measureContent]);
  useEffect(() => {
    if (mode !== "dock" || view !== "preview") return void 0;
    const timer = window.setTimeout(measureContent, 140);
    return () => window.clearTimeout(timer);
  }, [mode, view, html, docEpoch, viewport, measureContent]);
  const DEVICE_WIDTH = { tablet: 820, mobile: 390 };
  const deviceWidth = DEVICE_WIDTH[viewport] || 0;
  const frameW = deviceWidth || Math.max(contentBox.w, stageBox.w, 0);
  const frameH = Math.max(contentBox.h, stageBox.h, 0);
  const fitScale = frameW > 0 && frameH > 0 && stageBox.w > 0 && stageBox.h > 0 ? Math.min(1, stageBox.w / frameW, stageBox.h / frameH) : 1;
  const scale = zoomMode === "manual" ? Math.max(0.1, zoomPercent / 100) : fitScale;
  const shownPercent = Math.round(scale * 100);
  const stepZoom = useCallback(
    (delta) => {
      setZoomMode("manual");
      setZoomPercent((prev) => {
        const base = zoomMode === "manual" ? prev : Math.round(fitScale * 100);
        return Math.max(10, Math.min(300, base + delta));
      });
    },
    [zoomMode, fitScale]
  );
  const guardCanvasNavigation = useCallback((event) => {
    const frame = event.currentTarget;
    let href = "";
    try {
      href = frame.contentWindow?.location?.href || "";
    } catch {
      href = "cross-origin";
    }
    if (href && !href.startsWith("about:srcdoc")) {
      setDocEpoch((n) => n + 1);
    }
  }, []);
  const beginPick = useCallback((p) => {
    setPick(p);
    setSideTab("notes");
    setNote("");
    setAnnotate(true);
  }, []);
  const beginEdit = useCallback((p) => {
    setEditTarget({ ...p, hasChildren: false });
    setSideTab("edit");
    const doc = iframeRef.current?.contentDocument;
    const el = doc ? doc.querySelector(p.selector) : null;
    if (!el || !doc.defaultView) {
      setEditDraft(EMPTY_EDIT_DRAFT);
      return;
    }
    const computed = doc.defaultView.getComputedStyle(el);
    setEditTarget({ ...p, hasChildren: el.children.length > 0 });
    setEditDraft({
      text: (el.textContent || "").trim(),
      fontSize: computed.fontSize || "",
      color: rgbToHex(computed.color),
      background: computed.backgroundColor && computed.backgroundColor !== "rgba(0, 0, 0, 0)" ? rgbToHex(computed.backgroundColor) : "",
      padding: computed.padding || "",
      margin: computed.margin || "",
      textAlign: computed.textAlign || "",
      borderRadius: computed.borderRadius || ""
    });
    setEditDirty(false);
  }, []);
  const handleCanvasPick = useCallback(
    (p) => {
      if (editMode) beginEdit(p);
      else beginPick(p);
    },
    [editMode, beginEdit, beginPick]
  );
  const applyEdit = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !editTarget) return;
    const el = doc.querySelector(editTarget.selector);
    if (!el) return;
    const draft = editDraft;
    if (!editTarget.hasChildren && el.textContent !== draft.text) {
      el.textContent = draft.text;
    }
    if (draft.fontSize) el.style.fontSize = draft.fontSize;
    if (draft.color) el.style.color = draft.color;
    if (draft.background) el.style.backgroundColor = draft.background;
    if (draft.padding) el.style.padding = draft.padding;
    if (draft.margin) el.style.margin = draft.margin;
    if (draft.textAlign) el.style.textAlign = draft.textAlign;
    if (draft.borderRadius) el.style.borderRadius = draft.borderRadius;
  }, [editTarget, editDraft]);
  useEffect(() => {
    if (!editMode || !editTarget) return;
    applyEdit();
  }, [editMode, editTarget, editDraft, applyEdit]);
  const serializeCanvasHtml = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !doc.documentElement) return "";
    const clone = doc.documentElement.cloneNode(true);
    clone.querySelectorAll("[data-octop-design-highlight]").forEach((node) => node.remove());
    return `<!doctype html>
${clone.outerHTML}`;
  }, []);
  const saveEdits = useCallback(async () => {
    if (!mustFetch) return;
    const nextHtml = serializeCanvasHtml();
    if (!nextHtml) {
      showToast("稿件尚未就绪");
      return;
    }
    setBusy(true);
    try {
      const result = await saveDesignHtml(host, agentId, slug, nextHtml, rev);
      if (result.conflict) {
        setConflict({
          expected: result.expected,
          revision: result.revision,
          reason: "手动编辑保存时发现稿件已被他人修改"
        });
        return;
      }
      setHtml(nextHtml);
      setRev(result.revision);
      setUpdatedAt((/* @__PURE__ */ new Date()).toISOString());
      setEditMode(false);
      setEditDirty(false);
      setDocEpoch((n) => n + 1);
      showToast(`已保存（rev ${result.revision}）`);
    } catch (err) {
      showToast(`保存失败：${err && err.message ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }, [mustFetch, serializeCanvasHtml, showToast, host, agentId, slug, rev]);
  const captureNow = useCallback(async () => {
    if (!mustFetch) {
      showToast("需要先打开画板（缺少 agent/稿件信息）");
      return;
    }
    setCaptureBusy(true);
    try {
      const dataUrl = await captureIframePng(iframeRef.current);
      const rel = `captures/capture-${captureTimestamp()}.png`;
      await wsMkdir(host, agentId, `designs/${slug}/captures`);
      await wsUploadBlob(host, agentId, slug, rel, dataUrlToBlob(dataUrl), "image/png");
      showToast(`截图已保存：designs/${slug}/${rel}`);
    } catch (err) {
      showToast(`截图失败：${err && err.message ? err.message : err}`);
    } finally {
      setCaptureBusy(false);
    }
  }, [mustFetch, host, agentId, slug, showToast]);
  useEffect(() => {
    if (mode !== "dock" || view !== "preview") return void 0;
    let disposed = false;
    let install = null;
    let timer = 0;
    const tryInstall = () => {
      const frame2 = iframeRef.current;
      if (!frame2 || disposed) return;
      if (install) install.dispose();
      install = installCanvas(frame2, {
        enabled: annotate || editMode,
        onPick: handleCanvasPick
      });
    };
    const frame = iframeRef.current;
    if (frame) frame.addEventListener("load", tryInstall);
    timer = window.setTimeout(tryInstall, 60);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      if (frame) frame.removeEventListener("load", tryInstall);
      if (install) install.dispose();
    };
  }, [mode, view, annotate, editMode, html, handleCanvasPick, docEpoch]);
  const openDock = useCallback(() => {
    if (!callId) return;
    markDocked(callId);
    host.openSidePanel({
      callId,
      title: title || "Design",
      toolName: toolName || "design_canvas"
    });
  }, [callId, host, title, toolName]);
  const pendingCount = annotations.filter(liveAnnotation).length;
  const displayName = title || slug || "Design";
  const autoOpened = useRef(false);
  useEffect(() => {
    if (mode !== "card" || autoOpened.current || !callId || html) return;
    if (toolName !== "design_open") return;
    autoOpened.current = true;
    openDock();
  }, [mode, callId, html, toolName, openDock]);
  const header = /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("span", { style: { fontSize: 15, fontWeight: 700, color: palette.text } }, displayName), slug ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("span", { style: { fontSize: 11, color: palette.muted } }, slug) : null, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
    "span",
    {
      title: "revision",
      style: {
        fontSize: 11,
        fontWeight: 700,
        color: palette.accentText,
        background: palette.accent,
        borderRadius: 999,
        padding: "1px 8px"
      }
    },
    "rev ",
    rev
  ), updatedAt ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("span", { style: { fontSize: 10.5, color: palette.muted } }, typeof updatedAt === "string" ? updatedAt.replace("T", " ").slice(0, 19) : "") : null);
  const conflictBanner = conflict ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
    "div",
    {
      style: {
        margin: "8px 0",
        padding: "8px 10px",
        borderRadius: 8,
        background: palette.warnBg,
        border: `1px solid ${palette.warnLine}`,
        color: palette.warnText,
        fontSize: 12,
        lineHeight: 1.45
      }
    },
    /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("b", null, "冲突：稿件已被修改到 rev ", conflict.revision, "（期望 rev", " ", conflict.expected, "）"),
    conflict.reason ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("span", null, " — ", conflict.reason) : null,
    /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("br", null),
    "未写入任何内容。请让 agent 先 design_context 重新读取，再 design_update。",
    /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
      "button",
      {
        type: "button",
        onClick: () => void refresh(),
        style: {
          marginLeft: 6,
          padding: "2px 10px",
          borderRadius: 6,
          border: `1px solid ${palette.warnLine}`,
          background: "transparent",
          color: palette.warnText,
          fontSize: 11.5,
          cursor: "pointer"
        }
      },
      "重新读取"
    )
  ) : null;
  const toastEl = toast ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
    "div",
    {
      style: {
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2147483647,
        padding: "8px 14px",
        borderRadius: 8,
        background: "#111827",
        color: "#fff",
        fontSize: 12.5,
        boxShadow: "0 4px 16px rgba(0,0,0,.35)",
        maxWidth: "70vw"
      }
    },
    toast
  ) : null;
  if (mode === "card") {
    return /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
      "div",
      {
        style: {
          maxWidth: 460,
          border: `1px solid ${palette.line}`,
          borderRadius: 12,
          background: palette.bg,
          padding: 12,
          color: palette.text
        }
      },
      header,
      conflictBanner,
      html ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "div",
        {
          style: {
            margin: "10px 0",
            borderRadius: 8,
            overflow: "hidden",
            border: `1px solid ${palette.line}`,
            position: "relative"
          }
        },
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
          "iframe",
          {
            title: `${displayName} preview`,
            srcDoc: html,
            scrolling: "no",
            style: {
              display: "block",
              width: "100%",
              height: 220,
              border: 0,
              pointerEvents: "none",
              background: "#ffffff",
              minHeight: 120
            }
          }
        )
      ) : /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { padding: "16px 4px", color: palette.muted, fontSize: 13 } }, textFallback || "无稿件内容"),
      /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" } }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            setMode("dock");
            void refresh();
          },
          style: btn(palette, "primary")
        },
        "展开"
      ), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("button", { type: "button", onClick: openDock, style: btn(palette, "primary") }, "🖼️ 打开画板"), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            setSideTab("history");
            openDock();
          },
          style: btn(palette)
        },
        "版本历史 ",
        history.length ? `(${history.length})` : ""
      )),
      toastEl
    );
  }
  return /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 420,
        width: "100%",
        background: palette.bg,
        color: palette.text,
        border: `1px solid ${palette.line}`,
        borderRadius: 12,
        overflow: "hidden"
      }
    },
    /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
      "div",
      {
        style: {
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          borderBottom: `1px solid ${palette.line}`,
          background: palette.panel,
          flexWrap: "wrap"
        }
      },
      /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("span", { style: { fontSize: 14, fontWeight: 800 } }, "🎨 ", displayName),
      /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "span",
        {
          title: "revision",
          style: {
            fontSize: 11,
            fontWeight: 700,
            color: palette.accentText,
            background: palette.accent,
            borderRadius: 999,
            padding: "1px 8px"
          }
        },
        "rev ",
        rev
      ),
      busy ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("span", { style: { fontSize: 11, color: palette.muted } }, "同步中…") : null,
      /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("span", { style: { flex: 1 } }),
      /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("span", { style: { display: "flex", gap: 4, alignItems: "center" } }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: () => setView("preview"),
          style: btn(palette, view === "preview" ? "primary" : "small"),
          title: "预览"
        },
        "👁 预览"
      ), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: () => setView("code"),
          style: btn(palette, view === "code" ? "primary" : "small"),
          title: "查看稿件源码"
        },
        "</>",
        " 代码"
      )),
      view === "preview" ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "select",
        {
          value: viewport,
          onChange: (event) => {
            setViewport(event.target.value);
            setZoomMode("auto");
          },
          title: "预览设备宽度",
          style: {
            fontSize: 11.5,
            padding: "3px 6px",
            borderRadius: 7,
            border: `1px solid ${palette.line}`,
            background: palette.bg,
            color: palette.text
          }
        },
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("option", { value: "desktop" }, "桌面端"),
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("option", { value: "tablet" }, "平板 820"),
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("option", { value: "mobile" }, "手机 390")
      ) : null,
      view === "preview" ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("span", { style: { display: "flex", gap: 2, alignItems: "center" } }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: () => stepZoom(-10),
          style: btn(palette, "small"),
          title: "缩小"
        },
        "−"
      ), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: () => setZoomMode("auto"),
          style: { ...btn(palette, "small"), minWidth: 46, textAlign: "center" },
          title: "自动适应 / 100%"
        },
        shownPercent,
        "%"
      ), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: () => stepZoom(10),
          style: btn(palette, "small"),
          title: "放大"
        },
        "+"
      ), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: () => setZoomMode("auto"),
          style: btn(palette, zoomMode === "auto" ? "primary" : "small"),
          title: "自动适应画布"
        },
        "适应"
      )) : null,
      /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: () => void captureNow(),
          disabled: captureBusy,
          style: btn(palette),
          title: "截图并保存到 designs/<slug>/captures/"
        },
        captureBusy ? "截图…" : "📷 截图"
      ),
      /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: () => downloadTextFile(`${slug || "design"}.html`, html),
          style: btn(palette),
          title: "导出 HTML"
        },
        "⬇ 导出"
      ),
      /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            setEditMode((value) => {
              const next = !value;
              if (next) {
                setAnnotate(false);
                setView("preview");
                setSideTab("edit");
              }
              return next;
            });
          },
          style: btn(palette, editMode ? "primary" : ""),
          title: "手动编辑元素（修改后保存为 design_update）"
        },
        "✏️ 编辑"
      ),
      /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: () => setAnnotate((value) => {
            const next = !value;
            if (next) setEditMode(false);
            return next;
          }),
          style: btn(palette, annotate ? "primary" : ""),
          title: annotate ? "批注模式已开启：点击元素添加批注" : "开启元素批注模式"
        },
        "📝 批注",
        pendingCount ? `（${pendingCount}）` : ""
      ),
      /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("button", { type: "button", onClick: () => void refresh(), style: btn(palette), title: "从工作区重新读取" }, "⟳ 刷新")
    ),
    conflictBanner,
    /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { display: "flex", flex: 1, minHeight: 0 } }, view === "code" ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
      "div",
      {
        style: {
          flex: 1,
          minWidth: 0,
          overflow: "auto",
          padding: 10,
          background: palette.panel
        }
      },
      /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 6 } }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            try {
              void navigator.clipboard.writeText(html);
              showToast("已复制源码");
            } catch {
              showToast("复制失败，请手动选择");
            }
          },
          style: btn(palette, "small")
        },
        "复制源码"
      ), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: () => downloadTextFile(`${slug || "design"}.html`, html),
          style: btn(palette, "small")
        },
        "下载 HTML"
      )),
      /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "pre",
        {
          style: {
            margin: 0,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11.5,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            color: palette.text
          }
        },
        html || "（空稿件）"
      )
    ) : /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
      "div",
      {
        ref: stageRef,
        style: {
          flex: 1,
          minWidth: 0,
          position: "relative",
          background: palette.panel,
          padding: 10,
          overflow: "auto"
        }
      },
      html ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "div",
        {
          style: {
            width: frameW * scale,
            height: frameH * scale,
            margin: "0 auto",
            position: "relative"
          }
        },
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
          "div",
          {
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              width: frameW,
              height: frameH,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              background: "#ffffff",
              boxShadow: "0 2px 12px rgba(0,0,0,.12)",
              borderRadius: 4,
              overflow: "hidden"
            }
          },
          /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
            "iframe",
            {
              key: docEpoch,
              ref: iframeRef,
              title: `${displayName} canvas`,
              srcDoc: html,
              onLoad: guardCanvasNavigation,
              style: { display: "block", width: "100%", height: "100%", border: 0 }
            }
          )
        )
      ) : /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "div",
        {
          style: {
            height: "100%",
            display: "grid",
            placeItems: "center",
            color: palette.muted
          }
        },
        textFallback || "加载稿件中…"
      ),
      annotate ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "div",
        {
          style: {
            position: "absolute",
            left: 14,
            bottom: 14,
            padding: "4px 10px",
            borderRadius: 6,
            background: "rgba(20,24,40,.85)",
            color: "#fff",
            fontSize: 11.5
          }
        },
        "点击稿件的任意元素添加批注"
      ) : null,
      editMode ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "div",
        {
          style: {
            position: "absolute",
            left: 14,
            bottom: 14,
            padding: "4px 10px",
            borderRadius: 6,
            background: "rgba(20,24,40,.85)",
            color: "#fff",
            fontSize: 11.5
          }
        },
        "点击元素 → 右侧面板修改属性 → 保存"
      ) : null
    ), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
      "div",
      {
        style: {
          flex: "none",
          width: 320,
          maxWidth: "42%",
          borderLeft: `1px solid ${palette.line}`,
          display: "flex",
          flexDirection: "column",
          background: palette.bg,
          minHeight: 0
        }
      },
      /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "div",
        {
          style: {
            flex: "none",
            display: "flex",
            borderBottom: `1px solid ${palette.line}`
          }
        },
        [
          ["notes", `批注${pendingCount ? ` (${pendingCount})` : ""}`],
          ["edit", "✏️ 编辑"],
          ["history", `历史 (${history.length})`]
        ].map(([key, label]) => /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
          "button",
          {
            key,
            type: "button",
            onClick: () => setSideTab(key),
            style: {
              flex: 1,
              padding: "8px 0",
              fontSize: 12,
              fontWeight: sideTab === key ? 700 : 500,
              color: sideTab === key ? palette.accent : palette.muted,
              borderBottom: sideTab === key ? `2px solid ${palette.accent}` : "2px solid transparent",
              background: "transparent",
              cursor: "pointer"
            }
          },
          label
        ))
      ),
      sideTab === "history" ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { flex: 1, overflow: "auto", padding: 8 } }, history.length === 0 ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { color: palette.muted, fontSize: 12, padding: 12 } }, "暂无历史版本。每次 design_update 都会在这里保留一份快照（最多 20 份）。") : history.map((entry) => /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "div",
        {
          key: `${entry.rev}`,
          style: {
            border: `1px solid ${palette.line}`,
            borderRadius: 8,
            padding: "6px 8px",
            marginBottom: 6,
            display: "flex",
            alignItems: "center",
            gap: 8
          }
        },
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
          "span",
          {
            style: {
              fontWeight: 700,
              fontSize: 12,
              color: palette.accent,
              flex: "none"
            }
          },
          "rev ",
          entry.rev
        ),
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("span", { style: { flex: 1, fontSize: 11, color: palette.muted } }, (entry.created_at || "").replace("T", " ").slice(0, 16), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("br", null), (entry.size || 0) / 1024 > 1 ? `${((entry.size || 0) / 1024).toFixed(1)} KB` : `${entry.size || 0} B`),
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
          "button",
          {
            type: "button",
            onClick: () => void previewHistory(entry),
            style: btn(palette, "small"),
            title: "预览该版本"
          },
          "预览"
        ),
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
          "button",
          {
            type: "button",
            onClick: () => rollbackTo(entry),
            style: btn(palette, "warn"),
            title: "让 agent 回滚到该版本"
          },
          "回滚"
        )
      ))) : sideTab === "edit" ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { flex: 1, overflow: "auto", padding: 8, minHeight: 0 } }, !editTarget ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { color: palette.muted, fontSize: 12, padding: 12 } }, "开启「✏️ 编辑」后在画板中点击一个元素，即可修改文本与样式；点「保存」写回工作区（revision 冲突会拦截）。") : /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", null, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, marginBottom: 4 } }, "选中元素"), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "div",
        {
          style: {
            fontSize: 10.5,
            fontFamily: "ui-monospace, monospace",
            color: palette.muted,
            wordBreak: "break-all",
            marginBottom: 8
          }
        },
        editTarget.selector
      ), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(EditField, { palette, label: "文本" }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "textarea",
        {
          value: editDraft.text,
          rows: 2,
          disabled: editTarget.hasChildren,
          onChange: (event) => {
            setEditDraft((draft) => ({ ...draft, text: event.target.value }));
            setEditDirty(true);
          },
          style: { ...fieldInput(palette), resize: "vertical" }
        }
      )), editTarget.hasChildren ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { fontSize: 10.5, color: palette.muted, marginBottom: 8 } }, "该元素包含子元素，文本编辑已禁用（避免破坏结构）。") : null, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(EditField, { palette, label: "字号" }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "input",
        {
          value: editDraft.fontSize,
          placeholder: "如 16px",
          onChange: (event) => {
            setEditDraft((draft) => ({ ...draft, fontSize: event.target.value }));
            setEditDirty(true);
          },
          style: fieldInput(palette)
        }
      )), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(EditField, { palette, label: "文字颜色" }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "input",
        {
          type: "color",
          value: editDraft.color || "#000000",
          onChange: (event) => {
            setEditDraft((draft) => ({ ...draft, color: event.target.value }));
            setEditDirty(true);
          },
          style: { width: 44, height: 28, padding: 0, border: `1px solid ${palette.line}`, borderRadius: 6, background: palette.bg }
        }
      )), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(EditField, { palette, label: "背景色" }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "input",
        {
          type: "color",
          value: editDraft.background || "#ffffff",
          onChange: (event) => {
            setEditDraft((draft) => ({ ...draft, background: event.target.value }));
            setEditDirty(true);
          },
          style: { width: 44, height: 28, padding: 0, border: `1px solid ${palette.line}`, borderRadius: 6, background: palette.bg }
        }
      )), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(EditField, { palette, label: "内边距" }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "input",
        {
          value: editDraft.padding,
          placeholder: "如 12px 或 12px 24px",
          onChange: (event) => {
            setEditDraft((draft) => ({ ...draft, padding: event.target.value }));
            setEditDirty(true);
          },
          style: fieldInput(palette)
        }
      )), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(EditField, { palette, label: "外边距" }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "input",
        {
          value: editDraft.margin,
          placeholder: "如 0 auto",
          onChange: (event) => {
            setEditDraft((draft) => ({ ...draft, margin: event.target.value }));
            setEditDirty(true);
          },
          style: fieldInput(palette)
        }
      )), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(EditField, { palette, label: "对齐" }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "select",
        {
          value: editDraft.textAlign || "",
          onChange: (event) => {
            setEditDraft((draft) => ({ ...draft, textAlign: event.target.value }));
            setEditDirty(true);
          },
          style: fieldInput(palette)
        },
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("option", { value: "" }, "默认"),
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("option", { value: "left" }, "左对齐"),
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("option", { value: "center" }, "居中"),
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("option", { value: "right" }, "右对齐"),
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("option", { value: "justify" }, "两端对齐")
      )), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(EditField, { palette, label: "圆角" }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "input",
        {
          value: editDraft.borderRadius,
          placeholder: "如 8px",
          onChange: (event) => {
            setEditDraft((draft) => ({ ...draft, borderRadius: event.target.value }));
            setEditDirty(true);
          },
          style: fieldInput(palette)
        }
      )), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { display: "flex", gap: 6, marginTop: 8 } }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("button", { type: "button", onClick: () => void saveEdits(), style: btn(palette, "primary") }, "💾 保存", editDirty ? " *" : ""), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: () => {
            setEditTarget(null);
            setEditDirty(false);
            void refresh();
          },
          style: btn(palette)
        },
        "取消"
      )), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { fontSize: 10.5, color: palette.muted, marginTop: 8, lineHeight: 1.5 } }, "保存会先快照旧版本到 history/，再以 rev+1 写回 index.html；若磁盘上的 rev 已变，保存会被拒绝并提示冲突。"))) : /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { flex: 1, overflow: "auto", padding: 8, minHeight: 0 } }, pick ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "div",
        {
          style: {
            border: `1px solid ${palette.accent}`,
            borderRadius: 8,
            padding: 8,
            marginBottom: 8,
            background: palette.panel
          }
        },
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { fontSize: 11.5, fontWeight: 700, marginBottom: 4 } }, "选中元素"),
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
          "div",
          {
            style: {
              fontSize: 10.5,
              fontFamily: "ui-monospace, monospace",
              color: palette.muted,
              wordBreak: "break-all",
              marginBottom: 6
            }
          },
          pick.selector
        ),
        pick.text ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
          "div",
          {
            style: {
              fontSize: 11,
              color: palette.muted,
              fontStyle: "italic",
              marginBottom: 6,
              maxHeight: 34,
              overflow: "hidden"
            }
          },
          "“",
          pick.text,
          "”"
        ) : null,
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
          "textarea",
          {
            value: note,
            placeholder: "批注内容（会发给 agent）",
            onChange: (e) => setNote(e.target.value),
            rows: 2,
            style: {
              width: "100%",
              boxSizing: "border-box",
              resize: "vertical",
              fontSize: 12.5,
              padding: 6,
              borderRadius: 6,
              border: `1px solid ${palette.line}`,
              background: palette.bg,
              color: palette.text
            }
          }
        ),
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
          "label",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 6,
              fontSize: 11,
              color: palette.muted,
              cursor: "pointer"
            }
          },
          /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
            "input",
            {
              type: "checkbox",
              checked: captureWithNote,
              onChange: (event) => setCaptureWithNote(event.target.checked)
            }
          ),
          "附带当前稿件截图（保存到 captures/）"
        ),
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { display: "flex", gap: 6, marginTop: 6 } }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("button", { type: "button", onClick: submitPick, style: btn(palette, "primary") }, "添加批注"), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
          "button",
          {
            type: "button",
            onClick: () => {
              setPick(null);
              setNote("");
            },
            style: btn(palette)
          },
          "取消"
        ))
      ) : null, annotations.length === 0 ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { color: palette.muted, fontSize: 12, padding: 12 } }, annotate ? "点击稿件中的元素即可添加批注。" : "开启「📝 批注」模式后点击稿件的元素添加批注。") : annotations.map((a) => {
        const live = liveAnnotation(a);
        return /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
          "div",
          {
            key: a.id,
            style: {
              border: `1px solid ${palette.line}`,
              borderRadius: 8,
              padding: "6px 8px",
              marginBottom: 6,
              opacity: live ? 1 : 0.55
            }
          },
          /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 3
              }
            },
            /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
              "span",
              {
                style: {
                  fontSize: 10,
                  color: live ? palette.ok : palette.muted,
                  fontWeight: 700,
                  border: `1px solid ${live ? palette.ok : palette.line}`,
                  borderRadius: 999,
                  padding: "0 6px"
                }
              },
              live ? a.status || "open" : "done"
            ),
            /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
              "span",
              {
                style: {
                  fontSize: 10.5,
                  fontFamily: "ui-monospace, monospace",
                  color: palette.muted,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1
                },
                title: a.selector
              },
              a.selector || a.tag
            ),
            (a.created_at || "").slice(0, 10)
          ),
          /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { fontSize: 12, color: palette.text, marginBottom: 5 } }, a.note || a.text),
          /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { display: "flex", gap: 6 } }, live ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
            "button",
            {
              type: "button",
              onClick: () => updateAnnotation(a.id, { status: "done" }),
              style: btn(palette, "small")
            },
            "完成"
          ) : /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
            "button",
            {
              type: "button",
              onClick: () => updateAnnotation(a.id, { status: "open" }),
              style: btn(palette, "small")
            },
            "重开"
          ), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
            "button",
            {
              type: "button",
              onClick: () => {
                setPick({
                  selector: a.selector,
                  tag: a.tag,
                  text: a.text,
                  rect: a.rect || null
                });
                setNote(a.note || "");
              },
              style: btn(palette, "small")
            },
            "编辑"
          ), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
            "button",
            {
              type: "button",
              onClick: () => removeAnnotation(a.id),
              style: btn(palette, "danger")
            },
            "删除"
          ))
        );
      }), /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "button",
        {
          type: "button",
          onClick: requestAgentFix,
          style: { ...btn(palette, "primary"), width: "100%", marginTop: 4 },
          disabled: pendingCount === 0
        },
        "🤖 发送批注给 Agent（",
        pendingCount,
        " 条）"
      ))
    )),
    preview ? /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
      "div",
      {
        style: {
          position: "fixed",
          inset: 0,
          zIndex: 2147483646,
          background: "rgba(10,12,20,.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24
        }
      },
      /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
        "div",
        {
          style: {
            width: "min(92vw, 960px)",
            height: "min(84vh, 640px)",
            background: "#ffffff",
            borderRadius: 12,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 20px 60px rgba(0,0,0,.4)"
          }
        },
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
          "div",
          {
            style: {
              flex: "none",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              background: "#f3f4f6",
              color: "#1f2937"
            }
          },
          /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("b", null, "历史快照 rev ", preview.rev),
          /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("span", { style: { flex: 1 } }),
          /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
            "button",
            {
              type: "button",
              onClick: () => setPreview(null),
              style: { ...btn(palette), color: "#1f2937" }
            },
            "关闭"
          )
        ),
        /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement(
          "iframe",
          {
            title: `rev ${preview.rev} snapshot`,
            srcDoc: preview.html,
            style: { flex: 1, width: "100%", border: 0 }
          }
        )
      )
    ) : null,
    toastEl
  );
}
function fieldInput(palette) {
  return {
    width: "100%",
    boxSizing: "border-box",
    fontSize: 12,
    padding: "4px 6px",
    borderRadius: 6,
    border: `1px solid ${palette.line}`,
    background: palette.bg,
    color: palette.text,
    fontFamily: "inherit"
  };
}
function EditField({ palette, label, children }) {
  return /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { marginBottom: 8 } }, /* @__PURE__ */ __AGENTBUDDY_REACT__.createElement("div", { style: { fontSize: 11, color: palette.muted, marginBottom: 3 } }, label), children);
}
function btn(palette, variant = "") {
  const base = {
    padding: variant === "small" ? "1px 8px" : "4px 12px",
    borderRadius: 7,
    fontSize: variant === "small" ? 11 : 12.5,
    fontWeight: 600,
    border: `1px solid ${palette.line}`,
    background: palette.bg,
    color: palette.text,
    cursor: "pointer",
    lineHeight: 1.5
  };
  if (variant === "primary") {
    return { ...base, background: palette.accent, borderColor: palette.accent, color: palette.accentText };
  }
  if (variant === "warn") {
    return { ...base, borderColor: palette.warnLine, color: palette.warnText, background: palette.warnBg };
  }
  if (variant === "danger") {
    return { ...base, color: "#d5484a", borderColor: palette.line, background: "transparent" };
  }
  return base;
}
const RENDERED_TOOLS = [
  "design_new",
  "design_context",
  "design_update",
  "design_open",
  "design_annotations"
];
function setup(host) {
  host.registerRenderer({
    id: "design_canvas",
    tools: RENDERED_TOOLS,
    component: DesignCanvas
  });
}
const index = { setup };
export {
  index as default,
  setup
};
