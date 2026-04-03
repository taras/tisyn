import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: ["../tisyn-plugin.mjs"],
  rules: {
    "tisyn/no-local-call-wrapper": "error",
  },
});
