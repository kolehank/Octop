import { defineConfig } from "vite";

// Self-contained ESM build for the Octop plugin loader
// (dashboard/src/plugins/toolRenderers/loader.ts fetches ui/dist/index.js as a
// blob URL — no relative imports, no external CSS, no react import allowed).
//
// React lives on window.__AGENTBUDDY_REACT__ / __AGENTBUDDY_JSX__ (see
// dashboard/src/plugins/toolRenderers/ensureBuiltins.ts — the code name is
// AGENTBUDDY, NOT OOCTOP/OCTOP; docs/plugin-package.md is stale on this point).
// We compile JSX against that global with the classic runtime so the ESM never
// imports "react" (which would not resolve from inside a blob URL).
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: "src/index.jsx",
      formats: ["es"],
      fileName: () => "index.js",
    },
    target: "es2020",
    minify: false,
    sourcemap: false,
    cssCodeSplit: false,
  },
  esbuild: {
    // (classic) transform mode is the esbuild default once jsxFactory is set.
    jsxFactory: "__AGENTBUDDY_REACT__.createElement",
    jsxFragment: "__AGENTBUDDY_REACT__.Fragment",
  },
});