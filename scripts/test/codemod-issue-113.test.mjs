// Probe-fixture test for scripts/codemod-issue-113.mjs. Runs via node --test.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { rewriteSource } from "../codemod-issue-113.mjs";

test("leaves pure authoring imports untouched", () => {
  const src = `import { agent, operation } from "@tisyn/agent";\n`;
  const { output, changed } = rewriteSource(src);
  assert.equal(changed, false);
  assert.equal(output, src);
});

test("splits a mixed authoring + dispatch import", () => {
  const src =
    `import { agent, operation, Effects, dispatch, invoke } from "@tisyn/agent";\n`;
  const { output, changed } = rewriteSource(src);
  assert.equal(changed, true);
  assert.equal(
    output,
    [
      `import { agent, operation } from "@tisyn/agent";`,
      `import { Effects, dispatch, invoke } from "@tisyn/effects";`,
      "",
    ].join("\n"),
  );
});

test("routes evaluateMiddlewareFn to @tisyn/effects/internal", () => {
  const src = `import { evaluateMiddlewareFn } from "@tisyn/agent";\n`;
  const { output, changed } = rewriteSource(src);
  assert.equal(changed, true);
  assert.equal(
    output,
    `import { evaluateMiddlewareFn } from "@tisyn/effects/internal";\n`,
  );
});

test("preserves type-only declarations on moved names", () => {
  const src = `import type { InvokeOpts, ScopedEffectFrame } from "@tisyn/agent";\n`;
  const { output, changed } = rewriteSource(src);
  assert.equal(changed, true);
  assert.equal(
    output,
    `import type { InvokeOpts, ScopedEffectFrame } from "@tisyn/effects";\n`,
  );
});

test("preserves inline `type` markers and aliases", () => {
  const src = `import { type InvokeOpts, dispatch as d } from "@tisyn/agent";\n`;
  const { output, changed } = rewriteSource(src);
  assert.equal(changed, true);
  assert.equal(
    output,
    `import { type InvokeOpts, dispatch as d } from "@tisyn/effects";\n`,
  );
});

test("does not touch imports from other packages", () => {
  const src = `import { dispatch } from "some-other-pkg";\n`;
  const { output, changed } = rewriteSource(src);
  assert.equal(changed, false);
  assert.equal(output, src);
});

test("splits into all three buckets at once", () => {
  const src =
    `import { agent, Effects, evaluateMiddlewareFn } from "@tisyn/agent";\n`;
  const { output, changed } = rewriteSource(src);
  assert.equal(changed, true);
  assert.equal(
    output,
    [
      `import { agent } from "@tisyn/agent";`,
      `import { Effects } from "@tisyn/effects";`,
      `import { evaluateMiddlewareFn } from "@tisyn/effects/internal";`,
      "",
    ].join("\n"),
  );
});
