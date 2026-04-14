// Wrapper script: read frozen fixtures, install Claude transport
// (SDK in live mode, mock in --skip-claude mode), install output
// sink, run the verification workflow, print the result, and exit
// with the corresponding status.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { run, scoped } from "effection";
import type { Operation } from "effection";
import { Agents } from "@tisyn/agent";
import { installRemoteAgent } from "@tisyn/transport";
import { createMockClaudeCodeTransport, createSdkBinding } from "@tisyn/claude-code";
import type { Val } from "@tisyn/ir";
import { claudeCodeDeclaration, outputDeclaration } from "../workflows/agents.ts";
import { verifyCliCorpus } from "../workflows/verify-cli-corpus.ts";
import type { VerifyResult } from "../workflows/verify-cli-corpus.ts";

const skipClaude = process.argv.includes("--skip-claude");

const fixturesDir = resolve(import.meta.dirname, "../corpus/tisyn-cli/__fixtures__");
const originalSpec = readFileSync(resolve(fixturesDir, "original-spec.md"), "utf8");
const originalPlan = readFileSync(resolve(fixturesDir, "original-test-plan.md"), "utf8");

function* main(): Operation<VerifyResult> {
  const claudeFactory = skipClaude
    ? createMockClaudeCodeTransport({}).factory
    : createSdkBinding({ model: "claude-sonnet-4-6" }).transport;

  return yield* scoped(function* () {
    yield* installRemoteAgent(claudeCodeDeclaration, claudeFactory);
    yield* Agents.use(outputDeclaration, {
      *log(input) {
        const { label, text } = input as unknown as {
          label: string;
          text: string;
        };
        process.stdout.write(`\n── ${label} ──\n${text}\n`);
        return null as unknown as Val;
      },
    });

    return yield* verifyCliCorpus({
      originalSpec,
      originalPlan,
      skipClaude,
    });
  });
}

const result = await run(main);
process.stdout.write(`\n${JSON.stringify(result, null, 2)}\n`);
process.exit(result.ok ? 0 : 1);
