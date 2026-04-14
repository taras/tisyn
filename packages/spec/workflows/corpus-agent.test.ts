// Unit test for the pilot-local corpus binding. Exercises the real
// install path (`installRemoteAgent` on a real `inprocessTransport`
// factory) and verifies three branches:
//
// 1. `compile` with the frozen originals returns ok=true and a
//    non-empty prompt that embeds both sides.
// 2. `compile` with a mutated original returns ok=false and a
//    non-empty structural diff summary.
// 3. `checkVerdict` recognizes PASS and FAIL verdicts.
//
// The binding handlers destructure `{ input }` because the compiled
// workflow wraps arguments under the ambient contract parameter name,
// so the dispatch calls below mirror that shape.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped } from "effection";
import { dispatch } from "@tisyn/agent";
import { installRemoteAgent } from "@tisyn/transport";
import type { Val } from "@tisyn/ir";
import { corpusDeclaration } from "./agents.ts";
import { createBinding } from "./corpus-agent.ts";

const fixturesDir = resolve(import.meta.dirname, "../corpus/tisyn-cli/__fixtures__");
const originalSpec = readFileSync(resolve(fixturesDir, "original-spec.md"), "utf8");
const originalPlan = readFileSync(resolve(fixturesDir, "original-test-plan.md"), "utf8");

describe("corpus-agent", () => {
  it("compiles the frozen originals to an ok=true report with a prompt", function* () {
    yield* scoped(function* () {
      yield* installRemoteAgent(corpusDeclaration, createBinding().transport);
      const result = (yield* dispatch("corpus.compile", {
        input: { target: "tisyn-cli", originalSpec, originalPlan },
      } as unknown as Val)) as {
        ok: boolean;
        summary: string;
        generatedSpec: string;
        generatedPlan: string;
        prompt: string;
      };
      expect(result.ok).toBe(true);
      expect(result.generatedSpec).toContain("# Tisyn CLI Specification");
      expect(result.generatedPlan.length).toBeGreaterThan(0);
      expect(result.prompt).toContain("=== ORIGINAL SPEC ===");
      expect(result.prompt).toContain("=== GENERATED SPEC ===");
      expect(result.prompt).toContain("STRUCTURAL COMPARISON SUMMARY (spec)");
    });
  });

  it("returns ok=false when the original spec is mutated", function* () {
    yield* scoped(function* () {
      yield* installRemoteAgent(corpusDeclaration, createBinding().transport);
      const mutatedSpec = originalSpec.replace(
        "# Tisyn CLI Specification",
        "# Totally Different Title",
      );
      const result = (yield* dispatch("corpus.compile", {
        input: { target: "tisyn-cli", originalSpec: mutatedSpec, originalPlan },
      } as unknown as Val)) as { ok: boolean; summary: string };
      expect(result.ok).toBe(false);
      expect(result.summary.length).toBeGreaterThan(2);
    });
  });

  it("rejects an unknown target", function* () {
    yield* scoped(function* () {
      yield* installRemoteAgent(corpusDeclaration, createBinding().transport);
      let thrown: unknown;
      try {
        yield* dispatch("corpus.compile", {
          input: { target: "missing", originalSpec, originalPlan },
        } as unknown as Val);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).toContain('unknown target "missing"');
    });
  });

  it("checkVerdict recognizes PASS and FAIL", function* () {
    yield* scoped(function* () {
      yield* installRemoteAgent(corpusDeclaration, createBinding().transport);
      const pass = (yield* dispatch("corpus.checkVerdict", {
        input: { response: "VERDICT: PASS\nok" },
      } as unknown as Val)) as { pass: boolean };
      expect(pass.pass).toBe(true);

      const fail = (yield* dispatch("corpus.checkVerdict", {
        input: { response: "VERDICT: FAIL\nbad" },
      } as unknown as Val)) as { pass: boolean };
      expect(fail.pass).toBe(false);
    });
  });
});
