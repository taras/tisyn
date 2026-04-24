import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@tisyn\/ir$/, replacement: resolve(__dirname, "../ir/src/index.ts") },
      { find: /^@tisyn\/kernel$/, replacement: resolve(__dirname, "../kernel/src/index.ts") },
      { find: /^@tisyn\/agent$/, replacement: resolve(__dirname, "../agent/src/index.ts") },
      { find: /^@tisyn\/protocol$/, replacement: resolve(__dirname, "../protocol/src/index.ts") },
      { find: /^@tisyn\/runtime$/, replacement: resolve(__dirname, "../runtime/src/index.ts") },
      { find: /^@tisyn\/runtime\/execute$/, replacement: resolve(__dirname, "../runtime/src/execute.ts") },
      { find: /^@tisyn\/validate$/, replacement: resolve(__dirname, "../validate/src/index.ts") },
    ],
  },
  test: {
    exclude: ["node_modules/**", "dist/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
