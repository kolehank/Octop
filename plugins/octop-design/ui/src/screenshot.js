// Rasterize the design iframe document to a PNG data URL.
//
// Mirrors upstream OpenDesign's SVG <foreignObject> snapshot bridge (see
// open-design `apps/web/src/runtime/srcdoc.ts` → injectSnapshotBridge), but
// simplified: the canvas iframe is same-origin, so we can clone the live
// document instead of round-tripping through postMessage.
//
// Known limits (same as upstream): cross-origin images inside the cloned
// document can taint the canvas; that surfaces as a SecurityError which the
// caller reports instead of silently returning a blank frame.

const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;

/** Strip attributes HTML tolerates but XML parsers reject (:href, @click…). */
function sanitizeForXml(root) {
  const elements = [root, ...root.querySelectorAll("*")];
  for (const el of elements) {
    if (el.nodeType !== 1) continue;
    for (const attr of Array.from(el.attributes || [])) {
      if (!XML_NAME.test(attr.name)) el.removeAttribute(attr.name);
    }
  }
}

export function captureIframePng(iframe, opts = {}) {
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
      // Drop the canvas' own highlight overlay — it is host chrome, not design.
      clone
        .querySelectorAll("[data-octop-design-highlight]")
        .forEach((node) => node.remove());
      clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      sanitizeForXml(clone);
      const serialized = new XMLSerializer().serializeToString(clone);
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
        `<foreignObject x="0" y="0" width="${width}" height="${height}">${serialized}</foreignObject></svg>`;
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

export function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

export function captureTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
