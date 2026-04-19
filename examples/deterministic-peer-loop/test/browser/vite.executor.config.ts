import { defineConfig } from "vite";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    lib: {
      entry: resolve(__dirname, "helpers/in-page-executor.ts"),
      formats: ["iife"],
      name: "TisynTestExecutor",
      fileName: "tisyn-test-executor",
    },
    outDir: resolve(__dirname, "dist-executor"),
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
