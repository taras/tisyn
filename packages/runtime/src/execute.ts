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
import {
  DivergenceError,
  EffectError,
  RuntimeBugError,
  ScopeBindingEffectError,
} from "./errors.js";
import { assertValidIr } from "@tisyn/validate";
import { evaluate, type Env, envFromRecord } from "@tisyn/kernel";
import { type DurableStream, InMemoryStream, ReplayIndex } from "@tisyn/durable-streams";
import {
  dispatch,
  installEnforcement,
  evaluateMiddlewareFn,
  BoundAgentsContext,
} from "@tisyn/agent";
import { installAgentTransport, type AgentTransportFactory } from "@tisyn/transport";
import { useScope } from "effection";
import type { FnNode } from "@tisyn/ir";

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

interface ScopeInner {
  handler: FnNode | null;
  bindings: Record<string, Expr>;
  body: Expr;
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
  // When kernel.throw() yields a new effect (e.g., from catch/finally bodies),
  // we store it here so the next loop iteration processes it without calling kernel.next().
  let pendingStep: IteratorResult<EffectDescriptor, Val> | null = null;
  // Unified counter for all compound-external children (scope, all, race, spawn) — replay-safe.
  let childSpawnCount = 0;
  // Spawn/join tracking
  const spawnedTasks = new Map<string, { operation: Operation<EventResult> }>();
  const joinedTasks = new Set<string>();

  // scoped() binds spawned children to the parent's lifetime:
  // children are alive while the parent runs, torn down when the parent exits.
  return yield* scoped(function* () {
    try {
      for (;;) {
        const step = pendingStep ?? kernel.next(nextValue);
        pendingStep = null;

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
          const compoundData = descriptor.data as { __tisyn_inner: unknown; __tisyn_env: Env };
          const childEnv = compoundData.__tisyn_env;

          if (descriptor.id === "scope") {
            const inner = compoundData.__tisyn_inner as ScopeInner;
            const childId = `${coroutineId}.${childSpawnCount++}`;
            let scopeValue: Val = null;
            let scopeErr: Error | null = null;
            try {
              scopeValue = yield* orchestrateScope(inner, childId, childEnv, ctx);
            } catch (e) {
              scopeErr = e instanceof Error ? e : new Error(String(e));
            }
            if (scopeErr === null) {
              nextValue = scopeValue;
            } else {
              // T14: route through parent kernel so parent try/catch can intercept
              const throwResult = kernel.throw(scopeErr);
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
              pendingStep = throwResult;
              nextValue = null;
            }
          } else if (descriptor.id === "spawn") {
            // R1: deterministic child ID
            const childId = `${coroutineId}.${childSpawnCount++}`;
            const inner = compoundData.__tisyn_inner as { body: Expr };
            const childKernel = evaluate(inner.body, childEnv);

            const {
              operation: joinOp,
              resolve: joinResolve,
              reject: joinReject,
            } = withResolvers<EventResult>();
            spawnedTasks.set(childId, { operation: joinOp });

            // Background task — drives child kernel concurrently
            yield* spawn(function* () {
              try {
                const result = yield* driveKernel(childKernel, childId, childEnv, ctx);
                joinResolve(result);
                if (result.status === "err") {
                  // R12: child failure tears down parent scope unconditionally
                  const errResult = result as {
                    status: "err";
                    error: { message: string; name?: string };
                  };
                  throw new EffectError(errResult.error.message, errResult.error.name);
                }
              } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                joinReject(err);
                throw err; // R12: propagate to tear down parent Effection scope
              }
            });

            // R4: resume parent immediately with task handle
            nextValue = { __tisyn_task: childId } as Val;
          } else if (descriptor.id === "join") {
            // Join data is the resolved Ref value (task handle)
            const taskHandle = compoundData.__tisyn_inner as Val;

            // Runtime invariant: verify task handle shape
            if (
              taskHandle === null ||
              typeof taskHandle !== "object" ||
              typeof (taskHandle as Record<string, unknown>).__tisyn_task !== "string"
            ) {
              throw new RuntimeBugError("join: inner value is not a valid task handle");
            }

            const childId = (taskHandle as { __tisyn_task: string }).__tisyn_task;

            // R8: double-join check
            if (joinedTasks.has(childId)) {
              throw new RuntimeBugError(`join: task '${childId}' has already been joined`);
            }
            joinedTasks.add(childId);

            // Look up the spawned task's join operation
            const entry = spawnedTasks.get(childId);
            if (!entry) {
              throw new RuntimeBugError(`join: no spawned task found for '${childId}'`);
            }

            // R6: wait for child completion
            const childResult = yield* entry.operation;

            // R7: resume parent with child's return value
            if (childResult.status === "ok") {
              nextValue = (childResult.value ?? null) as Val;
            } else {
              const errResult = childResult as {
                status: "err";
                error: { message: string; name?: string };
              };
              throw new EffectError(errResult.error.message, errResult.error.name);
            }
          } else {
            const inner = compoundData.__tisyn_inner as { exprs: Expr[] };
            const exprs = inner.exprs;
            const startIndex = childSpawnCount;
            childSpawnCount += exprs.length;
            if (descriptor.id === "all") {
              nextValue = yield* orchestrateAll(exprs, coroutineId, startIndex, childEnv, ctx);
            } else {
              nextValue = yield* orchestrateRace(exprs, coroutineId, startIndex, childEnv, ctx);
            }
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
            // kernel.throw() yielded a new effect (e.g., from catch/finally body)
            pendingStep = throwResult;
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
          // kernel.throw() yielded a new effect (e.g., from catch/finally body)
          pendingStep = throwResult;
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
  }); // end scoped — tears down unjoined spawned children
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
  startIndex: number,
  env: Env,
  ctx: DriveContext,
): Operation<Val> {
  if (exprs.length === 0) return [] as Val;

  const N = exprs.length;
  const { operation, resolve, reject } = withResolvers<Val>();

  yield* scoped(function* () {
    const results: (EventResult | undefined)[] = Array.from({ length: N });
    let completed = 0;

    for (let i = 0; i < N; i++) {
      const childId = `${parentId}.${startIndex + i}`;
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
  startIndex: number,
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

    for (let i = 0; i < N; i++) {
      const childId = `${parentId}.${startIndex + i}`;
      const childKernel = evaluate(exprs[i]!, env);
      yield* spawn(function* () {
        const result = yield* driveKernel(childKernel, childId, env, ctx);

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

/**
 * Orchestrate `scope` — run body in an isolated Effection scope with
 * bound agent transports and an optional enforcement handler.
 *
 * Mirrors the authored `yield* useTransport(Contract, factory)` + scoped() pattern:
 * 1. BoundAgentsContext mutation
 * 2. installAgentTransport (opens transport, runs session, installs Effects.around middleware)
 * 3. Optional enforcement handler via installEnforcement
 * 4. Drive child kernel for the body
 * All transport sessions and the enforcement middleware are owned by this scoped() block
 * and torn down when it exits.
 */
function* orchestrateScope(
  inner: ScopeInner,
  childId: string,
  env: Env,
  ctx: DriveContext,
): Operation<Val> {
  return yield* scoped(function* () {
    const scope = yield* useScope();
    const current = scope.get(BoundAgentsContext) ?? null;
    const next = new Set(current ?? []);

    for (const [prefix, binding] of Object.entries(inner.bindings)) {
      let factory: Val;
      try {
        factory = evaluateScopeBinding(binding, env);
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        const closeEvent: CloseEvent = {
          type: "close",
          coroutineId: childId,
          result: { status: "err", error: { message: err.message, name: err.name } },
        };
        yield* ctx.stream.append(closeEvent);
        ctx.journal.push(closeEvent);
        throw new EffectError(err.message, err.name);
      }
      next.add(prefix);
      yield* installAgentTransport(prefix, factory as unknown as AgentTransportFactory);
    }
    scope.set(BoundAgentsContext, next);

    if (inner.handler !== null) {
      yield* installEnforcement((effectId, data, innerNext) =>
        evaluateMiddlewareFn(inner.handler!, effectId, data, innerNext),
      );
    }

    const childKernel = evaluate(inner.body, env);
    const result = yield* driveKernel(childKernel, childId, env, ctx);

    if (result.status === "ok") return result.value as Val;
    const errResult = result as { status: "err"; error: { message: string; name?: string } };
    throw new EffectError(errResult.error.message, errResult.error.name);
  });
}

/**
 * Evaluate a scope binding expression purely — no effects allowed.
 *
 * Drives the kernel evaluator structurally. If the expression yields
 * any effect descriptor, throws ScopeBindingEffectError.
 */
function evaluateScopeBinding(expr: Expr, env: Env): Val {
  const gen = evaluate(expr, env);
  for (;;) {
    const step = gen.next(null as Val);
    if (step.done) return step.value as Val;
    throw new ScopeBindingEffectError(step.value.id);
  }
}
