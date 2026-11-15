import {
  __AGENTBUDDY_REACT__,
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "./react.js";
import {
  wsDownloadText,
  wsDownloadJson,
  wsUploadText,
  wsUploadBlob,
  wsMkdir,
  WS_FILE,
  saveDesignHtml,
  downloadTextFile,
} from "./api.js";
import { captureIframePng, dataUrlToBlob, captureTimestamp } from "./screenshot.js";
import { markDocked, isDocked, mergeHistory } from "./session.js";
import { installCanvas } from "./iframe.js";

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
    ok: "#1d9e6a",
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
    ok: "#3fbf8a",
  },
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
  return (
    "#" +
    [match[1], match[2], match[3]]
      .map((part) => Number(part).toString(16).padStart(2, "0"))
      .join("")
  );
}

const EMPTY_EDIT_DRAFT = {
  text: "",
  fontSize: "",
  color: "#000000",
  background: "",
  padding: "",
  margin: "",
  textAlign: "",
  borderRadius: "",
};

export function DesignCanvas(props) {
  const { host, callId, data, textFallback, toolName } = props;
  const agentId = props.agentId || null;

  const palette = ThemePalette(props);
  const payload = useMemo(() => normalizePayload(data), [data]);
  const slug = typeof payload.slug === "string" ? payload.slug : "";
  // ``refresh()`` re-reads meta.json and updates the header, so the title must
  // be state rather than a value derived from the (stale) tool payload.
  const [title, setTitle] = useState(() =>
    typeof payload.title === "string" ? payload.title : slug || "Design",
  );
  useEffect(() => {
    if (typeof payload.title === "string") setTitle(payload.title);
  }, [payload.title]);
  const toolConflict =
    payload.status === "CONFLICT"
      ? {
          expected: payload.expected,
          revision: payload.revision,
          reason: payload.reason,
        }
      : null;

  // Two shapes of the same component (see session.js header for the heuristic).
  const [mode, setMode] = useState(() => (isDocked(callId) ? "dock" : "card"));
  const [html, setHtml] = useState(
    typeof payload.html === "string" ? payload.html : "",
  );
  const [rev, setRev] = useState(typeof payload.revision === "number" ? payload.revision : 0);
  const [annotations, setAnnotations] = useState(
    Array.isArray(payload.annotations) ? payload.annotations : [],
  );
  const [history, setHistory] = useState(() =>
    mergeHistory(slug, payload.history),
  );
  const [updatedAt, setUpdatedAt] = useState(
    typeof payload.updated_at === "string" ? payload.updated_at : "",
  );
  const [conflict, setConflict] = useState(toolConflict);
  const [annotate, setAnnotate] = useState(false);
  const [pick, setPick] = useState(null);
  const [note, setNote] = useState("");
  const [sideTab, setSideTab] = useState("notes");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [preview, setPreview] = useState(null);
  // Viewer controls: preview/code view, device preset, zoom (auto-fit or manual).
  const [view, setView] = useState("preview");
  const [viewport, setViewport] = useState("desktop");
  const [zoomMode, setZoomMode] = useState("auto");
  const [zoomPercent, setZoomPercent] = useState(100);
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });
  const [contentBox, setContentBox] = useState({ w: 0, h: 0 });
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureWithNote, setCaptureWithNote] = useState(false);
  // Manual element editing (P2): pick element → tweak inline styles → save.
  const [editMode, setEditMode] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editDraft, setEditDraft] = useState(EMPTY_EDIT_DRAFT);
  const [editDirty, setEditDirty] = useState(false);

  const iframeRef = useRef(null);
  const stageRef = useRef(null);
  /** Bumped to force-remount the canvas iframe (recovers from stray navigation). */
  const [docEpoch, setDocEpoch] = useState(0);
  const revRef = useRef(rev);
  useEffect(() => {
    revRef.current = rev;
  }, [rev]);

  const showToast = useCallback(
    (message) => {
      setToast(message);
      if (message) {
        window.setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 4000);
      }
    },
    [],
  );

  const mustFetch = agentId && slug;

  const refresh = useCallback(async () => {
    if (!mustFetch) return;
    setBusy(true);
    try {
      const [indexHtml, metaText, annText] = await Promise.all([
        wsDownloadText(host, agentId, slug, WS_FILE.INDEX),
        wsDownloadText(host, agentId, slug, WS_FILE.META),
        wsDownloadText(host, agentId, slug, WS_FILE.ANNOTATIONS),
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
      // Re-apply the srcdoc snapshot even when the bytes are unchanged, so a
      // canvas that navigated away (clicked link) cannot stay on a foreign page.
      setDocEpoch((n) => n + 1);
    } catch (err) {
      showToast(`读取稿件失败：${err && err.message ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }, [mustFetch, host, agentId, slug, showToast]);

  // One-shot initial refresh for the dock (tool payload may lack the body).
  const initialRefresh = useRef(false);
  useEffect(() => {
    if (mode !== "dock" || initialRefresh.current || !mustFetch) return;
    initialRefresh.current = true;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, mustFetch]);

  // Poll meta.json every 3s when docked; reload everything when the rev moves.
  useEffect(() => {
    if (mode !== "dock" || !mustFetch || props.isStreaming || editMode) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const meta = await wsDownloadJson(host, agentId, slug, WS_FILE.META);
        if (meta && typeof meta.rev === "number" && meta.rev !== revRef.current) {
          await refresh();
        }
      } catch {
        /* transient workspace read — ignore */
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [mode, mustFetch, host, agentId, slug, props.isStreaming, refresh, editMode]);

  // keep the per-slug history cache fresh whenever tool data brings a new list
  useEffect(() => {
    if (Array.isArray(payload.history) && payload.history.length) {
      setHistory(mergeHistory(slug, payload.history));
    }
  }, [slug, payload.history]);

  // ---- annotation persistence -------------------------------------------

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
          JSON.stringify(next, null, 2),
        );
        showToast("批注已保存");
      } catch (err) {
        showToast(`批注保存失败：${err && err.message ? err.message : err}`);
      }
    },
    [mustFetch, host, agentId, slug, showToast],
  );

  const updateAnnotation = useCallback(
    (id, patch) => {
      saveAnnotations(
        annotations.map((a) => (a && a.id === id ? { ...a, ...patch } : a)),
      );
    },
    [annotations, saveAnnotations],
  );

  const removeAnnotation = useCallback(
    (id) => {
      saveAnnotations(annotations.filter((a) => a && a.id !== id));
    },
    [annotations, saveAnnotations],
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
        /* screenshot is best-effort; still save the note */
      }
    }
    const record = {
      id: `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      selector: pick.selector,
      tag: String(pick.tag || "element").toLowerCase(),
      text: pick.text || "",
      note: note.trim() || pick.text || "",
      rect: pick.rect || null,
      created_at: new Date().toISOString(),
      status: "open",
      ...(screenshot ? { screenshot } : {}),
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
    slug,
  ]);

  // ---- agent round-trip --------------------------------------------------

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
      // Fallback (pre-patch hosts): copy & ask the user to paste.
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          void navigator.clipboard.writeText(text);
        }
      } catch {
        /* clipboard may be blocked */
      }
      showToast("已复制；请粘贴发送给 agent");
      return false;
    },
    [host, showToast],
  );

  const requestAgentFix = useCallback(() => {
    const pending = annotations.filter(liveAnnotation);
    if (!pending.length) {
      showToast("没有待处理的批注");
      return;
    }
    const lines = pending.map(
      (a, index) =>
        `${index + 1}. [${a.selector || a.tag || "element"}] ${a.note || a.text || ""}`,
    );
    sendToAgent(
      `按以下批注修改稿件 ${slug}（当前 rev ${rev}）：\n${lines.join("\n")}`,
    );
  }, [annotations, slug, rev, sendToAgent, showToast]);

  const rollbackTo = useCallback(
    (entry) => {
      sendToAgent(
        `把稿件 ${slug}（当前 rev ${rev}）回滚到历史版本 rev ${entry.rev}。` +
          `做法：读取 designs/${slug}/history/${entry.file} 的内容作为新稿，` +
          `先 design_context，再 design_update(html=该内容, expectedRevision=${rev}, slug=${slug})。`,
      );
    },
    [slug, rev, sendToAgent],
  );

  const previewHistory = useCallback(
    async (entry) => {
      if (!mustFetch) return;
      try {
        const fileHtml = await wsDownloadText(
          host,
          agentId,
          slug,
          `history/${entry.file}`,
        );
        setPreview({ ...entry, html: fileHtml });
      } catch (err) {
        showToast(`读取快照失败：${err && err.message ? err.message : err}`);
      }
    },
    [mustFetch, host, agentId, slug, showToast],
  );

  // ---- iframe canvas injection -------------------------------------------

  /** Read the artifact's natural size so auto-fit can scale it into the dock. */
  const measureContent = useCallback(() => {
    const frame = iframeRef.current;
    const doc = frame && frame.contentDocument;
    if (!doc || !doc.documentElement) return;
    const w = Math.max(doc.documentElement.scrollWidth || 0, doc.body?.scrollWidth || 0);
    const h = Math.max(doc.documentElement.scrollHeight || 0, doc.body?.scrollHeight || 0);
    if (w > 0 && h > 0) {
      setContentBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    }
  }, []);

  // Track the stage viewport size (dock resize / sidebar toggle).
  useEffect(() => {
    if (mode !== "dock" || view !== "preview") return undefined;
    const el = stageRef.current;
    if (!el) return undefined;
    const sync = () => {
      // Exclude the 10px stage padding so auto-fit uses the real canvas area.
      const w = Math.max(0, el.clientWidth - 20);
      const h = Math.max(0, el.clientHeight - 20);
      setStageBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
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

  // Re-measure after content / device changes once layout settles.
  useEffect(() => {
    if (mode !== "dock" || view !== "preview") return undefined;
    const timer = window.setTimeout(measureContent, 140);
    return () => window.clearTimeout(timer);
  }, [mode, view, html, docEpoch, viewport, measureContent]);

  const DEVICE_WIDTH = { tablet: 820, mobile: 390 };
  const deviceWidth = DEVICE_WIDTH[viewport] || 0;
  const frameW = deviceWidth || Math.max(contentBox.w, stageBox.w, 0);
  const frameH = Math.max(contentBox.h, stageBox.h, 0);
  const fitScale =
    frameW > 0 && frameH > 0 && stageBox.w > 0 && stageBox.h > 0
      ? Math.min(1, stageBox.w / frameW, stageBox.h / frameH)
      : 1;
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
    [zoomMode, fitScale],
  );

  /** Remount the iframe when it navigated away from the srcdoc snapshot. */
  const guardCanvasNavigation = useCallback((event) => {
    const frame = event.currentTarget;
    let href = "";
    try {
      href = frame.contentWindow?.location?.href || "";
    } catch {
      href = "cross-origin";
    }
    if (href && !href.startsWith("about:srcdoc")) {
      // Only a real navigation escapes; hash updates keep `about:srcdoc#…`,
      // which is still our document (screen switching must not remount).
      setDocEpoch((n) => n + 1);
    }
  }, []);

  const beginPick = useCallback((p) => {
    setPick(p);
    setSideTab("notes");
    setNote("");
    setAnnotate(true);
  }, []);

  /** Edit mode: select an element and seed the property panel from it. */
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
      background:
        computed.backgroundColor && computed.backgroundColor !== "rgba(0, 0, 0, 0)"
          ? rgbToHex(computed.backgroundColor)
          : "",
      padding: computed.padding || "",
      margin: computed.margin || "",
      textAlign: computed.textAlign || "",
      borderRadius: computed.borderRadius || "",
    });
    setEditDirty(false);
  }, []);

  const handleCanvasPick = useCallback(
    (p) => {
      if (editMode) beginEdit(p);
      else beginPick(p);
    },
    [editMode, beginEdit, beginPick],
  );

  /** Push the draft onto the live iframe DOM (instant preview, not yet saved). */
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

  /** Serialize the live canvas back to standalone HTML (drops host chrome). */
  const serializeCanvasHtml = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || !doc.documentElement) return "";
    const clone = doc.documentElement.cloneNode(true);
    clone.querySelectorAll("[data-octop-design-highlight]").forEach((node) => node.remove());
    return `<!doctype html>\n${clone.outerHTML}`;
  }, []);

  /** Save manual edits with the same revision/snapshot rules as design_store. */
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
          reason: "手动编辑保存时发现稿件已被他人修改",
        });
        return;
      }
      setHtml(nextHtml);
      setRev(result.revision);
      setUpdatedAt(new Date().toISOString());
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

  /** Screenshot the canvas and store it under designs/<slug>/captures/. */
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
    if (mode !== "dock" || view !== "preview") return undefined;
    let disposed = false;
    let install = null;
    let timer = 0;
    const tryInstall = () => {
      const frame = iframeRef.current;
      if (!frame || disposed) return;
      if (install) install.dispose();
      install = installCanvas(frame, {
        enabled: annotate || editMode,
        onPick: handleCanvasPick,
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

  // ---- actions ----------------------------------------------------------

  const openDock = useCallback(() => {
    if (!callId) return;
    markDocked(callId);
    host.openSidePanel({
      callId,
      title: title || "Design",
      toolName: toolName || "design_canvas",
    });
  }, [callId, host, title, toolName]);

  const pendingCount = annotations.filter(liveAnnotation).length;
  const displayName = title || slug || "Design";

  // ``design_open`` only asks to show the canvas — jump straight into the dock
  // instead of making the user click through a second, mostly-empty card.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (mode !== "card" || autoOpened.current || !callId || html) return;
    if (toolName !== "design_open") return;
    autoOpened.current = true;
    openDock();
  }, [mode, callId, html, toolName, openDock]);

  // ======================================================================
  //  Render
  // ======================================================================

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: palette.text }}>
        {displayName}
      </span>
      {slug ? (
        <span style={{ fontSize: 11, color: palette.muted }}>{slug}</span>
      ) : null}
      <span
        title="revision"
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: palette.accentText,
          background: palette.accent,
          borderRadius: 999,
          padding: "1px 8px",
        }}
      >
        rev {rev}
      </span>
      {updatedAt ? (
        <span style={{ fontSize: 10.5, color: palette.muted }}>
          {typeof updatedAt === "string" ? updatedAt.replace("T", " ").slice(0, 19) : ""}
        </span>
      ) : null}
    </div>
  );

  const conflictBanner = conflict ? (
    <div
      style={{
        margin: "8px 0",
        padding: "8px 10px",
        borderRadius: 8,
        background: palette.warnBg,
        border: `1px solid ${palette.warnLine}`,
        color: palette.warnText,
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      <b>冲突：稿件已被修改到 rev {conflict.revision}（期望 rev{" "}
        {conflict.expected}）</b>
      {conflict.reason ? <span> — {conflict.reason}</span> : null}
      <br />
      未写入任何内容。请让 agent 先 design_context 重新读取，再 design_update。
      <button
        type="button"
        onClick={() => void refresh()}
        style={{
          marginLeft: 6,
          padding: "2px 10px",
          borderRadius: 6,
          border: `1px solid ${palette.warnLine}`,
          background: "transparent",
          color: palette.warnText,
          fontSize: 11.5,
          cursor: "pointer",
        }}
      >
        重新读取
      </button>
    </div>
  ) : null;

  const toastEl = toast ? (
    <div
      style={{
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
        maxWidth: "70vw",
      }}
    >
      {toast}
    </div>
  ) : null;

  // ---- card shape --------------------------------------------------------

  if (mode === "card") {
    return (
      <div
        style={{
          maxWidth: 460,
          border: `1px solid ${palette.line}`,
          borderRadius: 12,
          background: palette.bg,
          padding: 12,
          color: palette.text,
        }}
      >
        {header}
        {conflictBanner}
        {html ? (
          <div
            style={{
              margin: "10px 0",
              borderRadius: 8,
              overflow: "hidden",
              border: `1px solid ${palette.line}`,
              position: "relative",
            }}
          >
            <iframe
              title={`${displayName} preview`}
              srcDoc={html}
              scrolling="no"
              style={{
                display: "block",
                width: "100%",
                height: 220,
                border: 0,
                pointerEvents: "none",
                background: "#ffffff",
                minHeight: 120,
              }}
            />
          </div>
        ) : (
          <div style={{ padding: "16px 4px", color: palette.muted, fontSize: 13 }}>
            {textFallback || "无稿件内容"}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              setMode("dock");
              void refresh();
            }}
            style={btn(palette, "primary")}
          >
            展开
          </button>
          <button type="button" onClick={openDock} style={btn(palette, "primary")}>
            🖼️ 打开画板
          </button>
          <button
            type="button"
            onClick={() => {
              setSideTab("history");
              openDock();
            }}
            style={btn(palette)}
          >
            版本历史 {history.length ? `(${history.length})` : ""}
          </button>
        </div>
        {toastEl}
      </div>
    );
  }

  // ---- dock shape --------------------------------------------------------

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 420,
        width: "100%",
        background: palette.bg,
        color: palette.text,
        border: `1px solid ${palette.line}`,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* toolbar */}
      <div
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px",
          borderBottom: `1px solid ${palette.line}`,
          background: palette.panel,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 800 }}>🎨 {displayName}</span>
        <span
          title="revision"
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: palette.accentText,
            background: palette.accent,
            borderRadius: 999,
            padding: "1px 8px",
          }}
        >
          rev {rev}
        </span>
        {busy ? <span style={{ fontSize: 11, color: palette.muted }}>同步中…</span> : null}
        <span style={{ flex: 1 }} />
        <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setView("preview")}
            style={btn(palette, view === "preview" ? "primary" : "small")}
            title="预览"
          >
            👁 预览
          </button>
          <button
            type="button"
            onClick={() => setView("code")}
            style={btn(palette, view === "code" ? "primary" : "small")}
            title="查看稿件源码"
          >
            {"</>"} 代码
          </button>
        </span>
        {view === "preview" ? (
          <select
            value={viewport}
            onChange={(event) => {
              setViewport(event.target.value);
              setZoomMode("auto");
            }}
            title="预览设备宽度"
            style={{
              fontSize: 11.5,
              padding: "3px 6px",
              borderRadius: 7,
              border: `1px solid ${palette.line}`,
              background: palette.bg,
              color: palette.text,
            }}
          >
            <option value="desktop">桌面端</option>
            <option value="tablet">平板 820</option>
            <option value="mobile">手机 390</option>
          </select>
        ) : null}
        {view === "preview" ? (
          <span style={{ display: "flex", gap: 2, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => stepZoom(-10)}
              style={btn(palette, "small")}
              title="缩小"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoomMode("auto")}
              style={{ ...btn(palette, "small"), minWidth: 46, textAlign: "center" }}
              title="自动适应 / 100%"
            >
              {shownPercent}%
            </button>
            <button
              type="button"
              onClick={() => stepZoom(10)}
              style={btn(palette, "small")}
              title="放大"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setZoomMode("auto")}
              style={btn(palette, zoomMode === "auto" ? "primary" : "small")}
              title="自动适应画布"
            >
              适应
            </button>
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void captureNow()}
          disabled={captureBusy}
          style={btn(palette)}
          title="截图并保存到 designs/<slug>/captures/"
        >
          {captureBusy ? "截图…" : "📷 截图"}
        </button>
        <button
          type="button"
          onClick={() => downloadTextFile(`${slug || "design"}.html`, html)}
          style={btn(palette)}
          title="导出 HTML"
        >
          ⬇ 导出
        </button>
        <button
          type="button"
          onClick={() => {
            setEditMode((value) => {
              const next = !value;
              if (next) {
                setAnnotate(false);
                setView("preview");
                setSideTab("edit");
              }
              return next;
            });
          }}
          style={btn(palette, editMode ? "primary" : "")}
          title="手动编辑元素（修改后保存为 design_update）"
        >
          ✏️ 编辑
        </button>
        <button
          type="button"
          onClick={() =>
            setAnnotate((value) => {
              const next = !value;
              if (next) setEditMode(false);
              return next;
            })
          }
          style={btn(palette, annotate ? "primary" : "")}
          title={annotate ? "批注模式已开启：点击元素添加批注" : "开启元素批注模式"}
        >
          📝 批注{pendingCount ? `（${pendingCount}）` : ""}
        </button>
        <button type="button" onClick={() => void refresh()} style={btn(palette)} title="从工作区重新读取">
          ⟳ 刷新
        </button>
      </div>
      {conflictBanner}
      {/* body */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {view === "code" ? (
          <div
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "auto",
              padding: 10,
              background: palette.panel,
            }}
          >
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <button
                type="button"
                onClick={() => {
                  try {
                    void navigator.clipboard.writeText(html);
                    showToast("已复制源码");
                  } catch {
                    showToast("复制失败，请手动选择");
                  }
                }}
                style={btn(palette, "small")}
              >
                复制源码
              </button>
              <button
                type="button"
                onClick={() => downloadTextFile(`${slug || "design"}.html`, html)}
                style={btn(palette, "small")}
              >
                下载 HTML
              </button>
            </div>
            <pre
              style={{
                margin: 0,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 11.5,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                color: palette.text,
              }}
            >
              {html || "（空稿件）"}
            </pre>
          </div>
        ) : (
          <div
            ref={stageRef}
            style={{
              flex: 1,
              minWidth: 0,
              position: "relative",
              background: palette.panel,
              padding: 10,
              overflow: "auto",
            }}
          >
            {html ? (
              <div
                style={{
                  width: frameW * scale,
                  height: frameH * scale,
                  margin: "0 auto",
                  position: "relative",
                }}
              >
                <div
                  style={{
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
                    overflow: "hidden",
                  }}
                >
                  <iframe
                    key={docEpoch}
                    ref={iframeRef}
                    title={`${displayName} canvas`}
                    srcDoc={html}
                    onLoad={guardCanvasNavigation}
                    style={{ display: "block", width: "100%", height: "100%", border: 0 }}
                  />
                </div>
              </div>
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "grid",
                  placeItems: "center",
                  color: palette.muted,
                }}
              >
                {textFallback || "加载稿件中…"}
              </div>
            )}
            {annotate ? (
              <div
                style={{
                  position: "absolute",
                  left: 14,
                  bottom: 14,
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: "rgba(20,24,40,.85)",
                  color: "#fff",
                  fontSize: 11.5,
                }}
              >
                点击稿件的任意元素添加批注
              </div>
            ) : null}
            {editMode ? (
              <div
                style={{
                  position: "absolute",
                  left: 14,
                  bottom: 14,
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: "rgba(20,24,40,.85)",
                  color: "#fff",
                  fontSize: 11.5,
                }}
              >
                点击元素 → 右侧面板修改属性 → 保存
              </div>
            ) : null}
          </div>
        )}

        {/* sidebar */}
        <div
          style={{
            flex: "none",
            width: 320,
            maxWidth: "42%",
            borderLeft: `1px solid ${palette.line}`,
            display: "flex",
            flexDirection: "column",
            background: palette.bg,
            minHeight: 0,
          }}
        >
          <div
            style={{
              flex: "none",
              display: "flex",
              borderBottom: `1px solid ${palette.line}`,
            }}
          >
            {[
              ["notes", `批注${pendingCount ? ` (${pendingCount})` : ""}`],
              ["edit", "✏️ 编辑"],
              ["history", `历史 (${history.length})`],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSideTab(key)}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  fontSize: 12,
                  fontWeight: sideTab === key ? 700 : 500,
                  color: sideTab === key ? palette.accent : palette.muted,
                  borderBottom: sideTab === key ? `2px solid ${palette.accent}` : "2px solid transparent",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {sideTab === "history" ? (
            <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
              {history.length === 0 ? (
                <div style={{ color: palette.muted, fontSize: 12, padding: 12 }}>
                  暂无历史版本。每次 design_update 都会在这里保留一份快照（最多 20 份）。
                </div>
              ) : (
                history.map((entry) => (
                  <div
                    key={`${entry.rev}`}
                    style={{
                      border: `1px solid ${palette.line}`,
                      borderRadius: 8,
                      padding: "6px 8px",
                      marginBottom: 6,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 12,
                        color: palette.accent,
                        flex: "none",
                      }}
                    >
                      rev {entry.rev}
                    </span>
                    <span style={{ flex: 1, fontSize: 11, color: palette.muted }}>
                      {(entry.created_at || "").replace("T", " ").slice(0, 16)}
                      <br />
                      {(entry.size || 0) / 1024 > 1
                        ? `${((entry.size || 0) / 1024).toFixed(1)} KB`
                        : `${entry.size || 0} B`}
                    </span>
                    <button
                      type="button"
                      onClick={() => void previewHistory(entry)}
                      style={btn(palette, "small")}
                      title="预览该版本"
                    >
                      预览
                    </button>
                    <button
                      type="button"
                      onClick={() => rollbackTo(entry)}
                      style={btn(palette, "warn")}
                      title="让 agent 回滚到该版本"
                    >
                      回滚
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : sideTab === "edit" ? (
            <div style={{ flex: 1, overflow: "auto", padding: 8, minHeight: 0 }}>
              {!editTarget ? (
                <div style={{ color: palette.muted, fontSize: 12, padding: 12 }}>
                  开启「✏️ 编辑」后在画板中点击一个元素，即可修改文本与样式；点「保存」写回工作区（revision 冲突会拦截）。
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>
                    选中元素
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      fontFamily: "ui-monospace, monospace",
                      color: palette.muted,
                      wordBreak: "break-all",
                      marginBottom: 8,
                    }}
                  >
                    {editTarget.selector}
                  </div>
                  <EditField palette={palette} label="文本">
                    <textarea
                      value={editDraft.text}
                      rows={2}
                      disabled={editTarget.hasChildren}
                      onChange={(event) => {
                        setEditDraft((draft) => ({ ...draft, text: event.target.value }));
                        setEditDirty(true);
                      }}
                      style={{ ...fieldInput(palette), resize: "vertical" }}
                    />
                  </EditField>
                  {editTarget.hasChildren ? (
                    <div style={{ fontSize: 10.5, color: palette.muted, marginBottom: 8 }}>
                      该元素包含子元素，文本编辑已禁用（避免破坏结构）。
                    </div>
                  ) : null}
                  <EditField palette={palette} label="字号">
                    <input
                      value={editDraft.fontSize}
                      placeholder="如 16px"
                      onChange={(event) => {
                        setEditDraft((draft) => ({ ...draft, fontSize: event.target.value }));
                        setEditDirty(true);
                      }}
                      style={fieldInput(palette)}
                    />
                  </EditField>
                  <EditField palette={palette} label="文字颜色">
                    <input
                      type="color"
                      value={editDraft.color || "#000000"}
                      onChange={(event) => {
                        setEditDraft((draft) => ({ ...draft, color: event.target.value }));
                        setEditDirty(true);
                      }}
                      style={{ width: 44, height: 28, padding: 0, border: `1px solid ${palette.line}`, borderRadius: 6, background: palette.bg }}
                    />
                  </EditField>
                  <EditField palette={palette} label="背景色">
                    <input
                      type="color"
                      value={editDraft.background || "#ffffff"}
                      onChange={(event) => {
                        setEditDraft((draft) => ({ ...draft, background: event.target.value }));
                        setEditDirty(true);
                      }}
                      style={{ width: 44, height: 28, padding: 0, border: `1px solid ${palette.line}`, borderRadius: 6, background: palette.bg }}
                    />
                  </EditField>
                  <EditField palette={palette} label="内边距">
                    <input
                      value={editDraft.padding}
                      placeholder="如 12px 或 12px 24px"
                      onChange={(event) => {
                        setEditDraft((draft) => ({ ...draft, padding: event.target.value }));
                        setEditDirty(true);
                      }}
                      style={fieldInput(palette)}
                    />
                  </EditField>
                  <EditField palette={palette} label="外边距">
                    <input
                      value={editDraft.margin}
                      placeholder="如 0 auto"
                      onChange={(event) => {
                        setEditDraft((draft) => ({ ...draft, margin: event.target.value }));
                        setEditDirty(true);
                      }}
                      style={fieldInput(palette)}
                    />
                  </EditField>
                  <EditField palette={palette} label="对齐">
                    <select
                      value={editDraft.textAlign || ""}
                      onChange={(event) => {
                        setEditDraft((draft) => ({ ...draft, textAlign: event.target.value }));
                        setEditDirty(true);
                      }}
                      style={fieldInput(palette)}
                    >
                      <option value="">默认</option>
                      <option value="left">左对齐</option>
                      <option value="center">居中</option>
                      <option value="right">右对齐</option>
                      <option value="justify">两端对齐</option>
                    </select>
                  </EditField>
                  <EditField palette={palette} label="圆角">
                    <input
                      value={editDraft.borderRadius}
                      placeholder="如 8px"
                      onChange={(event) => {
                        setEditDraft((draft) => ({ ...draft, borderRadius: event.target.value }));
                        setEditDirty(true);
                      }}
                      style={fieldInput(palette)}
                    />
                  </EditField>
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button type="button" onClick={() => void saveEdits()} style={btn(palette, "primary")}>
                      💾 保存{editDirty ? " *" : ""}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditTarget(null);
                        setEditDirty(false);
                        void refresh();
                      }}
                      style={btn(palette)}
                    >
                      取消
                    </button>
                  </div>
                  <div style={{ fontSize: 10.5, color: palette.muted, marginTop: 8, lineHeight: 1.5 }}>
                    保存会先快照旧版本到 history/，再以 rev+1 写回 index.html；若磁盘上的 rev 已变，保存会被拒绝并提示冲突。
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ flex: 1, overflow: "auto", padding: 8, minHeight: 0 }}>
              {pick ? (
                <div
                  style={{
                    border: `1px solid ${palette.accent}`,
                    borderRadius: 8,
                    padding: 8,
                    marginBottom: 8,
                    background: palette.panel,
                  }}
                >
                  <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 4 }}>
                    选中元素
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      fontFamily: "ui-monospace, monospace",
                      color: palette.muted,
                      wordBreak: "break-all",
                      marginBottom: 6,
                    }}
                  >
                    {pick.selector}
                  </div>
                  {pick.text ? (
                    <div
                      style={{
                        fontSize: 11,
                        color: palette.muted,
                        fontStyle: "italic",
                        marginBottom: 6,
                        maxHeight: 34,
                        overflow: "hidden",
                      }}
                    >
                      “{pick.text}”
                    </div>
                  ) : null}
                  <textarea
                    value={note}
                    placeholder="批注内容（会发给 agent）"
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      resize: "vertical",
                      fontSize: 12.5,
                      padding: 6,
                      borderRadius: 6,
                      border: `1px solid ${palette.line}`,
                      background: palette.bg,
                      color: palette.text,
                    }}
                  />
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 6,
                      fontSize: 11,
                      color: palette.muted,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={captureWithNote}
                      onChange={(event) => setCaptureWithNote(event.target.checked)}
                    />
                    附带当前稿件截图（保存到 captures/）
                  </label>
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button type="button" onClick={submitPick} style={btn(palette, "primary")}>
                      添加批注
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPick(null);
                        setNote("");
                      }}
                      style={btn(palette)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : null}

              {annotations.length === 0 ? (
                <div style={{ color: palette.muted, fontSize: 12, padding: 12 }}>
                  {annotate
                    ? "点击稿件中的元素即可添加批注。"
                    : "开启「📝 批注」模式后点击稿件的元素添加批注。"}
                </div>
              ) : (
                annotations.map((a) => {
                  const live = liveAnnotation(a);
                  return (
                    <div
                      key={a.id}
                      style={{
                        border: `1px solid ${palette.line}`,
                        borderRadius: 8,
                        padding: "6px 8px",
                        marginBottom: 6,
                        opacity: live ? 1 : 0.55,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: 3,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            color: live ? palette.ok : palette.muted,
                            fontWeight: 700,
                            border: `1px solid ${live ? palette.ok : palette.line}`,
                            borderRadius: 999,
                            padding: "0 6px",
                          }}
                        >
                          {live ? a.status || "open" : "done"}
                        </span>
                        <span
                          style={{
                            fontSize: 10.5,
                            fontFamily: "ui-monospace, monospace",
                            color: palette.muted,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                          }}
                          title={a.selector}
                        >
                          {a.selector || a.tag}
                        </span>
                        {(a.created_at || "").slice(0, 10)}
                      </div>
                      <div style={{ fontSize: 12, color: palette.text, marginBottom: 5 }}>
                        {a.note || a.text}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {live ? (
                          <button
                            type="button"
                            onClick={() => updateAnnotation(a.id, { status: "done" })}
                            style={btn(palette, "small")}
                          >
                            完成
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => updateAnnotation(a.id, { status: "open" })}
                            style={btn(palette, "small")}
                          >
                            重开
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setPick({
                              selector: a.selector,
                              tag: a.tag,
                              text: a.text,
                              rect: a.rect || null,
                            });
                            setNote(a.note || "");
                          }}
                          style={btn(palette, "small")}
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => removeAnnotation(a.id)}
                          style={btn(palette, "danger")}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  );
                })
              )}

              <button
                type="button"
                onClick={requestAgentFix}
                style={{ ...btn(palette, "primary"), width: "100%", marginTop: 4 }}
                disabled={pendingCount === 0}
              >
                🤖 发送批注给 Agent（{pendingCount} 条）
              </button>
            </div>
          )}
        </div>
      </div>

      {/* history snapshot preview overlay */}
      {preview ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2147483646,
            background: "rgba(10,12,20,.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            style={{
              width: "min(92vw, 960px)",
              height: "min(84vh, 640px)",
              background: "#ffffff",
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 20px 60px rgba(0,0,0,.4)",
            }}
          >
            <div
              style={{
                flex: "none",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                background: "#f3f4f6",
                color: "#1f2937",
              }}
            >
              <b>历史快照 rev {preview.rev}</b>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setPreview(null)}
                style={{ ...btn(palette), color: "#1f2937" }}
              >
                关闭
              </button>
            </div>
            <iframe
              title={`rev ${preview.rev} snapshot`}
              srcDoc={preview.html}
              style={{ flex: 1, width: "100%", border: 0 }}
            />
          </div>
        </div>
      ) : null}

      {toastEl}
    </div>
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
    fontFamily: "inherit",
  };
}

function EditField({ palette, label, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: palette.muted, marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  );
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
    lineHeight: 1.5,
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