import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "./", // Crucial for Electron to load assets via file:// protocol
  resolve: {
    alias: {
      electron: path.resolve(process.cwd(), "__mocks__/electron.js"),
      typeorm: path.resolve(process.cwd(), "__mocks__/typeorm.js"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    globals: true,
    environment: "node",
    server: {
      deps: {
        inline: ["typeorm", "electron"],
      },
    },
  },
});
