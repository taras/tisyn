import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@tisyn/ir": resolve(__dirname, "../ir/src/index.ts"),
      "@tisyn/kernel": resolve(__dirname, "../kernel/src/index.ts"),
      "@tisyn/agent": resolve(__dirname, "../agent/src/index.ts"),
      "@tisyn/protocol": resolve(__dirname, "../protocol/src/index.ts"),
      "@tisyn/runtime": resolve(__dirname, "../runtime/src/index.ts"),
      "@tisyn/validate": resolve(__dirname, "../validate/src/index.ts"),
    },
  },
  test: {
    exclude: ["node_modules/**", "dist/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
