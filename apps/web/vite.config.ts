import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

const coreOrigin = process.env.NIAN_CORE_ORIGIN ?? "http://127.0.0.1:38085";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    host: "0.0.0.0",
    port: 33005,
    watch: {
      ignored: ["**/.*.tmpdir/**", "**/*.tmp", "**/node_modules/**"],
    },
    proxy: Object.fromEntries(
      ["/.well-known", "/nian", "/console", "/health", "/schemas"].map((path) => [
        path,
        { changeOrigin: true, target: coreOrigin },
      ]),
    ),
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("element-plus") || id.includes("@element-plus")) return "element-plus";
          if (id.includes("node_modules")) return "vendor";
          return undefined;
        },
      },
    },
  },
});
