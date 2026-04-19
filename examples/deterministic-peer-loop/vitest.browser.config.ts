import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/browser/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
