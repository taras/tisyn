import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@tisyn/code-agent": resolve(__dirname, "../code-agent/src/index.ts"),
      "@tisyn/ir": resolve(__dirname, "../ir/src/index.ts"),
      "@tisyn/agent": resolve(__dirname, "../agent/src/index.ts"),
      "@tisyn/protocol": resolve(__dirname, "../protocol/src/index.ts"),
      "@tisyn/transport": resolve(__dirname, "../transport/src/index.ts"),
    },
  },
  test: {
    exclude: ["node_modules/**", "dist/**"],
    testTimeout: 30_000,
  },
});
