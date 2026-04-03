import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: ["./tools/oxlint/tisyn-plugin.mjs"],
  ignorePatterns: ["tools/oxlint/test/fixtures/*"],
  rules: {
    "tisyn/no-local-call-wrapper": "error",
    "tisyn/no-trivial-generator-wrapper": "error",
  },
});
