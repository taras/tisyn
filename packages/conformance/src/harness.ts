/**
 * Conformance test harness.
 *
 * Executes fixtures and compares results per Conformance Suite §9.
 *
 * Supports test types: evaluation, effect, replay,
 * negative_validation, negative_runtime.
 */

import { run } from "effection";
import type {
  Expr,
  Val,
  DurableEvent,
  EventResult,
  EffectDescriptor,
} from "@tisyn/shared";
import { canonical, type Json } from "@tisyn/shared";
import { execute, type ExecuteOptions } from "@tisyn/runtime";
import { InMemoryStream } from "@tisyn/durable-streams";
import { AgentRegistry } from "@tisyn/agent";

// ── Fixture types ──

interface BaseFixture {
  id: string;
  suite_version: string;
  tier: "core" | "extended";
  level: number;
  category: string;
  spec_ref: string;
  description: string;
  timeout_ms?: number;
}

export interface EvaluationFixture extends BaseFixture {
  type: "evaluation";
  ir: Expr;
  env: Record<string, Val>;
  expected_result: EventResult;
  expected_journal: DurableEvent[];
}

export interface EffectFixture extends BaseFixture {
  type: "effect";
  ir: Expr;
  env: Record<string, Val>;
  effects: Array<{
    descriptor: EffectDescriptor;
    result: EventResult;
    coroutineId?: string;
  }>;
  expected_result: EventResult;
  expected_journal: DurableEvent[];
}

export interface ReplayFixture extends BaseFixture {
  type: "replay";
  ir: Expr;
  env: Record<string, Val>;
  stored_journal: DurableEvent[];
  live_effects: Array<{
    descriptor: EffectDescriptor;
    result: EventResult;
  }>;
  expected_result: EventResult;
  expected_journal: DurableEvent[];
}

export interface NegativeValidationFixture extends BaseFixture {
  type: "negative_validation";
  ir: unknown;
  expected_error: string;
}

export interface NegativeRuntimeFixture extends BaseFixture {
  type: "negative_runtime";
  ir: Expr;
  env: Record<string, Val>;
  effects: Array<{
    descriptor: EffectDescriptor;
    result: EventResult;
  }>;
  expected_error: string;
  expected_journal: DurableEvent[];
}

export type Fixture =
  | EvaluationFixture
  | EffectFixture
  | ReplayFixture
  | NegativeValidationFixture
  | NegativeRuntimeFixture;

// ── Comparison helpers ──

/**
 * Canonically compare two values.
 * Handles the "<any>" sentinel for error.message fields.
 */
function canonicalEqual(actual: Json, expected: Json): boolean {
  return canonical(actual) === canonical(expected);
}

/**
 * Compare an EventResult with an expected EventResult.
 * Applies "<any>" sentinel for error.message.
 */
function resultMatches(actual: EventResult, expected: EventResult): boolean {
  if (actual.status !== expected.status) return false;

  if (actual.status === "ok" && expected.status === "ok") {
    return canonicalEqual(actual.value, expected.value);
  }

  if (actual.status === "err" && expected.status === "err") {
    // Check name match if expected has one
    if (expected.error.name && actual.error.name !== expected.error.name) {
      return false;
    }
    // "<any>" sentinel for message
    if (expected.error.message === "<any>") {
      return actual.error.message.length > 0;
    }
    return actual.error.message === expected.error.message;
  }

  if (actual.status === "cancelled" && expected.status === "cancelled") {
    return true;
  }

  return false;
}

/**
 * Compare journal events per §9.4 sequential mode.
 */
function journalMatches(
  actual: DurableEvent[],
  expected: DurableEvent[],
): { pass: boolean; message: string } {
  if (actual.length !== expected.length) {
    return {
      pass: false,
      message: `Journal length mismatch: got ${actual.length}, expected ${expected.length}`,
    };
  }

  for (let i = 0; i < expected.length; i++) {
    const a = actual[i]!;
    const e = expected[i]!;

    if (a.type !== e.type) {
      return {
        pass: false,
        message: `Event ${i}: type mismatch: got "${a.type}", expected "${e.type}"`,
      };
    }

    if (a.coroutineId !== e.coroutineId) {
      return {
        pass: false,
        message: `Event ${i}: coroutineId mismatch: got "${a.coroutineId}", expected "${e.coroutineId}"`,
      };
    }

    if (a.type === "yield" && e.type === "yield") {
      if (
        a.description.type !== e.description.type ||
        a.description.name !== e.description.name
      ) {
        return {
          pass: false,
          message: `Event ${i}: description mismatch: got ${a.description.type}.${a.description.name}, expected ${e.description.type}.${e.description.name}`,
        };
      }
    }

    if (!resultMatches(a.result, e.result)) {
      return {
        pass: false,
        message: `Event ${i}: result mismatch: got ${JSON.stringify(a.result)}, expected ${JSON.stringify(e.result)}`,
      };
    }
  }

  return { pass: true, message: "OK" };
}

// ── Fixture runners ──

/**
 * Create an agent registry that feeds predetermined results.
 *
 * For effect and negative_runtime fixtures, effects are provided
 * in order. The agent feeds them sequentially.
 */
function createMockAgents(
  effects: Array<{
    descriptor: EffectDescriptor;
    result: EventResult;
  }>,
): AgentRegistry {
  const agents = new AgentRegistry();
  let effectIndex = 0;

  // Register a catch-all agent that feeds effects in order
  // We use a proxy pattern: register agents for each unique type
  const types = new Set(
    effects.map((e) => {
      const dotIdx = e.descriptor.id.indexOf(".");
      return dotIdx >= 0
        ? e.descriptor.id.substring(0, dotIdx)
        : e.descriptor.id;
    }),
  );

  for (const type of types) {
    // biome-ignore lint/correctness/useYield: synchronous for mock
    agents.register(type, function* (_operation, _args) {
      if (effectIndex >= effects.length) {
        throw new Error("More effects than expected");
      }
      const effect = effects[effectIndex]!;
      effectIndex++;

      if (effect.result.status === "ok") {
        return effect.result.value;
      }
      if (effect.result.status === "err") {
        const err = new Error(effect.result.error.message);
        if (effect.result.error.name) err.name = effect.result.error.name;
        throw err;
      }
      throw new Error("Unexpected cancelled result in mock");
    });
  }

  return agents;
}

export interface FixtureResult {
  id: string;
  pass: boolean;
  message: string;
}

/**
 * Run a single conformance fixture and return pass/fail.
 */
export async function runFixture(fixture: Fixture): Promise<FixtureResult> {
  try {
    switch (fixture.type) {
      case "evaluation":
        return await runEvaluationFixture(fixture);
      case "effect":
        return await runEffectFixture(fixture);
      case "replay":
        return await runReplayFixture(fixture);
      case "negative_validation":
        return await runNegativeValidationFixture(fixture);
      case "negative_runtime":
        return await runNegativeRuntimeFixture(fixture);
      default:
        return {
          id: (fixture as BaseFixture).id,
          pass: false,
          message: `Unknown fixture type: ${(fixture as { type: string }).type}`,
        };
    }
  } catch (error) {
    return {
      id: fixture.id,
      pass: false,
      message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function runEvaluationFixture(
  fixture: EvaluationFixture,
): Promise<FixtureResult> {
  const result = await run(function* () {
    return yield* execute({
      ir: fixture.ir,
      env: fixture.env,
    });
  });

  if (!resultMatches(result.result, fixture.expected_result)) {
    return {
      id: fixture.id,
      pass: false,
      message: `Result mismatch: got ${JSON.stringify(result.result)}, expected ${JSON.stringify(fixture.expected_result)}`,
    };
  }

  const jm = journalMatches(result.journal, fixture.expected_journal);
  if (!jm.pass) {
    return { id: fixture.id, pass: false, message: jm.message };
  }

  return { id: fixture.id, pass: true, message: "PASS" };
}

async function runEffectFixture(
  fixture: EffectFixture,
): Promise<FixtureResult> {
  const agents = createMockAgents(fixture.effects);

  const result = await run(function* () {
    return yield* execute({
      ir: fixture.ir,
      env: fixture.env,
      agents,
    });
  });

  if (!resultMatches(result.result, fixture.expected_result)) {
    return {
      id: fixture.id,
      pass: false,
      message: `Result mismatch: got ${JSON.stringify(result.result)}, expected ${JSON.stringify(fixture.expected_result)}`,
    };
  }

  const jm = journalMatches(result.journal, fixture.expected_journal);
  if (!jm.pass) {
    return { id: fixture.id, pass: false, message: jm.message };
  }

  return { id: fixture.id, pass: true, message: "PASS" };
}

async function runReplayFixture(
  fixture: ReplayFixture,
): Promise<FixtureResult> {
  // Pre-populate stream with stored journal
  const stream = new InMemoryStream(fixture.stored_journal);

  // Create mock agents for live effects (if any)
  const agents = createMockAgents(fixture.live_effects);

  const result = await run(function* () {
    return yield* execute({
      ir: fixture.ir,
      env: fixture.env,
      stream,
      agents,
    });
  });

  if (!resultMatches(result.result, fixture.expected_result)) {
    return {
      id: fixture.id,
      pass: false,
      message: `Result mismatch: got ${JSON.stringify(result.result)}, expected ${JSON.stringify(fixture.expected_result)}`,
    };
  }

  const jm = journalMatches(result.journal, fixture.expected_journal);
  if (!jm.pass) {
    return { id: fixture.id, pass: false, message: jm.message };
  }

  return { id: fixture.id, pass: true, message: "PASS" };
}

async function runNegativeValidationFixture(
  fixture: NegativeValidationFixture,
): Promise<FixtureResult> {
  const result = await run(function* () {
    return yield* execute({
      ir: fixture.ir as Expr,
    });
  });

  // Should be an error result with the expected error type
  if (result.result.status !== "err") {
    return {
      id: fixture.id,
      pass: false,
      message: `Expected error ${fixture.expected_error}, but got status: ${result.result.status}`,
    };
  }

  if (result.result.error.name !== fixture.expected_error) {
    return {
      id: fixture.id,
      pass: false,
      message: `Expected error ${fixture.expected_error}, got ${result.result.error.name}`,
    };
  }

  // MalformedIR MUST NOT produce any journal events
  if (result.journal.length > 0) {
    return {
      id: fixture.id,
      pass: false,
      message: `MalformedIR produced ${result.journal.length} journal events (expected 0)`,
    };
  }

  return { id: fixture.id, pass: true, message: "PASS" };
}

async function runNegativeRuntimeFixture(
  fixture: NegativeRuntimeFixture,
): Promise<FixtureResult> {
  const agents = createMockAgents(fixture.effects);

  const result = await run(function* () {
    return yield* execute({
      ir: fixture.ir,
      env: fixture.env,
      agents,
    });
  });

  if (result.result.status !== "err") {
    return {
      id: fixture.id,
      pass: false,
      message: `Expected error ${fixture.expected_error}, but got status: ${result.result.status}`,
    };
  }

  if (result.result.error.name !== fixture.expected_error) {
    return {
      id: fixture.id,
      pass: false,
      message: `Expected error ${fixture.expected_error}, got ${result.result.error.name}`,
    };
  }

  const jm = journalMatches(result.journal, fixture.expected_journal);
  if (!jm.pass) {
    return { id: fixture.id, pass: false, message: jm.message };
  }

  return { id: fixture.id, pass: true, message: "PASS" };
}
