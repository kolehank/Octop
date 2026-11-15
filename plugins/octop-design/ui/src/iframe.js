// Element picking inside the design iframe (dock canvas).
//
// The iframe is rendered with srcdoc and NO sandbox attribute so it stays
// same-origin and we can inject DOM listeners. We work entirely against the
// iframe's own document (native capture listeners, never React synthetic
// events leaking into the host page).

const INTERACTIVE = new Set([
  "A",
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "OPTION",
  "LABEL",
]);

function isInteractive(el) {
  return INTERACTIVE.has(el.tagName) || Boolean(el.closest && el.closest("a,button,input,select,textarea"));
}

function buildSelector(el) {
  // Stable path: tag:nth-of-type(n) chain from the body down, preferring an id
  // when the element carries one (ids survive most rebuilds).
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node.tagName !== "BODY" && node.tagName !== "HTML") {
    const parent = node.parentElement;
    if (!parent) break;
    let index = 1;
    let sib = parent.firstElementChild;
    while (sib !== node) {
      if (sib && sib.tagName === node.tagName) index += 1;
      sib = sib.nextElementSibling;
    }
    parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
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
    docHeight: doc.documentElement.scrollHeight || doc.body?.scrollHeight || rect.height,
  };
}

/**
 * Attach hover-highlight + click-pick to the iframe content.
 * Re-create (dispose + install) when ``enabled`` toggles.
 * @param {HTMLIFrameElement} iframe
 * @param {{enabled: boolean, onPick: (pick: object) => void}} opts
 * @returns {{dispose: () => void}}
 */
export function installCanvas(iframe, opts) {
  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!doc || !doc.body) {
    return { dispose() {} };
  }

  // The canvas is a static preview: mirrors OpenDesign's sandbox shim semantics.
  // In-document anchors stay inside the document; external URLs open in a new
  // tab; relative paths have no usable base in a srcdoc preview (they resolve
  // against the host page and would load the dashboard itself), so they are
  // blocked. Screen switching via JS (data-go / location.hash) is untouched.
  const blockLinkNavigation = (event) => {
    const target = event.target;
    if (!target || target.nodeType !== 1 || !target.closest) return;
    const link = target.closest("a[href], area[href]");
    if (!link) return;
    const href = link.getAttribute("href") ?? "";
    if (href === "" || href === "#" || href.startsWith("#")) {
      // Same-document anchor: scroll/replace hash ourselves so the preview
      // never navigates and hash-driven screen switching keeps working.
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
        /* ignore */
      }
      return;
    }
    if (/^(https?:|mailto:)/i.test(href)) {
      // External link: open off-canvas instead of replacing the preview.
      event.preventDefault();
      try {
        win.open(href, "_blank", "noopener,noreferrer");
      } catch {
        /* popup blocked */
      }
      return;
    }
    // Relative path — nothing it could legitimately resolve to inside a
    // single-file preview.
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
      boxSizing: "border-box",
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
      height: `${rect.height}px`,
    });
  };

  const onClick = (event) => {
    if (disposed || !enabled) return;
    const target = event.target;
    if (!target || target.nodeType !== 1 || !target.closest) return;
    if (target.tagName === "BODY" || target.tagName === "HTML") return;
    if (isInteractive(target)) return; // let real controls behave normally
    event.preventDefault();
    event.stopPropagation();
    const rect = pageRect(target);
    if (rect.w === 0 && rect.h === 0) return;
    opts.onPick?.({
      selector: buildSelector(target),
      tag: target.tagName || "ELEMENT",
      text: (target.textContent || "").trim().slice(0, 120),
      rect,
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
    },
  };
}