import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend dev server proxies /api to the shared TypeScript backend (api-server.ts).
export default defineConfig({
  root: "web",
  envDir: "..",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4173",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
