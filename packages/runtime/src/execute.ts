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
  SubscriptionCapabilityError,
} from "./errors.js";
import { assertValidIr } from "@tisyn/validate";
import { evaluate, type Env, envFromRecord } from "@tisyn/kernel";
import { type DurableStream, InMemoryStream, ReplayIndex } from "@tisyn/durable-streams";
import { dispatch, Effects, evaluateMiddlewareFn } from "@tisyn/agent";
import {
  installAgentTransport,
  type AgentTransportFactory,
  CoroutineContext,
} from "@tisyn/transport";
import type { FnNode } from "@tisyn/ir";
import { ConfigContext } from "./config-scope.js";

export interface ExecuteOptions {
  /** The IR tree to evaluate. */
  ir: IrInput;
  /** Initial environment bindings. */
  env?: Record<string, Val>;
  /** The durable stream for journaling. */
  stream?: DurableStream;
  /** Coroutine ID for the root task. Defaults to "root". */
  coroutineId?: string;
  /** Resolved config projection, available to workflows via Config.useConfig(Token). */
  config?: Val;
}

export interface ExecuteResult {
  result: EventResult;
  journal: DurableEvent[];
}

/** Stream subscription entry — null subscription means replay-only, not yet live. */
interface SubscriptionEntry {
  subscription: { next(): Operation<IteratorResult<Val, unknown>> } | null;
  sourceDefinition: unknown;
}

/** Shared context passed through driveKernel and orchestration functions. */
interface DriveContext {
  replayIndex: ReplayIndex;
  stream: DurableStream;
  journal: DurableEvent[];
  /** Stream subscription map shared across all coroutines in the execution. */
  subscriptions: Map<string, SubscriptionEntry>;
}

interface ScopeInner {
  handler: FnNode | null;
  bindings: Record<string, Expr>;
  body: Expr;
}

/** Recursively check if a value tree contains a subscription handle. */
function containsSubscriptionHandle(value: unknown): boolean {
  if (value === null || value === undefined || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(containsSubscriptionHandle);
  }
  const obj = value as Record<string, unknown>;
  if ("__tisyn_subscription" in obj) {
    return true;
  }
  return Object.values(obj).some(containsSubscriptionHandle);
}

/** Assert that a close value does not contain subscription handles (RV3). */
function assertNoSubscriptionHandleInCloseValue(value: unknown): void {
  if (containsSubscriptionHandle(value)) {
    throw new SubscriptionCapabilityError(
      "Close value contains a subscription handle, which is a restricted capability value",
    );
  }
}

interface ResourceChild {
  childId: string;
  signalTeardown: () => void;
  waitCleanup: Operation<void>;
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
  const {
    ir,
    env: envRecord = {},
    stream = new InMemoryStream(),
    coroutineId = "root",
    config = null,
  } = options;

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

  return yield* scoped(function* () {
    if (config != null) {
      yield* ConfigContext.set(config);
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
    const ctx: DriveContext = {
      replayIndex,
      stream,
      journal,
      subscriptions: new Map(),
    };

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
  });
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
  // Per-coroutine subscription counter for deterministic token generation.
  let subscriptionCounter = 0;
  // Spawn/join tracking
  const spawnedTasks = new Map<string, { operation: Operation<EventResult> }>();
  const joinedTasks = new Set<string>();
  const resourceChildren: ResourceChild[] = [];

  // scoped() binds spawned children to the parent's lifetime:
  // children are alive while the parent runs, torn down when the parent exits.
  return yield* scoped(function* () {
    yield* CoroutineContext.set(coroutineId);
    try {
      for (;;) {
        const step = pendingStep ?? kernel.next(nextValue);
        pendingStep = null;

        if (step.done) {
          // RV3: Reject subscription handles in close values
          assertNoSubscriptionHandleInCloseValue(step.value);
          // R21: Tear down resource children in reverse creation order
          yield* teardownResourceChildren(resourceChildren);
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
                assertNoSubscriptionHandleInCloseValue(throwResult.value);
                yield* teardownResourceChildren(resourceChildren);
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
          } else if (descriptor.id === "resource") {
            const childId = `${coroutineId}.${childSpawnCount++}`;
            const inner = compoundData.__tisyn_inner as { body: Expr };
            const childResourceKernel = evaluate(inner.body, childEnv);

            const {
              operation: provideOp,
              resolve: provideRes,
              reject: provideRej,
            } = withResolvers<Val>();
            const { operation: teardownOp, resolve: teardownRes } = withResolvers<void>();
            const { operation: cleanupOp, resolve: cleanupRes } = withResolvers<void>();

            yield* spawn(function* () {
              yield* orchestrateResourceChild(
                childResourceKernel,
                childId,
                childEnv,
                ctx,
                provideRes,
                provideRej,
                teardownOp,
                cleanupRes,
              );
            });

            let resourceValue: Val = null;
            let resourceErr: Error | null = null;
            try {
              resourceValue = yield* provideOp;
            } catch (e) {
              resourceErr = e instanceof Error ? e : new Error(String(e));
            }

            if (resourceErr === null) {
              resourceChildren.push({
                childId,
                signalTeardown: teardownRes,
                waitCleanup: cleanupOp,
              });
              nextValue = resourceValue;
            } else {
              const throwResult = kernel.throw(resourceErr);
              if (throwResult.done) {
                assertNoSubscriptionHandleInCloseValue(throwResult.value);
                yield* teardownResourceChildren(resourceChildren);
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
          } else if (descriptor.id === "timebox") {
            const inner = compoundData.__tisyn_inner as { duration: number; body: Expr };
            // TB-R2: allocate 2 child IDs — body = N, timeout = N+1
            const bodyChildId = `${coroutineId}.${childSpawnCount++}`;
            const timeoutChildId = `${coroutineId}.${childSpawnCount++}`;

            let timeboxValue: Val = null;
            let timeboxErr: Error | null = null;
            try {
              timeboxValue = yield* orchestrateTimebox(
                inner.duration,
                inner.body,
                bodyChildId,
                timeoutChildId,
                childEnv,
                ctx,
              );
            } catch (e) {
              timeboxErr = e instanceof Error ? e : new Error(String(e));
            }

            if (timeboxErr === null) {
              nextValue = timeboxValue;
            } else {
              // Route error through parent kernel for try/catch interception
              const throwResult = kernel.throw(timeboxErr);
              if (throwResult.done) {
                assertNoSubscriptionHandleInCloseValue(throwResult.value);
                yield* teardownResourceChildren(resourceChildren);
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
          } else if (descriptor.id === "provide") {
            throw new RuntimeBugError("provide outside resource context");
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

          // Stream-specific: cache source definition during subscribe replay
          if (descriptor.id === "stream.subscribe" && stored.result.status === "ok") {
            const handle = stored.result.value as Record<string, unknown> | null;
            if (handle && typeof handle === "object" && "__tisyn_subscription" in handle) {
              ctx.subscriptions.set(handle.__tisyn_subscription as string, {
                subscription: null,
                sourceDefinition: descriptor.data,
              });
              subscriptionCounter++;
            }
          }

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
              assertNoSubscriptionHandleInCloseValue(throwResult.value);
              yield* teardownResourceChildren(resourceChildren);
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
          let resultValue: Val;
          if (descriptor.id === "__config") {
            resultValue = (yield* ConfigContext.expect()) as Val;
          } else if (descriptor.id === "stream.subscribe") {
            const token = `sub:${coroutineId}:${subscriptionCounter++}`;
            const sourceData = descriptor.data as unknown[];
            const source = sourceData[0];
            // Subscribe to the Effection stream
            const sub = yield* source as Operation<{
              next(): Operation<IteratorResult<Val, unknown>>;
            }>;
            ctx.subscriptions.set(token, { subscription: sub, sourceDefinition: source });
            resultValue = { __tisyn_subscription: token } as unknown as Val;
          } else if (descriptor.id === "stream.next") {
            const nextData = descriptor.data as unknown[];
            const handle = nextData[0] as Record<string, unknown> | null;
            if (
              !handle ||
              typeof handle !== "object" ||
              typeof handle.__tisyn_subscription !== "string"
            ) {
              throw new RuntimeBugError("stream.next: argument is not a valid subscription handle");
            }
            const token = handle.__tisyn_subscription as string;
            // RV1: ancestor-or-equal coroutineId check
            const handleCid = token.split(":")[1]!;
            if (coroutineId !== handleCid && !coroutineId.startsWith(handleCid + ".")) {
              throw new SubscriptionCapabilityError(
                `stream.next: handle from '${handleCid}' cannot be used from '${coroutineId}'`,
              );
            }
            const entry = ctx.subscriptions.get(token);
            // Lazy reconstruction at live frontier
            if (entry && !entry.subscription) {
              const src = entry.sourceDefinition as unknown[];
              const srcStream = src[0];
              entry.subscription = yield* srcStream as Operation<{
                next(): Operation<IteratorResult<Val, unknown>>;
              }>;
            }
            if (!entry?.subscription) {
              throw new RuntimeBugError(`stream.next: no subscription for token '${token}'`);
            }
            const iterResult = yield* entry.subscription.next();
            if (iterResult.done) {
              resultValue = { done: true } as unknown as Val;
            } else {
              resultValue = { done: false, value: iterResult.value } as unknown as Val;
            }
          } else {
            // RV2: reject subscription handles in non-stream effect dispatch data
            if (containsSubscriptionHandle(descriptor.data)) {
              throw new SubscriptionCapabilityError(
                `Effect '${descriptor.id}': resolved data contains a subscription handle, which is a restricted capability value`,
              );
            }
            resultValue = yield* dispatch(descriptor.id, descriptor.data as Val);
          }
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
            assertNoSubscriptionHandleInCloseValue(throwResult.value);
            yield* teardownResourceChildren(resourceChildren);
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
      // Tear down resource children before writing parent CloseEvent (R23)
      yield* teardownResourceChildren(resourceChildren);

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
  if (exprs.length === 0) {
    return [] as Val;
  }

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
 * Orchestrate `timebox` — race body against a timeout.
 *
 * TB-R3: Two child tasks — body evaluates the body expression,
 *        timeout evaluates sleep(duration).
 * TB-R4: First to resolve wins.
 * TB-R6: Simultaneous completion — body takes precedence.
 *
 * The scoped() block ensures the losing child is cancelled automatically.
 */
function* orchestrateTimebox(
  duration: number,
  bodyExpr: Expr,
  bodyChildId: string,
  timeoutChildId: string,
  env: Env,
  ctx: DriveContext,
): Operation<Val> {
  const bodyKernel = evaluate(bodyExpr, env);
  // Timeout child evaluates: Eval("sleep", [duration])
  const sleepIr: Expr = {
    tisyn: "eval",
    id: "sleep",
    data: [duration],
  } as unknown as Expr;
  const timeoutKernel = evaluate(sleepIr, env);

  const { operation, resolve, reject } = withResolvers<Val>();

  yield* scoped(function* () {
    let resolved = false;

    // Body child — spawned first so it wins on simultaneous completion (TB-R6)
    yield* spawn(function* () {
      const result = yield* driveKernel(bodyKernel, bodyChildId, env, ctx);
      if (!resolved) {
        resolved = true;
        if (result.status === "ok") {
          resolve({
            status: "completed",
            value: result.value ?? null,
          } as unknown as Val);
        } else {
          const errResult = result as {
            status: "err";
            error: { message: string; name?: string };
          };
          reject(new EffectError(errResult.error.message, errResult.error.name));
        }
      }
    });

    // Timeout child
    yield* spawn(function* () {
      const result = yield* driveKernel(timeoutKernel, timeoutChildId, env, ctx);
      if (!resolved) {
        resolved = true;
        if (result.status === "ok") {
          resolve({ status: "timeout" } as unknown as Val);
        } else {
          const errResult = result as {
            status: "err";
            error: { message: string; name?: string };
          };
          reject(new EffectError(errResult.error.message, errResult.error.name));
        }
      }
    });

    yield* operation;
  });

  return yield* operation;
}

/**
 * Orchestrate `scope` — run body in an isolated Effection scope with
 * bound agent transports and an optional cross-boundary middleware handler.
 *
 * Mirrors the authored `yield* useTransport(Contract, factory)` + scoped() pattern:
 * 1. Optional cross-boundary middleware via Effects.around (outermost max, runs first)
 * 2. installAgentTransport (opens transport, installs Effects.around dispatch + resolve middleware)
 * 3. Drive child kernel for the body
 *
 * Cross-boundary middleware is installed BEFORE transport bindings so it is
 * the outermost max-priority Effects middleware. collectMiddleware's prototype
 * chain traversal ensures parent max MW always runs before child max MW,
 * preserving monotonic narrowing without a separate enforcement context.
 */
function orchestrateScope(
  inner: ScopeInner,
  childId: string,
  env: Env,
  ctx: DriveContext,
): Operation<Val> {
  return scoped(function* () {
    // Install cross-boundary middleware FIRST (outermost max in this scope)
    if (inner.handler !== null) {
      const handler = inner.handler;
      yield* Effects.around({
        dispatch: (
          [effectId, data]: [string, Val],
          nextMw: (eid: string, d: Val) => Operation<Val>,
        ) => evaluateMiddlewareFn(handler, effectId, data, (eid: string, d: Val) => nextMw(eid, d)),
      });
    }

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
      yield* installAgentTransport(prefix, factory as unknown as AgentTransportFactory);
    }

    const childKernel = evaluate(inner.body, env);
    const result = yield* driveKernel(childKernel, childId, env, ctx);

    if (result.status === "ok") {
      return result.value as Val;
    }
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
    if (step.done) {
      return step.value as Val;
    }
    throw new ScopeBindingEffectError(step.value.id);
  }
}

// ── Resource orchestration ──

/**
 * Tear down resource children in reverse creation order (R21).
 * Signals each child to begin cleanup, then waits for completion.
 */
function* teardownResourceChildren(children: ResourceChild[]): Operation<void> {
  for (let i = children.length - 1; i >= 0; i--) {
    children[i]!.signalTeardown();
    yield* children[i]!.waitCleanup;
  }
  children.length = 0;
}

/**
 * Orchestrate a resource child's full lifecycle.
 *
 * Spawned as a background Effection task in the parent's scope.
 * Sole owner of the child's Close event (parent never writes Close for resource children).
 *
 * Two-phase scoped design (R22):
 * 1. Init scope: drive kernel to `provide`, capture value. When the scope exits,
 *    Effection tears down any grandchildren spawned during init — BEFORE cleanup begins.
 * 2. Cleanup scope: resume kernel (P7), drive finally/cleanup effects to completion.
 */
function* orchestrateResourceChild(
  childKernel: Generator<EffectDescriptor, Val, Val>,
  childId: string,
  _childEnv: Env,
  ctx: DriveContext,
  provideResolve: (v: Val) => void,
  provideReject: (e: Error) => void,
  teardownOp: Operation<void>,
  cleanupResolve: () => void,
): Operation<void> {
  let childClosed = false;

  yield* ensure(function* () {
    if (!childClosed) {
      const closeEvent: CloseEvent = {
        type: "close",
        coroutineId: childId,
        result: { status: "cancelled" as const },
      };
      yield* ctx.stream.append(closeEvent);
      ctx.journal.push(closeEvent);
    }
  });

  // Early return for children that were cancelled in a previous run.
  const preClose = ctx.replayIndex.getClose(childId);
  if (preClose && preClose.result.status === "cancelled") {
    childClosed = true;
    ctx.journal.push(preClose);
    provideReject(new Error("Resource child was cancelled"));
    cleanupResolve();
    return;
  }

  // Shared across init and cleanup phases for deterministic coroutineId allocation
  let childSpawnCount = 0;
  // Per-resource subscription counter for deterministic token generation
  let subscriptionCounter = 0;

  // ── INIT PHASE ──
  // Drive kernel to provide in its own scope. When the scope exits (at provide
  // or on error), Effection tears down any grandchildren spawned during init.
  // This satisfies R22: grandchildren are halted before cleanup begins.
  let initResult: { value: Val };
  try {
    initResult = yield* scoped(function* () {
      let nextValue: Val = null;
      let pendingStep: IteratorResult<EffectDescriptor, Val> | null = null;
      const spawnedTasks = new Map<string, { operation: Operation<EventResult> }>();
      const joinedTasks = new Set<string>();

      for (;;) {
        const step = pendingStep ?? childKernel.next(nextValue);
        pendingStep = null;

        if (step.done) {
          throw new RuntimeBugError("Resource body completed without provide");
        }

        const descriptor = step.value as EffectDescriptor;

        // ── Compound effect interception ──
        if (isCompoundExternal(descriptor.id)) {
          const compoundData = descriptor.data as { __tisyn_inner: unknown; __tisyn_env: Env };
          const cEnv = compoundData.__tisyn_env;

          if (descriptor.id === "provide") {
            // Return from scoped — tears down grandchildren (R22)
            return { value: compoundData.__tisyn_inner as Val };
          }

          if (descriptor.id === "resource") {
            throw new RuntimeBugError("Nested resource is not supported");
          }

          if (descriptor.id === "scope") {
            const inner = compoundData.__tisyn_inner as ScopeInner;
            const scopeChildId = `${childId}.${childSpawnCount++}`;
            let scopeValue: Val = null;
            let scopeErr: Error | null = null;
            try {
              scopeValue = yield* orchestrateScope(inner, scopeChildId, cEnv, ctx);
            } catch (e) {
              scopeErr = e instanceof Error ? e : new Error(String(e));
            }
            if (scopeErr === null) {
              nextValue = scopeValue;
            } else {
              const throwResult = childKernel.throw(scopeErr);
              if (throwResult.done) {
                throw new RuntimeBugError("Resource body completed without provide");
              }
              pendingStep = throwResult;
              nextValue = null;
            }
          } else if (descriptor.id === "spawn") {
            const spawnChildId = `${childId}.${childSpawnCount++}`;
            const inner = compoundData.__tisyn_inner as { body: Expr };
            const spawnChildKernel = evaluate(inner.body, cEnv);
            const {
              operation: joinOp,
              resolve: joinResolve,
              reject: joinReject,
            } = withResolvers<EventResult>();
            spawnedTasks.set(spawnChildId, { operation: joinOp });

            yield* spawn(function* () {
              try {
                const result = yield* driveKernel(spawnChildKernel, spawnChildId, cEnv, ctx);
                joinResolve(result);
                if (result.status === "err") {
                  const errResult = result as {
                    status: "err";
                    error: { message: string; name?: string };
                  };
                  throw new EffectError(errResult.error.message, errResult.error.name);
                }
              } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                joinReject(err);
                throw err;
              }
            });

            nextValue = { __tisyn_task: spawnChildId } as Val;
          } else if (descriptor.id === "join") {
            const taskHandle = compoundData.__tisyn_inner as Val;
            if (
              taskHandle === null ||
              typeof taskHandle !== "object" ||
              typeof (taskHandle as Record<string, unknown>).__tisyn_task !== "string"
            ) {
              throw new RuntimeBugError("join: inner value is not a valid task handle");
            }
            const joinChildId = (taskHandle as { __tisyn_task: string }).__tisyn_task;
            if (joinedTasks.has(joinChildId)) {
              throw new RuntimeBugError(`join: task '${joinChildId}' has already been joined`);
            }
            joinedTasks.add(joinChildId);
            const entry = spawnedTasks.get(joinChildId);
            if (!entry) {
              throw new RuntimeBugError(`join: no spawned task found for '${joinChildId}'`);
            }
            const childResult = yield* entry.operation;
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
            // all/race
            const inner = compoundData.__tisyn_inner as { exprs: Expr[] };
            const exprs = inner.exprs;
            const startIndex = childSpawnCount;
            childSpawnCount += exprs.length;
            if (descriptor.id === "all") {
              nextValue = yield* orchestrateAll(exprs, childId, startIndex, cEnv, ctx);
            } else {
              nextValue = yield* orchestrateRace(exprs, childId, startIndex, cEnv, ctx);
            }
          }
          continue;
        }

        // ── Standard effect dispatch ──
        const description = parseEffectId(descriptor.id);
        const stored = ctx.replayIndex.peekYield(childId);

        if (stored) {
          if (
            stored.description.type !== description.type ||
            stored.description.name !== description.name
          ) {
            const cursor = ctx.replayIndex.getCursor(childId);
            throw new DivergenceError(
              `Divergence at ${childId}[${cursor}]: ` +
                `expected ${stored.description.type}.${stored.description.name}, ` +
                `got ${description.type}.${description.name}`,
            );
          }
          ctx.replayIndex.consumeYield(childId);

          // Stream-specific: cache source definition during subscribe replay
          if (descriptor.id === "stream.subscribe" && stored.result.status === "ok") {
            const handle = stored.result.value as Record<string, unknown> | null;
            if (handle && typeof handle === "object" && "__tisyn_subscription" in handle) {
              ctx.subscriptions.set(handle.__tisyn_subscription as string, {
                subscription: null,
                sourceDefinition: descriptor.data,
              });
              subscriptionCounter++;
            }
          }

          const replayedEvent: YieldEvent = {
            type: "yield",
            coroutineId: childId,
            description: stored.description,
            result: stored.result,
          };
          ctx.journal.push(replayedEvent);

          if (stored.result.status === "ok") {
            nextValue = (stored.result.value ?? null) as Val;
          } else if (stored.result.status === "err") {
            const err = new EffectError(stored.result.error.message, stored.result.error.name);
            const throwResult = childKernel.throw(err);
            if (throwResult.done) {
              throw new RuntimeBugError("Resource body completed without provide");
            }
            pendingStep = throwResult;
            nextValue = null;
            continue;
          } else {
            throw new Error("Cannot replay cancelled result");
          }
          continue;
        }

        if (ctx.replayIndex.hasClose(childId)) {
          throw new DivergenceError(
            `Divergence: journal shows ${childId} closed, but generator continues to yield effects`,
          );
        }

        // LIVE dispatch — stream-aware
        let effectResult: EventResult;
        try {
          let resultValue: Val;
          if (descriptor.id === "__config") {
            resultValue = (yield* ConfigContext.expect()) as Val;
          } else if (descriptor.id === "stream.subscribe") {
            const token = `sub:${childId}:${subscriptionCounter++}`;
            const sourceData = descriptor.data as unknown[];
            const source = sourceData[0];
            const sub = yield* source as Operation<{
              next(): Operation<IteratorResult<Val, unknown>>;
            }>;
            ctx.subscriptions.set(token, { subscription: sub, sourceDefinition: source });
            resultValue = { __tisyn_subscription: token } as unknown as Val;
          } else if (descriptor.id === "stream.next") {
            const nextData = descriptor.data as unknown[];
            const handle = nextData[0] as Record<string, unknown> | null;
            if (
              !handle ||
              typeof handle !== "object" ||
              typeof handle.__tisyn_subscription !== "string"
            ) {
              throw new RuntimeBugError("stream.next: argument is not a valid subscription handle");
            }
            const token = handle.__tisyn_subscription as string;
            const handleCid = token.split(":")[1]!;
            if (childId !== handleCid && !childId.startsWith(handleCid + ".")) {
              throw new SubscriptionCapabilityError(
                `stream.next: handle from '${handleCid}' cannot be used from '${childId}'`,
              );
            }
            const entry = ctx.subscriptions.get(token);
            if (entry && !entry.subscription) {
              const src = entry.sourceDefinition as unknown[];
              const srcStream = src[0];
              entry.subscription = yield* srcStream as Operation<{
                next(): Operation<IteratorResult<Val, unknown>>;
              }>;
            }
            if (!entry?.subscription) {
              throw new RuntimeBugError(`stream.next: no subscription for token '${token}'`);
            }
            const iterResult = yield* entry.subscription.next();
            if (iterResult.done) {
              resultValue = { done: true } as unknown as Val;
            } else {
              resultValue = { done: false, value: iterResult.value } as unknown as Val;
            }
          } else {
            if (containsSubscriptionHandle(descriptor.data)) {
              throw new SubscriptionCapabilityError(
                `Effect '${descriptor.id}': resolved data contains a subscription handle, which is a restricted capability value`,
              );
            }
            resultValue = yield* dispatch(descriptor.id, descriptor.data as Val);
          }
          effectResult = { status: "ok", value: resultValue as Json };
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          effectResult = {
            status: "err",
            error: { message: err.message, name: err.name },
          };
        }

        const yieldEvent: YieldEvent = {
          type: "yield",
          coroutineId: childId,
          description,
          result: effectResult,
        };
        yield* ctx.stream.append(yieldEvent);
        ctx.journal.push(yieldEvent);

        if (effectResult.status === "ok") {
          nextValue = (effectResult.value ?? null) as Val;
        } else {
          const err = new EffectError(effectResult.error.message, effectResult.error.name);
          const throwResult = childKernel.throw(err);
          if (throwResult.done) {
            throw new RuntimeBugError("Resource body completed without provide");
          }
          pendingStep = throwResult;
          nextValue = null;
          continue;
        }
      }
    });
  } catch (error) {
    // Init failure — write Close(err), reject provide
    childClosed = true;
    const err = error instanceof Error ? error : new Error(String(error));
    const closeEvent: CloseEvent = {
      type: "close",
      coroutineId: childId,
      result: {
        status: "err",
        error: { message: err.message, name: err.name },
      },
    };
    yield* ctx.stream.append(closeEvent);
    ctx.journal.push(closeEvent);

    if (error instanceof DivergenceError) {
      cleanupResolve();
      throw error; // Fatal
    }

    provideReject(err);
    cleanupResolve();
    return;
  }

  // Init succeeded — provide value to parent, wait for teardown signal
  provideResolve(initResult.value);
  yield* teardownOp;

  // ── CLEANUP PHASE ──
  // Resume kernel with null (P7), drive cleanup/finally effects to completion.
  // Runs in its own scope so any compound externals in finally blocks are contained.
  try {
    yield* scoped(function* () {
      let nextValue: Val = null; // P7: resume kernel with null
      let pendingStep: IteratorResult<EffectDescriptor, Val> | null = null;
      const spawnedTasks = new Map<string, { operation: Operation<EventResult> }>();
      const joinedTasks = new Set<string>();

      for (;;) {
        const step = pendingStep ?? childKernel.next(nextValue);
        pendingStep = null;

        if (step.done) {
          assertNoSubscriptionHandleInCloseValue(step.value);
          childClosed = true;
          const closeEvent: CloseEvent = {
            type: "close",
            coroutineId: childId,
            result: { status: "ok", value: step.value as Json },
          };
          yield* ctx.stream.append(closeEvent);
          ctx.journal.push(closeEvent);
          cleanupResolve();
          return;
        }

        const descriptor = step.value as EffectDescriptor;

        // ── Compound effect interception ──
        if (isCompoundExternal(descriptor.id)) {
          const compoundData = descriptor.data as { __tisyn_inner: unknown; __tisyn_env: Env };
          const cEnv = compoundData.__tisyn_env;

          if (descriptor.id === "provide") {
            throw new RuntimeBugError("Multiple provide in resource body");
          }

          if (descriptor.id === "resource") {
            throw new RuntimeBugError("Nested resource is not supported");
          }

          if (descriptor.id === "scope") {
            const inner = compoundData.__tisyn_inner as ScopeInner;
            const scopeChildId = `${childId}.${childSpawnCount++}`;
            let scopeValue: Val = null;
            let scopeErr: Error | null = null;
            try {
              scopeValue = yield* orchestrateScope(inner, scopeChildId, cEnv, ctx);
            } catch (e) {
              scopeErr = e instanceof Error ? e : new Error(String(e));
            }
            if (scopeErr === null) {
              nextValue = scopeValue;
            } else {
              const throwResult = childKernel.throw(scopeErr);
              if (throwResult.done) {
                assertNoSubscriptionHandleInCloseValue(throwResult.value);
                childClosed = true;
                const closeEvent: CloseEvent = {
                  type: "close",
                  coroutineId: childId,
                  result: { status: "ok", value: throwResult.value as Json },
                };
                yield* ctx.stream.append(closeEvent);
                ctx.journal.push(closeEvent);
                cleanupResolve();
                return;
              }
              pendingStep = throwResult;
              nextValue = null;
            }
          } else if (descriptor.id === "spawn") {
            const spawnChildId = `${childId}.${childSpawnCount++}`;
            const inner = compoundData.__tisyn_inner as { body: Expr };
            const spawnChildKernel = evaluate(inner.body, cEnv);
            const {
              operation: joinOp,
              resolve: joinResolve,
              reject: joinReject,
            } = withResolvers<EventResult>();
            spawnedTasks.set(spawnChildId, { operation: joinOp });

            yield* spawn(function* () {
              try {
                const result = yield* driveKernel(spawnChildKernel, spawnChildId, cEnv, ctx);
                joinResolve(result);
                if (result.status === "err") {
                  const errResult = result as {
                    status: "err";
                    error: { message: string; name?: string };
                  };
                  throw new EffectError(errResult.error.message, errResult.error.name);
                }
              } catch (e) {
                const err = e instanceof Error ? e : new Error(String(e));
                joinReject(err);
                throw err;
              }
            });

            nextValue = { __tisyn_task: spawnChildId } as Val;
          } else if (descriptor.id === "join") {
            const taskHandle = compoundData.__tisyn_inner as Val;
            if (
              taskHandle === null ||
              typeof taskHandle !== "object" ||
              typeof (taskHandle as Record<string, unknown>).__tisyn_task !== "string"
            ) {
              throw new RuntimeBugError("join: inner value is not a valid task handle");
            }
            const joinChildId = (taskHandle as { __tisyn_task: string }).__tisyn_task;
            if (joinedTasks.has(joinChildId)) {
              throw new RuntimeBugError(`join: task '${joinChildId}' has already been joined`);
            }
            joinedTasks.add(joinChildId);
            const entry = spawnedTasks.get(joinChildId);
            if (!entry) {
              throw new RuntimeBugError(`join: no spawned task found for '${joinChildId}'`);
            }
            const childResult = yield* entry.operation;
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
            // all/race
            const inner = compoundData.__tisyn_inner as { exprs: Expr[] };
            const exprs = inner.exprs;
            const startIndex = childSpawnCount;
            childSpawnCount += exprs.length;
            if (descriptor.id === "all") {
              nextValue = yield* orchestrateAll(exprs, childId, startIndex, cEnv, ctx);
            } else {
              nextValue = yield* orchestrateRace(exprs, childId, startIndex, cEnv, ctx);
            }
          }
          continue;
        }

        // ── Standard effect dispatch ──
        const description = parseEffectId(descriptor.id);
        const stored = ctx.replayIndex.peekYield(childId);

        if (stored) {
          if (
            stored.description.type !== description.type ||
            stored.description.name !== description.name
          ) {
            const cursor = ctx.replayIndex.getCursor(childId);
            throw new DivergenceError(
              `Divergence at ${childId}[${cursor}]: ` +
                `expected ${stored.description.type}.${stored.description.name}, ` +
                `got ${description.type}.${description.name}`,
            );
          }
          ctx.replayIndex.consumeYield(childId);

          // Stream-specific: cache source definition during subscribe replay
          if (descriptor.id === "stream.subscribe" && stored.result.status === "ok") {
            const handle = stored.result.value as Record<string, unknown> | null;
            if (handle && typeof handle === "object" && "__tisyn_subscription" in handle) {
              ctx.subscriptions.set(handle.__tisyn_subscription as string, {
                subscription: null,
                sourceDefinition: descriptor.data,
              });
              subscriptionCounter++;
            }
          }

          const replayedEvent: YieldEvent = {
            type: "yield",
            coroutineId: childId,
            description: stored.description,
            result: stored.result,
          };
          ctx.journal.push(replayedEvent);

          if (stored.result.status === "ok") {
            nextValue = (stored.result.value ?? null) as Val;
          } else if (stored.result.status === "err") {
            const err = new EffectError(stored.result.error.message, stored.result.error.name);
            const throwResult = childKernel.throw(err);
            if (throwResult.done) {
              assertNoSubscriptionHandleInCloseValue(throwResult.value);
              childClosed = true;
              const closeEvent: CloseEvent = {
                type: "close",
                coroutineId: childId,
                result: { status: "ok", value: throwResult.value as Json },
              };
              yield* ctx.stream.append(closeEvent);
              ctx.journal.push(closeEvent);
              cleanupResolve();
              return;
            }
            pendingStep = throwResult;
            nextValue = null;
            continue;
          } else {
            throw new Error("Cannot replay cancelled result");
          }
          continue;
        }

        if (ctx.replayIndex.hasClose(childId)) {
          throw new DivergenceError(
            `Divergence: journal shows ${childId} closed, but generator continues to yield effects`,
          );
        }

        // LIVE dispatch — stream-aware
        let effectResult: EventResult;
        try {
          let resultValue: Val;
          if (descriptor.id === "__config") {
            resultValue = (yield* ConfigContext.expect()) as Val;
          } else if (descriptor.id === "stream.subscribe") {
            const token = `sub:${childId}:${subscriptionCounter++}`;
            const sourceData = descriptor.data as unknown[];
            const source = sourceData[0];
            const sub = yield* source as Operation<{
              next(): Operation<IteratorResult<Val, unknown>>;
            }>;
            ctx.subscriptions.set(token, { subscription: sub, sourceDefinition: source });
            resultValue = { __tisyn_subscription: token } as unknown as Val;
          } else if (descriptor.id === "stream.next") {
            const nextData = descriptor.data as unknown[];
            const handle = nextData[0] as Record<string, unknown> | null;
            if (
              !handle ||
              typeof handle !== "object" ||
              typeof handle.__tisyn_subscription !== "string"
            ) {
              throw new RuntimeBugError("stream.next: argument is not a valid subscription handle");
            }
            const token = handle.__tisyn_subscription as string;
            const handleCid = token.split(":")[1]!;
            if (childId !== handleCid && !childId.startsWith(handleCid + ".")) {
              throw new SubscriptionCapabilityError(
                `stream.next: handle from '${handleCid}' cannot be used from '${childId}'`,
              );
            }
            const entry = ctx.subscriptions.get(token);
            if (entry && !entry.subscription) {
              const src = entry.sourceDefinition as unknown[];
              const srcStream = src[0];
              entry.subscription = yield* srcStream as Operation<{
                next(): Operation<IteratorResult<Val, unknown>>;
              }>;
            }
            if (!entry?.subscription) {
              throw new RuntimeBugError(`stream.next: no subscription for token '${token}'`);
            }
            const iterResult = yield* entry.subscription.next();
            if (iterResult.done) {
              resultValue = { done: true } as unknown as Val;
            } else {
              resultValue = { done: false, value: iterResult.value } as unknown as Val;
            }
          } else {
            if (containsSubscriptionHandle(descriptor.data)) {
              throw new SubscriptionCapabilityError(
                `Effect '${descriptor.id}': resolved data contains a subscription handle, which is a restricted capability value`,
              );
            }
            resultValue = yield* dispatch(descriptor.id, descriptor.data as Val);
          }
          effectResult = { status: "ok", value: resultValue as Json };
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          effectResult = {
            status: "err",
            error: { message: err.message, name: err.name },
          };
        }

        const yieldEvent: YieldEvent = {
          type: "yield",
          coroutineId: childId,
          description,
          result: effectResult,
        };
        yield* ctx.stream.append(yieldEvent);
        ctx.journal.push(yieldEvent);

        if (effectResult.status === "ok") {
          nextValue = (effectResult.value ?? null) as Val;
        } else {
          const err = new EffectError(effectResult.error.message, effectResult.error.name);
          const throwResult = childKernel.throw(err);
          if (throwResult.done) {
            assertNoSubscriptionHandleInCloseValue(throwResult.value);
            childClosed = true;
            const closeEvent: CloseEvent = {
              type: "close",
              coroutineId: childId,
              result: { status: "ok", value: throwResult.value as Json },
            };
            yield* ctx.stream.append(closeEvent);
            ctx.journal.push(closeEvent);
            cleanupResolve();
            return;
          }
          pendingStep = throwResult;
          nextValue = null;
          continue;
        }
      }
    });
  } catch (error) {
    // Cleanup failure — write Close(err), propagate to parent
    if (!childClosed) {
      childClosed = true;
      const err = error instanceof Error ? error : new Error(String(error));
      const closeEvent: CloseEvent = {
        type: "close",
        coroutineId: childId,
        result: {
          status: "err",
          error: { message: err.message, name: err.name },
        },
      };
      yield* ctx.stream.append(closeEvent);
      ctx.journal.push(closeEvent);
    }
    cleanupResolve();
    throw error; // Propagate to parent scope
  }
}
