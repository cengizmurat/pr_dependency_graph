import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // The Rare UI components import their helper as "@/lib/utils", the
      // shadcn convention, so the alias is kept rather than rewriting them.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
