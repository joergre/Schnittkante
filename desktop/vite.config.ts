import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: dir,
  base: "./",
  publicDir: path.join(dir, "../public"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.join(dir, "../src") },
  },
  build: {
    outDir: path.join(dir, "dist"),
    emptyOutDir: true,
  },
});
