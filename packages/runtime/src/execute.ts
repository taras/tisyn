/**
 * Tisyn execution loop — bridges kernel, journal, and agents.
 *
 * Drives the kernel generator, handles replay/live dispatch,
 * journals Yield/Close events, and enforces persist-before-resume.
 *
 * See Architecture §3.1 and Conformance Suite §3.
 */

import type { Operation } from "effection";
import { createContext, spawn, ensure, scoped, withResolvers } from "effection";
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
  InvocationCancelledError,
  RuntimeBugError,
  ScopeBindingEffectError,
  SubscriptionCapabilityError,
} from "./errors.js";
import { assertValidIr } from "@tisyn/validate";
import { evaluate, type Env, envFromRecord, extendMulti } from "@tisyn/kernel";
import { type DurableStream, InMemoryStream, ReplayIndex } from "@tisyn/durable-streams";
import {
  dispatch,
  Effects,
  InvalidInvokeCallSiteError,
  InvalidInvokeInputError,
  InvalidInvokeOptionError,
  type InvokeOpts,
} from "@tisyn/effects";
import {
  DispatchContext,
  evaluateMiddlewareFn,
  installReplayDispatch,
} from "@tisyn/effects/internal";
import {
  installAgentTransport,
  type AgentTransportFactory,
  CoroutineContext,
} from "@tisyn/transport";
import type { FnNode } from "@tisyn/ir";
import { ConfigContext } from "./config-scope.js";
import { withOverlayFrame } from "./scoped-effect-stack.js";

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

/**
 * Per-dispatch context carrying the runtime identity the replay lane needs.
 * Pushed by `dispatchStandardEffect` immediately before delegating into the
 * middleware chain; read by the replay-lane middleware installed at the top
 * of `execute()`. Not exported.
 */
interface RuntimeDispatchValue {
  coroutineId: string;
  ctx: DriveContext;
}

const RuntimeDispatchContext = createContext<RuntimeDispatchValue | null>(
  "$tisyn-runtime-dispatch",
  null,
);

/**
 * Append a CloseEvent to the durable stream only if no CloseEvent is already
 * recorded for this coroutineId. Preserves pre-Phase-4 behavior on live runs
 * (first-time close always appends) and prevents duplicate close-event writes
 * when replay re-executes a coroutine through `ctx.invoke` (the coroutine's
 * close is already in the stream from the original live run; journal push
 * remains the caller's responsibility).
 */
function* maybeAppendCloseToStream(ctx: DriveContext, closeEvent: CloseEvent): Operation<void> {
  if (!ctx.replayIndex.hasClose(closeEvent.coroutineId)) {
    yield* ctx.stream.append(closeEvent);
  }
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

// ── Nested invocation helpers ──

function isFnNode(value: unknown): value is FnNode {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { tisyn?: unknown }).tisyn === "fn" &&
    Array.isArray((value as { params?: unknown }).params)
  );
}

function validateInvokeOpts(opts: InvokeOpts | undefined): void {
  if (opts === undefined || opts === null) {
    return;
  }
  if (typeof opts !== "object") {
    throw new InvalidInvokeOptionError("opts must be an object");
  }
  if ("overlay" in opts && opts.overlay !== undefined) {
    const ov = opts.overlay as unknown;
    if (typeof ov !== "object" || ov === null) {
      throw new InvalidInvokeOptionError("opts.overlay must be an object");
    }
    const frame = ov as Record<string, unknown>;
    if (typeof frame.kind !== "string") {
      throw new InvalidInvokeOptionError("opts.overlay.kind must be a string");
    }
    if (typeof frame.id !== "string") {
      throw new InvalidInvokeOptionError("opts.overlay.id must be a string");
    }
  }
  if ("label" in opts && opts.label !== undefined && typeof opts.label !== "string") {
    throw new InvalidInvokeOptionError("opts.label must be a string");
  }
}

function mapChildResultToOperationOutcome<T>(r: EventResult): T {
  if (r.status === "ok") {
    return (r.value ?? null) as T;
  }
  if (r.status === "error") {
    throw new EffectError(r.error.message, r.error.name);
  }
  if (r.status === "cancelled") {
    throw new InvocationCancelledError();
  }
  throw new RuntimeBugError(`unknown child close status: ${(r as { status: string }).status}`);
}

function buildDispatchContext(args: {
  coroutineId: string;
  parentEnv: Env;
  driveContext: DriveContext;
  allocateChildId: () => string;
}): DispatchContext {
  const { coroutineId, parentEnv, driveContext, allocateChildId } = args;
  const self: DispatchContext = {
    coroutineId,
    *invoke<T>(fn: FnNode, invokeArgs: readonly Val[], opts?: InvokeOpts): Operation<T> {
      // §5.3.3: may only be called while the SAME ctx is the currently-active
      // DispatchContext. Stale/captured/agent-handler reuse fails here and
      // MUST NOT advance the allocator.
      const active = yield* DispatchContext.get();
      if (active !== self) {
        throw new InvalidInvokeCallSiteError(
          "ctx.invoke may only be called while its owning dispatch-boundary middleware is active",
        );
      }
      if (!isFnNode(fn)) {
        throw new InvalidInvokeInputError("fn must be a compiled Fn node");
      }
      if (!Array.isArray(invokeArgs)) {
        throw new InvalidInvokeInputError("args must be an array");
      }
      validateInvokeOpts(opts);

      // §6.2: advance allocator atomically at the moment of the call.
      const childId = allocateChildId();

      const childEnv = extendMulti(parentEnv, [...fn.params], invokeArgs as Val[]);
      const childKernel = evaluate(fn.body as Expr, childEnv);

      const driveChild = () => driveKernel(childKernel, childId, childEnv, driveContext);

      const childResult: EventResult = opts?.overlay
        ? yield* withOverlayFrame(opts.overlay, driveChild)
        : yield* driveChild();

      return mapChildResultToOperationOutcome<T>(childResult);
    },
    *invokeInline<T>(fn: FnNode, invokeArgs: readonly Val[], opts?: InvokeOpts): Operation<T> {
      // v6 §6.2.3: stale-context check. Only valid while the SAME ctx is
      // the currently-active DispatchContext. Rejected calls (here or
      // below via input validation) MUST NOT advance the allocator.
      const active = yield* DispatchContext.get();
      if (active !== self) {
        throw new InvalidInvokeCallSiteError(
          "ctx.invokeInline may only be called while its owning dispatch-boundary middleware is active",
        );
      }
      if (!isFnNode(fn)) {
        throw new InvalidInvokeInputError("invokeInline: fn must be a compiled Fn node");
      }
      if (!Array.isArray(invokeArgs)) {
        throw new InvalidInvokeInputError("invokeInline: args must be an array");
      }
      validateInvokeOpts(opts);

      // v6 §7.2: advance the caller's unified childSpawnCount by exactly
      // +1 at the moment of the accepted call.
      const laneId = allocateChildId();

      const laneEnv = extendMulti(parentEnv, [...fn.params], invokeArgs as Val[]);
      const laneKernel = evaluate(fn.body as Expr, laneEnv);

      const driveLane = () => driveInlineBody<T>(laneKernel, laneId, laneEnv, driveContext);

      if (opts?.overlay) {
        return yield* withOverlayFrame(opts.overlay, driveLane);
      }
      return yield* driveLane();
    },
  };
  return self;
}

// ── Inline invocation body driver ──

/**
 * Drive a compiled `Fn` as an inline lane under its caller's Effection
 * scope. Implements the Phase 5B subset of
 * `tisyn-inline-invocation-specification.md` v6:
 *
 * - Standard-effect dispatches (agent effects + `__config`) journal
 *   under `laneId` via the shared `dispatchStandardEffect` helper and
 *   participate in replay on the lane's independent cursor.
 * - Lane has its own `childSpawnCount` starting at 0 (v6 §7.3); nested
 *   `invokeInline` / `invoke` from middleware handling the body's
 *   dispatched effects allocate from this per-lane counter.
 * - Lane produces NO `CloseEvent` — ever. Normal completion returns
 *   the kernel's final value directly; uncaught errors propagate
 *   directly to the caller's middleware frame.
 * - Compound externals (`scope`, `spawn`, `join`, `resource`,
 *   `timebox`, `all`, `race`) inside an inline body are rejected with
 *   a clear error: Phase 5B runtime scope does NOT run them under
 *   inline-lane semantics yet.
 * - `stream.subscribe` and `stream.next` inside an inline body are
 *   rejected with a clear error: v6 §12.4 requires owner-coroutineId
 *   counter allocation for the deterministic token; Phase 5B defers
 *   that and rejects the effect ids rather than producing journal
 *   entries that would violate the landed spec.
 */
function* driveInlineBody<T = Val>(
  kernel: Generator<EffectDescriptor, Val, Val>,
  laneId: string,
  env: Env,
  ctx: DriveContext,
): Operation<T> {
  // Own childSpawnCount per v6 §7.3.
  let inlineChildSpawnCount = 0;
  let subscriptionCounter = 0; // Never consumed: stream effects rejected below.
  let nextValue: Val = null;
  let pendingStep: IteratorResult<EffectDescriptor, Val> | null = null;

  for (;;) {
    const step = pendingStep ?? kernel.next(nextValue);
    pendingStep = null;

    if (step.done) {
      // v6 §8.4: NO CloseEvent for the inline lane. Return the kernel's
      // terminal value directly to the caller's middleware frame.
      return (step.value ?? null) as T;
    }

    const descriptor = step.value as EffectDescriptor;

    // Compound-external descriptors are out of scope for this phase (see
    // decision log §4 of the Phase 5B plan). Reject uniformly with a
    // clear error that names the descriptor id.
    if (isCompoundExternal(descriptor.id)) {
      throw new Error(
        `invokeInline body dispatched compound external '${descriptor.id}'; ` +
          `compound primitives inside inline bodies are deferred (Phase 5B scope; ` +
          `see tisyn-inline-invocation-specification.md §11)`,
      );
    }

    // Stream intrinsics require owner-coroutineId counter allocation
    // per v6 §12.4 which is deferred. Reject both effect ids rather
    // than emitting lane-local tokens that would violate the spec.
    if (descriptor.id === "stream.subscribe" || descriptor.id === "stream.next") {
      throw new Error(
        `invokeInline body dispatched '${descriptor.id}'; stream effects inside ` +
          `inline bodies require owner-counter semantics ` +
          `(tisyn-inline-invocation-specification.md §12.4) which are deferred ` +
          `in Phase 5B. Use plain agent effects inside the inline body for now.`,
      );
    }

    // Agent effects and `__config` go through the shared helper. The
    // lane's independent coroutineId + its own allocator are threaded
    // through here so nested invoke/invokeInline calls from middleware
    // handling the body's dispatched effects allocate from the lane.
    const { result } = yield* dispatchStandardEffect({
      descriptor,
      coroutineId: laneId,
      env,
      ctx,
      allocateChildId: () => `${laneId}.${inlineChildSpawnCount++}`,
      allocateSubscriptionToken: () => `sub:${laneId}:${subscriptionCounter++}`,
      advanceSubscriptionCounter: () => {
        subscriptionCounter++;
      },
    });

    if (result.status === "ok") {
      nextValue = (result.value ?? null) as Val;
    } else if (result.status === "error") {
      // Propagate as EffectError through the kernel. Three outcomes:
      //
      //  (a) Kernel body does not catch the error. `kernel.throw(err)`
      //      re-throws naturally, which exits `driveInlineBody` with
      //      the error reaching the caller's middleware frame — v6
      //      §13.1. No CloseEvent (v6 §8.4), no teardown.
      //
      //  (b) Kernel body catches the error and returns a fallback
      //      value. `kernel.throw(err)` returns `{ done: true, value }`.
      //      The inline body resolved; return the fallback value
      //      directly without writing a CloseEvent.
      //
      //  (c) Kernel body catches the error and yields another
      //      effect. `kernel.throw(err)` returns `{ done: false,
      //      value: <next descriptor> }`. Continue the loop with
      //      that as the pending step.
      const err = new EffectError(result.error.message, result.error.name);
      const throwResult = kernel.throw(err);
      if (throwResult.done) {
        return (throwResult.value ?? null) as T;
      }
      pendingStep = throwResult;
      nextValue = null;
      continue;
    } else {
      throw new RuntimeBugError(
        "dispatchStandardEffect returned cancelled status to driveInlineBody",
      );
    }
  }
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
          status: "error",
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

    // Install the replay-substitution lane. The middleware fires on every
    // dispatch that enters the Effects chain; when no RuntimeDispatchContext
    // is set (e.g. a raw test-only dispatch outside the kernel driver) or
    // when no stored cursor entry exists, it passes through to `next`.
    // Structural replay substitution — §9.5 of the scoped-effects spec.
    yield* installReplayDispatch(function* replayLane(
      [effectId, data]: [string, Val],
      next: (eid: string, d: Val) => Operation<Val>,
    ): Operation<Val> {
      const rctx = yield* RuntimeDispatchContext.get();
      if (rctx == null) {
        return yield* next(effectId, data);
      }

      const stored = rctx.ctx.replayIndex.peekYield(rctx.coroutineId);
      if (stored == null) {
        return yield* next(effectId, data);
      }

      // Authoritative divergence check runs in the helper BEFORE the chain;
      // the defensive re-check here guards against runtime bugs.
      const description = parseEffectId(effectId);
      if (
        stored.description.type !== description.type ||
        stored.description.name !== description.name
      ) {
        throw new RuntimeBugError(
          `Replay lane observed descriptor mismatch at ${rctx.coroutineId}`,
        );
      }

      rctx.ctx.replayIndex.consumeYield(rctx.coroutineId);
      const replayedEvent: YieldEvent = {
        type: "yield",
        coroutineId: rctx.coroutineId,
        description: stored.description,
        result: stored.result,
      };
      rctx.ctx.journal.push(replayedEvent);

      if (stored.result.status === "ok") {
        return (stored.result.value ?? null) as Val;
      }
      if (stored.result.status === "error") {
        throw new EffectError(stored.result.error.message, stored.result.error.name);
      }
      throw new Error("Cannot replay cancelled result");
    });

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
            status: "error" as const,
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
      yield* maybeAppendCloseToStream(ctx, closeEvent);
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
          yield* maybeAppendCloseToStream(ctx, closeEvent);
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
                yield* maybeAppendCloseToStream(ctx, closeEvent);
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
                if (result.status === "error") {
                  // R12: child failure tears down parent scope unconditionally
                  const errResult = result as {
                    status: "error";
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
                status: "error";
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
                yield* maybeAppendCloseToStream(ctx, closeEvent);
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
                yield* maybeAppendCloseToStream(ctx, closeEvent);
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

        // ── Standard effect dispatch (helper-unified) ──
        const { result: effectResult } = yield* dispatchStandardEffect({
          descriptor,
          coroutineId,
          env,
          ctx,
          allocateChildId: () => `${coroutineId}.${childSpawnCount++}`,
          allocateSubscriptionToken: () => `sub:${coroutineId}:${subscriptionCounter++}`,
          advanceSubscriptionCounter: () => {
            subscriptionCounter++;
          },
        });

        if (effectResult.status === "ok") {
          nextValue = (effectResult.value ?? null) as Val;
        } else if (effectResult.status === "error") {
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
            yield* maybeAppendCloseToStream(ctx, closeEvent);
            ctx.journal.push(closeEvent);
            return { status: "ok", value: throwResult.value as Json };
          }
          // kernel.throw() yielded a new effect (e.g., from catch/finally body)
          pendingStep = throwResult;
          nextValue = null;
          continue;
        } else {
          throw new RuntimeBugError(
            "dispatchStandardEffect returned cancelled status to driveKernel",
          );
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
            status: "error",
            error: { message: error.message, name: error.name },
          },
        };
        yield* maybeAppendCloseToStream(ctx, closeEvent);
        ctx.journal.push(closeEvent);
        throw error;
      }

      closed = true;
      const err = error instanceof Error ? error : new Error(String(error));
      const closeEvent: CloseEvent = {
        type: "close",
        coroutineId,
        result: {
          status: "error",
          error: { message: err.message, name: err.name },
        },
      };
      yield* maybeAppendCloseToStream(ctx, closeEvent);
      ctx.journal.push(closeEvent);

      return {
        status: "error",
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

        if (result.status === "error") {
          // Fail-fast: reject immediately, scope teardown halts siblings
          const err = result as {
            status: "error";
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
        } else if (result.status === "error") {
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
            status: "error";
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
            status: "error";
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
          result: { status: "error", error: { message: err.message, name: err.name } },
        };
        yield* maybeAppendCloseToStream(ctx, closeEvent);
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
    const errResult = result as { status: "error"; error: { message: string; name?: string } };
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
  childEnv: Env,
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
      yield* maybeAppendCloseToStream(ctx, closeEvent);
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
                if (result.status === "error") {
                  const errResult = result as {
                    status: "error";
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
                status: "error";
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

        // ── Standard effect dispatch (helper-unified, resource init) ──
        const { result: effectResult } = yield* dispatchStandardEffect({
          descriptor,
          coroutineId: childId,
          env: childEnv,
          ctx,
          allocateChildId: () => `${childId}.${childSpawnCount++}`,
          allocateSubscriptionToken: () => `sub:${childId}:${subscriptionCounter++}`,
          advanceSubscriptionCounter: () => {
            subscriptionCounter++;
          },
        });

        if (effectResult.status === "ok") {
          nextValue = (effectResult.value ?? null) as Val;
        } else if (effectResult.status === "error") {
          const err = new EffectError(effectResult.error.message, effectResult.error.name);
          const throwResult = childKernel.throw(err);
          if (throwResult.done) {
            throw new RuntimeBugError("Resource body completed without provide");
          }
          pendingStep = throwResult;
          nextValue = null;
          continue;
        } else {
          throw new RuntimeBugError(
            "dispatchStandardEffect returned cancelled status to resource init",
          );
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
        status: "error",
        error: { message: err.message, name: err.name },
      },
    };
    yield* maybeAppendCloseToStream(ctx, closeEvent);
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
          yield* maybeAppendCloseToStream(ctx, closeEvent);
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
                yield* maybeAppendCloseToStream(ctx, closeEvent);
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
                if (result.status === "error") {
                  const errResult = result as {
                    status: "error";
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
                status: "error";
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

        // ── Standard effect dispatch (helper-unified, resource cleanup) ──
        const { result: effectResult } = yield* dispatchStandardEffect({
          descriptor,
          coroutineId: childId,
          env: childEnv,
          ctx,
          allocateChildId: () => `${childId}.${childSpawnCount++}`,
          allocateSubscriptionToken: () => `sub:${childId}:${subscriptionCounter++}`,
          advanceSubscriptionCounter: () => {
            subscriptionCounter++;
          },
        });

        if (effectResult.status === "ok") {
          nextValue = (effectResult.value ?? null) as Val;
        } else if (effectResult.status === "error") {
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
            yield* maybeAppendCloseToStream(ctx, closeEvent);
            ctx.journal.push(closeEvent);
            cleanupResolve();
            return;
          }
          pendingStep = throwResult;
          nextValue = null;
          continue;
        } else {
          throw new RuntimeBugError(
            "dispatchStandardEffect returned cancelled status to resource cleanup",
          );
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
          status: "error",
          error: { message: err.message, name: err.name },
        },
      };
      yield* maybeAppendCloseToStream(ctx, closeEvent);
      ctx.journal.push(closeEvent);
    }
    cleanupResolve();
    throw error; // Propagate to parent scope
  }
}

// ── Shared standard-effect dispatch helper ──

interface DispatchStandardEffectParams {
  descriptor: EffectDescriptor;
  coroutineId: string;
  env: Env;
  ctx: DriveContext;
  allocateChildId: () => string;
  /** Allocate the next subscription token on the live `stream.subscribe` path. */
  allocateSubscriptionToken: () => string;
  /**
   * Advance the caller's subscription counter on a replayed `stream.subscribe`
   * success. Prevents token reuse when execution later reaches the live frontier.
   */
  advanceSubscriptionCounter: () => void;
}

interface DispatchStandardEffectResult {
  /**
   * `true` when the result came from the journal (either via the replay lane
   * or via short-circuit-with-stored-cursor §9.5.5). `false` on live dispatch.
   */
  replayed: boolean;
  result: EventResult;
}

/**
 * Dispatch one standard (non-compound) effect descriptor through the runtime's
 * replay-aware dispatch model. Unifies the three previously-duplicated paths
 * (ordinary coroutine dispatch, resource init body, resource cleanup body).
 *
 * Caller is responsible for feeding `result` back into its own kernel
 * (`kernel.next`, `kernel.throw`) and for handling close-event shape (resource
 * init rejects provide, resource cleanup resolves cleanup, root driveKernel
 * writes Close events).
 *
 * Correctness invariants (§9.5 of scoped-effects spec + runtime handoff):
 *  - §9.5.3 rule: replay substitution pushes a replayed YieldEvent to the
 *    in-memory journal only; it MUST NOT be re-appended to the durable stream.
 *  - §9.5.4: max-priority middleware re-executes on replay; min-priority
 *    middleware and framework handlers do not re-execute when a stored cursor
 *    entry exists.
 *  - §9.5.5: if max short-circuits without calling `next` while a stored
 *    cursor entry exists, the stored result is authoritative at chain exit.
 *  - RV2: `containsSubscriptionHandle(data)` guards the live agent-effect
 *    path only; stored replay is cursor-authoritative and skips this check.
 *  - Close-after-replay: peek-miss + `hasClose(coroutineId)` throws
 *    `DivergenceError` before any live handling, for both intrinsic and
 *    agent-effect paths.
 */
function* dispatchStandardEffect(
  params: DispatchStandardEffectParams,
): Operation<DispatchStandardEffectResult> {
  const {
    descriptor,
    coroutineId,
    env,
    ctx,
    allocateChildId,
    allocateSubscriptionToken,
    advanceSubscriptionCounter,
  } = params;

  const description = parseEffectId(descriptor.id);
  const stored = ctx.replayIndex.peekYield(coroutineId);

  // Authoritative divergence pre-check. Applies to both intrinsic and
  // agent-effect paths; runs before any live handling.
  if (stored) {
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
  }

  // ── Runtime intrinsic bypass ──
  const isIntrinsic =
    descriptor.id === "__config" ||
    descriptor.id === "stream.subscribe" ||
    descriptor.id === "stream.next";

  if (isIntrinsic) {
    if (stored) {
      // Replay intrinsic.
      ctx.replayIndex.consumeYield(coroutineId);

      // stream.subscribe replay: restore subscription map entry from stored
      // handle AND advance counter so the live frontier does not reuse tokens.
      if (descriptor.id === "stream.subscribe" && stored.result.status === "ok") {
        const handle = stored.result.value as Record<string, unknown> | null;
        if (handle && typeof handle === "object" && "__tisyn_subscription" in handle) {
          ctx.subscriptions.set(handle.__tisyn_subscription as string, {
            subscription: null,
            sourceDefinition: descriptor.data,
          });
          advanceSubscriptionCounter();
        }
      }

      const replayedEvent: YieldEvent = {
        type: "yield",
        coroutineId,
        description: stored.description,
        result: stored.result,
      };
      ctx.journal.push(replayedEvent);
      return { replayed: true, result: stored.result };
    }

    // Peek-miss: close-after-replay divergence guard.
    if (ctx.replayIndex.hasClose(coroutineId)) {
      throw new DivergenceError(
        `Divergence: journal shows ${coroutineId} closed, but generator continues to yield effects`,
      );
    }

    // Live intrinsic.
    let effectResult: EventResult;
    try {
      let resultValue: Val;
      if (descriptor.id === "__config") {
        resultValue = (yield* ConfigContext.expect()) as Val;
      } else if (descriptor.id === "stream.subscribe") {
        const token = allocateSubscriptionToken();
        const sourceData = descriptor.data as unknown[];
        const source = sourceData[0];
        const sub = yield* source as Operation<{
          next(): Operation<IteratorResult<Val, unknown>>;
        }>;
        ctx.subscriptions.set(token, { subscription: sub, sourceDefinition: source });
        resultValue = { __tisyn_subscription: token } as unknown as Val;
      } else {
        // stream.next
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
      }
      effectResult = { status: "ok", value: resultValue as Json };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      effectResult = {
        status: "error",
        error: { message: err.message, name: err.name },
      };
    }

    const yieldEvent: YieldEvent = {
      type: "yield",
      coroutineId,
      description,
      result: effectResult,
    };
    yield* ctx.stream.append(yieldEvent);
    ctx.journal.push(yieldEvent);
    return { replayed: false, result: effectResult };
  }

  // ── Agent-effect path ──

  // Peek-miss guards (only apply when stored == null → live dispatch).
  if (stored == null) {
    if (ctx.replayIndex.hasClose(coroutineId)) {
      throw new DivergenceError(
        `Divergence: journal shows ${coroutineId} closed, but generator continues to yield effects`,
      );
    }
    // RV2: reject subscription handles in non-stream effect dispatch data.
    if (containsSubscriptionHandle(descriptor.data)) {
      throw new SubscriptionCapabilityError(
        `Effect '${descriptor.id}': resolved data contains a subscription handle, which is a restricted capability value`,
      );
    }
  }

  const cursorBefore = ctx.replayIndex.getCursor(coroutineId);

  // Fresh DispatchContext for this dispatch chain — middleware may call
  // ctx.invoke(fn, args, opts?) to run a compiled Fn as a journaled child
  // coroutine under the caller's allocator. Pushed for all three caller
  // paths (ordinary + resource init + resource cleanup), so resource-body
  // middleware gains invoke capability (§9.5.7).
  const dispatchCtx = buildDispatchContext({
    coroutineId,
    parentEnv: env,
    driveContext: ctx,
    allocateChildId,
  });

  const runtimeCtxValue: RuntimeDispatchValue = { coroutineId, ctx };

  let threw: Error | null = null;
  let resultValue: Val = null;
  try {
    resultValue = yield* DispatchContext.with(dispatchCtx, () =>
      RuntimeDispatchContext.with(runtimeCtxValue, () =>
        dispatch(descriptor.id, descriptor.data as Val),
      ),
    );
  } catch (error) {
    threw = error instanceof Error ? error : new Error(String(error));
  }

  const cursorAfter = ctx.replayIndex.getCursor(coroutineId);
  const replayed = cursorAfter > cursorBefore;

  if (replayed && stored) {
    // Replayed by the lane (ok or error). Return the stored EventResult
    // exactly — do NOT rebuild from the returned value or caught error.
    // Ensures byte-identical journal across live and replay runs.
    return { replayed: true, result: stored.result };
  }

  if (!replayed && stored) {
    // §9.5.5: max middleware short-circuited without calling `next`. The
    // lane never fired, so the cursor is still present and authoritative.
    // Runtime consumes it now, journals the stored event, and overrides
    // the short-circuit return value.
    ctx.replayIndex.consumeYield(coroutineId);
    const replayedEvent: YieldEvent = {
      type: "yield",
      coroutineId,
      description: stored.description,
      result: stored.result,
    };
    ctx.journal.push(replayedEvent);
    return { replayed: true, result: stored.result };
  }

  // Live dispatch — persist-before-resume.
  const effectResult: EventResult = threw
    ? { status: "error", error: { message: threw.message, name: threw.name } }
    : { status: "ok", value: resultValue as Json };

  const yieldEvent: YieldEvent = {
    type: "yield",
    coroutineId,
    description,
    result: effectResult,
  };
  yield* ctx.stream.append(yieldEvent);
  ctx.journal.push(yieldEvent);
  return { replayed: false, result: effectResult };
}
