import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { workerPlugin } from "./vite-plugin-worker";

export default defineConfig({
  plugins: [react(), workerPlugin()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
