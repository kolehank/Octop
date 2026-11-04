import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Octop server used for /api + WS proxying during local development. */
const octopDevUrl = process.env.OCTOP_DEV_URL ?? "http://127.0.0.1:8088";

export default defineConfig({
  // Served by FastAPI under /screen/* (same origin as /api and the chat WS).
  base: "/screen/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "../src/octop/bigscreen",
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    // The dashboard dev server proxies /screen to this port — fail loudly
    // instead of drifting to another port and breaking that proxy.
    strictPort: true,
    proxy: {
      "/api": {
        target: octopDevUrl,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
