import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Plain Vite config so any host (Bolt, StackBlitz, Netlify, a laptop) can start it as is.
export default defineConfig({
  // Relative base so the build works at /, /quick-chess/, /lab/quick-chess/ or anywhere else.
  base: "./",
  plugins: [react()],
});
