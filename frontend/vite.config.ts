import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.VITE_API_TARGET ?? "http://localhost:8000", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router", "swr"],
          markdown: ["react-markdown", "remark-gfm", "rehype-slug", "rehype-autolink-headings", "rehype-highlight"],
          editor: ["@uiw/react-codemirror", "@codemirror/lang-markdown", "@codemirror/language-data"],
        },
      },
    },
  },
});
