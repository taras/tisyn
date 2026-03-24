/**
 * Tisyn execution loop — bridges kernel, journal, and agents.
 *
 * Drives the kernel generator, handles replay/live dispatch,
 * journals Yield/Close events, and enforces persist-before-resume.
 *
 * See Architecture §3.1 and Conformance Suite §3.
 */

import type { Operation } from "effection";
import { spawn, ensure, scoped, withResolvers } from "effection";
import type { TisynExpr as Expr, Val, Json, IrInput } from "@tisyn/ir";
import {
  type DurableEvent,
  type YieldEvent,
  type CloseEvent,
  type EffectDescriptor,
  type EventResult,
  parseEffectId,
  isCompoundExternal,
} from "@tisyn/kernel";
import { DivergenceError, EffectError, RuntimeBugError } from "./errors.js";
import { assertValidIr } from "@tisyn/validate";
import { evaluate, type Env, envFromRecord } from "@tisyn/kernel";
import { type DurableStream, InMemoryStream, ReplayIndex } from "@tisyn/durable-streams";
import { dispatch } from "@tisyn/agent";

export interface ExecuteOptions {
  /** The IR tree to evaluate. */
  ir: IrInput;
  /** Initial environment bindings. */
  env?: Record<string, Val>;
  /** The durable stream for journaling. */
  stream?: DurableStream;
  /** Coroutine ID for the root task. Defaults to "root". */
  coroutineId?: string;
}

export interface ExecuteResult {
  result: EventResult;
  journal: DurableEvent[];
}

/** Shared context passed through driveKernel and orchestration functions. */
interface DriveContext {
  replayIndex: ReplayIndex;
  stream: DurableStream;
  journal: DurableEvent[];
}

/**
 * Execute a Tisyn IR tree with durable journaling and replay.
 *
 * 1. Validate IR
 * 2. Read journal, build ReplayIndex
 * 3. Drive kernel generator with replay/live dispatch
 * 4. Write Yield events (persist-before-resume)
 * 5. Write Close event on completion/error
 */
export function* execute(options: ExecuteOptions): Operation<ExecuteResult> {
  const { ir, env: envRecord = {}, stream = new InMemoryStream(), coroutineId = "root" } = options;

  // Phase 1: Validate IR before evaluation
  let validatedIr: Expr;
  try {
    validatedIr = assertValidIr(ir);
  } catch (error) {
    if (error instanceof Error && error.name === "MalformedIR") {
      // MalformedIR produces NO journal events (Conformance §4.1)
      return {
        result: {
          status: "err",
          error: { message: error.message, name: "MalformedIR" },
        },
        journal: [],
      };
    }
    throw error;
  }

  // Phase 2: Read journal, build ReplayIndex
  const storedEvents = yield* stream.readAll();
  const replayIndex = new ReplayIndex(storedEvents);

  // Track the full journal: replayed events are added as they are
  // consumed, new events are added as they are appended to stream.
  const journal: DurableEvent[] = [];

  // Build initial environment
  const env: Env = envFromRecord(envRecord);

  // Phase 3: Create kernel generator and drive it
  const kernel = evaluate(validatedIr, env);
  const ctx: DriveContext = { replayIndex, stream, journal };

  let result: EventResult;
  try {
    result = yield* driveKernel(kernel, coroutineId, env, ctx);
  } catch (error) {
    if (error instanceof DivergenceError) {
      return {
        result: {
          status: "err" as const,
          error: { message: error.message, name: "DivergenceError" },
        },
        journal,
      };
    }
    throw error;
  }

  return { result, journal };
}

// ── Kernel driver ──

/**
 * Drive a kernel generator to completion with replay/live dispatch.
 *
 * Handles:
 * - Replay from journal (per-coroutineId cursor)
 * - Live dispatch to agents
 * - Compound effect interception (all/race)
 * - Persist-before-resume for yield events
 * - Close event on completion/error
 * - Close(cancelled) on halt via ensure()
 */
function* driveKernel(
  kernel: Generator<EffectDescriptor, Val, Val>,
  coroutineId: string,
  env: Env,
  ctx: DriveContext,
): Operation<EventResult> {
  // Gate ensure() — only write Close(cancelled) if the task was
  // actually halted, not when it completed normally.
  let closed = false;

  yield* ensure(function* () {
    if (!closed) {
      const closeEvent: CloseEvent = {
        type: "close",
        coroutineId,
        result: { status: "cancelled" as const },
      };
      yield* ctx.stream.append(closeEvent);
      ctx.journal.push(closeEvent);
    }
  });

  // Early return for children that were cancelled in a previous run.
  // During replay, their journal has Close(cancelled) but no yield events.
  // Skip the kernel entirely to avoid spurious DivergenceErrors.
  const preClose = ctx.replayIndex.getClose(coroutineId);
  if (preClose && preClose.result.status === "cancelled") {
    closed = true;
    ctx.journal.push(preClose);
    return preClose.result;
  }

  let nextValue: Val = null;

  try {
    for (;;) {
      const step = kernel.next(nextValue);

      if (step.done) {
        closed = true;
        const closeEvent: CloseEvent = {
          type: "close",
          coroutineId,
          result: { status: "ok", value: step.value as Json },
        };
        yield* ctx.stream.append(closeEvent);
        ctx.journal.push(closeEvent);

        return { status: "ok", value: step.value as Json };
      }

      // Kernel yielded an effect descriptor
      const descriptor = step.value as EffectDescriptor;

      // ── Compound effect interception ──
      if (isCompoundExternal(descriptor.id)) {
        // Strip wrapper immediately — must not escape orchestration boundary
        const compoundData = descriptor.data as {
          __tisyn_inner: { exprs: Expr[] };
          __tisyn_env: Env;
        };
        const childEnv = compoundData.__tisyn_env;
        const exprs = compoundData.__tisyn_inner.exprs;

        if (descriptor.id === "all") {
          nextValue = yield* orchestrateAll(exprs, coroutineId, childEnv, ctx);
        } else {
          nextValue = yield* orchestrateRace(exprs, coroutineId, childEnv, ctx);
        }
        // Compound effects do NOT advance parent yieldIndex
        continue;
      }

      // ── Standard effect dispatch ──
      const description = parseEffectId(descriptor.id);

      // Check replay index first
      const stored = ctx.replayIndex.peekYield(coroutineId);

      if (stored) {
        // CASE 1: Replay entry exists — check description match
        if (
          stored.description.type !== description.type ||
          stored.description.name !== description.name
        ) {
          const cursor = ctx.replayIndex.getCursor(coroutineId);
          throw new DivergenceError(
            `Divergence at ${coroutineId}[${cursor}]: ` +
              `expected ${stored.description.type}.${stored.description.name}, ` +
              `got ${description.type}.${description.name}`,
          );
        }

        // Match — consume entry, feed stored result
        ctx.replayIndex.consumeYield(coroutineId);

        const replayedEvent: YieldEvent = {
          type: "yield",
          coroutineId,
          description: stored.description,
          result: stored.result,
        };
        ctx.journal.push(replayedEvent);

        if (stored.result.status === "ok") {
          nextValue = (stored.result.value ?? null) as Val;
        } else if (stored.result.status === "err") {
          const err = new EffectError(stored.result.error.message, stored.result.error.name);
          const throwResult = kernel.throw(err);
          if (throwResult.done) {
            closed = true;
            const closeEvent: CloseEvent = {
              type: "close",
              coroutineId,
              result: { status: "ok", value: throwResult.value as Json },
            };
            yield* ctx.stream.append(closeEvent);
            ctx.journal.push(closeEvent);
            return { status: "ok", value: throwResult.value as Json };
          }
          nextValue = null;
          continue;
        } else {
          throw new Error("Cannot replay cancelled result");
        }

        continue;
      }

      // Check for D2: continue past close
      if (ctx.replayIndex.hasClose(coroutineId)) {
        throw new DivergenceError(
          `Divergence: journal shows ${coroutineId} closed, but generator continues to yield effects`,
        );
      }

      // CASE 3: No replay entry, no close — LIVE dispatch
      let effectResult: EventResult;
      try {
        const resultValue = yield* dispatch(descriptor.id, descriptor.data as Val);
        effectResult = { status: "ok", value: resultValue as Json };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        effectResult = {
          status: "err",
          error: { message: err.message, name: err.name },
        };
      }

      // Persist-before-resume: write Yield event BEFORE resuming kernel
      const yieldEvent: YieldEvent = {
        type: "yield",
        coroutineId,
        description,
        result: effectResult,
      };
      yield* ctx.stream.append(yieldEvent);
      ctx.journal.push(yieldEvent);

      if (effectResult.status === "ok") {
        nextValue = (effectResult.value ?? null) as Val;
      } else {
        const err = new EffectError(effectResult.error.message, effectResult.error.name);
        const throwResult = kernel.throw(err);
        if (throwResult.done) {
          closed = true;
          const closeEvent: CloseEvent = {
            type: "close",
            coroutineId,
            result: { status: "ok", value: throwResult.value as Json },
          };
          yield* ctx.stream.append(closeEvent);
          ctx.journal.push(closeEvent);
          return { status: "ok", value: throwResult.value as Json };
        }
        nextValue = null;
        continue;
      }
    }
  } catch (error) {
    // DivergenceError = journal corruption — persist Close(err) then propagate fatally
    if (error instanceof DivergenceError) {
      closed = true;
      const closeEvent: CloseEvent = {
        type: "close",
        coroutineId,
        result: {
          status: "err",
          error: { message: error.message, name: error.name },
        },
      };
      yield* ctx.stream.append(closeEvent);
      ctx.journal.push(closeEvent);
      throw error;
    }

    closed = true;
    const err = error instanceof Error ? error : new Error(String(error));
    const closeEvent: CloseEvent = {
      type: "close",
      coroutineId,
      result: {
        status: "err",
        error: { message: err.message, name: err.name },
      },
    };
    yield* ctx.stream.append(closeEvent);
    ctx.journal.push(closeEvent);

    return {
      status: "err",
      error: { message: err.message, name: err.name },
    };
  }
}

// ── Compound orchestration ──

/**
 * Orchestrate `all` — spawn N children, collect results in source order.
 *
 * - Empty list → immediate []
 * - All succeed → Val[] in source order
 * - Any fail → halt siblings, propagate lowest-index error
 */
function* orchestrateAll(
  exprs: Expr[],
  parentId: string,
  env: Env,
  ctx: DriveContext,
): Operation<Val> {
  if (exprs.length === 0) return [] as Val;

  const N = exprs.length;
  const { operation, resolve, reject } = withResolvers<Val>();

  yield* scoped(function* () {
    const results: (EventResult | undefined)[] = new Array(N);
    let completed = 0;

    for (let i = 0; i < N; i++) {
      const childId = `${parentId}.${i}`;
      const childKernel = evaluate(exprs[i]!, env);
      yield* spawn(function* () {
        const result = yield* driveKernel(childKernel, childId, env, ctx);
        results[i] = result;
        completed++;

        if (result.status === "err") {
          // Fail-fast: reject immediately, scope teardown halts siblings
          const err = result as {
            status: "err";
            error: { message: string; name?: string };
          };
          reject(new EffectError(err.error.message, err.error.name));
          return;
        }

        if (completed === N) {
          // All children succeeded
          const values = results.map((r) => (r as { status: "ok"; value: Json }).value);
          resolve(values as Val);
        }
      });
    }

    yield* operation;
  });

  return yield* operation;
}

/**
 * Orchestrate `race` — spawn N children, first ok wins.
 *
 * - Empty list → RuntimeBugError
 * - First ok child wins → halt siblings, return winner's value
 * - All fail → propagate lowest-index error
 */
function* orchestrateRace(
  exprs: Expr[],
  parentId: string,
  env: Env,
  ctx: DriveContext,
): Operation<Val> {
  if (exprs.length === 0) {
    throw new RuntimeBugError("race([]) called with empty expression list");
  }

  const N = exprs.length;
  const { operation, resolve, reject } = withResolvers<Val>();

  yield* scoped(function* () {
    const errors: Map<number, { message: string; name?: string }> = new Map();
    let hasWinner = false;
    let completed = 0;

    for (let i = 0; i < N; i++) {
      const childId = `${parentId}.${i}`;
      const childKernel = evaluate(exprs[i]!, env);
      yield* spawn(function* () {
        const result = yield* driveKernel(childKernel, childId, env, ctx);
        completed++;

        if (result.status === "ok" && !hasWinner) {
          hasWinner = true;
          resolve(result.value as Val);
        } else if (result.status === "err") {
          errors.set(i, result.error);
          if (errors.size === N) {
            // All children failed — propagate lowest-index error.
            // NOTE: Spec inconsistency — system spec §8.4 says "last error",
            // compound concurrency spec says "lowest-index error."
            // Implementation follows compound concurrency spec (lowest-index).
            // See audit finding B-1.
            const lowestIdx = Math.min(...errors.keys());
            const err = errors.get(lowestIdx)!;
            reject(new EffectError(err.message, err.name));
          }
        }
      });
    }

    yield* operation;
  });

  return yield* operation;
}
