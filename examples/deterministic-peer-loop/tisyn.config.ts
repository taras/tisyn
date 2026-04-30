import { defineConfig } from "@tisyn/cli";

export default defineConfig({
  generates: [
    {
      name: "dom-workflows",
      input: "test/browser/workflows/dom-declarations.ts",
      include: ["test/browser/workflows/dom/**/*.workflow.ts"],
      output: "test/browser/dom-workflows.generated.ts",
      format: "json",
    },
    {
      name: "host-workflows",
      input: "test/browser/workflows/host-declarations.ts",
      include: ["test/browser/workflows/*.workflow.ts"],
      output: "test/browser/host-workflows.generated.ts",
    },
  ],
});
