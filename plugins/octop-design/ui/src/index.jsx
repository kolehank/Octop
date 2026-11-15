import { DesignCanvas } from "./DesignCanvas.jsx";

const RENDERED_TOOLS = [
  "design_new",
  "design_context",
  "design_update",
  "design_open",
  "design_annotations",
];

/**
 * Plugin UI entry — the Dashboard loads this as a self-contained ESM and calls
 * setup(host). We register the design_canvas renderer; tools return an
 * octop_ui envelope that routes tool results to it (see main.py).
 */
export function setup(host) {
  host.registerRenderer({
    id: "design_canvas",
    tools: RENDERED_TOOLS,
    component: DesignCanvas,
  });
}

// Support `import mod from "<blob>"; mod.setup(host)` as the loader's fallback.
export default { setup };