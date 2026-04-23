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
  type EffectDescription,
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
import { evaluate, type Env, envFromRecord, extendMulti, payloadSha } from "@tisyn/kernel";
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
  RuntimeTerminal,
  type RuntimeTerminalBoundary,
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
 * Per-frame state shared between driveKernel (caller cursor) and any
 * iterateFrame invocations on the same frame (e.g. inline lanes).
 *
 * `yieldIndex` is the standard-effect ordinal for the caller's OWN cursor
 * only — it advances on replay-consume and live-append when iterateFrame is
 * processing the caller's cursor (journalLaneId === effectiveCoroutineId),
 * and is NOT advanced by inline-lane iteration. It is the source of `q` in
 * inline lane keys (`tisyn-inline-invocation-specification.md` §6.5.5).
 *
 * Lane cursor positions are tracked inside ReplayIndex, not on FrameState.
 */
interface FrameState {
  childSpawnCount: number;
  subscriptionCounter: number;
  yieldIndex: number;
  spawnedTasks: Map<string, { operation: Operation<EventResult> }>;
  joinedTasks: Set<string>;
  resourceChildren: ResourceChild[];
}

/**
 * Append a `CloseEvent` to the durable stream and the in-memory journal,
 * unless the replay cursor already has a Close for this coroutineId (in which
 * case the event is pushed to `ctx.journal` for re-materialization without
 * re-appending to the stream).
 *
 * Under scoped-effects §9.5, middleware re-executes on replay, which means
 * child driveKernels triggered by middleware-internal `invoke(...)` also
 * re-execute. Their kernel completions would otherwise re-append Close events
 * that are already durable. This helper keeps the stream append-only and
 * idempotent under replay.
 */
function* appendCloseEvent(ctx: DriveContext, closeEvent: CloseEvent): Operation<void> {
  if (ctx.replayIndex.getClose(closeEvent.coroutineId)) {
    ctx.journal.push(closeEvent);
    return;
  }
  yield* ctx.stream.append(closeEvent);
  ctx.journal.push(closeEvent);
}

function createFrameState(): FrameState {
  return {
    childSpawnCount: 0,
    subscriptionCounter: 0,
    yieldIndex: 0,
    spawnedTasks: new Map(),
    joinedTasks: new Set(),
    resourceChildren: [],
  };
}

/**
 * Build the `EffectDescription` stored in a YieldEvent for the given dispatch.
 *
 * Per scoped-effects §9.5, payload-sensitive divergence compares
 * type + name + `payloadSha(data)`. `stream.subscribe` is the one documented
 * exclusion: its `data` is `[Operation, ...]` where the source is a live
 * Effection Operation with no stable journaled identity in the current IR
 * surface — canonical JSON collapses the source to `{}`, so any sha would be
 * a degenerate constant. Replay of `stream.subscribe` therefore matches on
 * type + name only, which preserves the stored handle flow across recovery
 * but does NOT detect source-identity divergence for subscribe.
 * `stream.next` remains payload-sensitive: its `data` is `[handleToken, ...]`
 * where `handleToken` is a canonicalizable string.
 */
function describeEffect(descriptor: EffectDescriptor): EffectDescription {
  const base = parseEffectId(descriptor.id);
  if (descriptor.id === "stream.subscribe") {
    return base;
  }
  return { ...base, sha: payloadSha(descriptor.data as Json) };
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
  frame: FrameState;
  /**
   * True when the dispatch is for an effect yielded inside an inline body —
   * i.e. the enclosing iterateFrame is processing an inline lane cursor
   * rather than the caller's own cursor. When true, `ctx.invokeInline` MUST
   * reject per `tisyn-inline-invocation-specification.md` §5.3.1.a (nested
   * inline invocation is an MVP non-goal).
   */
  isInlineLane: boolean;
}): DispatchContext {
  const { coroutineId, parentEnv, driveContext, frame, isInlineLane } = args;
  const allocateChildId = (): string => `${coroutineId}.${frame.childSpawnCount++}`;
  // `q` — caller yield ordinal for this dispatch, captured once at builder
  // construction (i.e. at dispatch entry). Held in the closure so all
  // invokeInline calls within the same dispatch share `q` and vary only in
  // `j`. Per spec §6.5.5.
  const q = frame.yieldIndex;
  // `j` — per-dispatch invokeInline counter, starting at 0 for the first
  // invokeInline call in this middleware body.
  let j = 0;
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
      // §5.3.3: only callable while this ctx is the active DispatchContext.
      const active = yield* DispatchContext.get();
      if (active !== self) {
        throw new InvalidInvokeCallSiteError(
          "ctx.invokeInline may only be called while its owning dispatch-boundary middleware is active",
        );
      }
      // §5.3.1.a: reject when the current dispatch is on an inline lane.
      // Zero side effects per IH9: no lane allocated, no `j` increment, no
      // `fn.body` evaluation, no overlay push, no allocator advancement.
      if (isInlineLane) {
        throw new InvalidInvokeCallSiteError(
          "invokeInline must not be called from middleware dispatching an inline-body effect; nested inline invocation is out of scope for MVP (spec §5.3.1.a, §11)",
        );
      }
      if (!isFnNode(fn)) {
        throw new InvalidInvokeInputError("fn must be a compiled Fn node");
      }
      if (!Array.isArray(invokeArgs)) {
        throw new InvalidInvokeInputError("args must be an array");
      }
      validateInvokeOpts(opts);

      // §6.5.5: form the deterministic inline lane key from `(q, j)`. `q` is
      // the caller yield ordinal at dispatch entry; `j` is the per-dispatch
      // counter. Advance `j` atomically on a successful call — rejections
      // above MUST NOT touch `j`.
      const laneId = `${coroutineId}@inline${q}.${j++}`;

      const inlineEnv = extendMulti(parentEnv, [...fn.params], invokeArgs as Val[]);
      const inlineKernel = evaluate(fn.body as Expr, inlineEnv);

      // Run the inline body on its lane cursor while keeping
      // effectiveCoroutineId = the caller's coroutineId. iterateFrame writes
      // YieldEvents under `laneId` and reads replayIndex under `laneId`, but
      // uses `coroutineId` for child-ID formation, subscription tokens, and
      // ancestry checks. `frame.yieldIndex` is not advanced by this iteration
      // because the journalLaneId ≠ effectiveCoroutineId guard in
      // iterateFrame suppresses it.
      const run = (): Operation<Val> =>
        iterateFrame(inlineKernel, laneId, coroutineId, inlineEnv, driveContext, frame);
      const value = opts?.overlay ? yield* withOverlayFrame(opts.overlay, run) : yield* run();
      return value as T;
    },
  };
  return self;
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
      yield* appendCloseEvent(ctx, closeEvent);
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

  // Per-frame state (unified child allocator, subscription counter, spawn/join
  // tracking, resource children, and the caller's yieldIndex ordinal). See
  // FrameState above.
  const frame = createFrameState();

  // scoped() binds spawned children to the parent's lifetime:
  // children are alive while the parent runs, torn down when the parent exits.
  return yield* scoped(function* () {
    yield* CoroutineContext.set(coroutineId);
    try {
      // driveKernel processes the caller's own cursor — journalLaneId and
      // effectiveCoroutineId are the same value. `iterateFrame` returns the
      // kernel's final value on normal completion; exceptions propagate up
      // through this try and are converted to an error CloseEvent below.
      const value = yield* iterateFrame(kernel, coroutineId, coroutineId, env, ctx, frame);

      // Normal completion: RV3 subscription-handle check, R21 resource
      // teardown in reverse creation order, then CloseEvent(ok).
      assertNoSubscriptionHandleInCloseValue(value);
      yield* teardownResourceChildren(frame.resourceChildren);
      closed = true;
      const closeEvent: CloseEvent = {
        type: "close",
        coroutineId,
        result: { status: "ok", value: value as Json },
      };
      yield* appendCloseEvent(ctx, closeEvent);
      return { status: "ok", value: value as Json };
    } catch (error) {
      // R23: Tear down resource children before writing parent CloseEvent.
      yield* teardownResourceChildren(frame.resourceChildren);

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
        yield* appendCloseEvent(ctx, closeEvent);
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
      yield* appendCloseEvent(ctx, closeEvent);

      return {
        status: "error",
        error: { message: err.message, name: err.name },
      };
    }
  }); // end scoped — tears down unjoined spawned children
}

/**
 * Iterate the kernel generator for a single cursor: consume replay entries
 * when present, dispatch effects live when not, and maintain compound-external
 * orchestration. Returns the generator's final `Val` on normal completion;
 * exceptions (DivergenceError, effect errors unhandled by kernel.throw, etc.)
 * propagate up to the caller.
 *
 * This helper is shared by `driveKernel` (which runs with journalLaneId ===
 * effectiveCoroutineId for the caller's own cursor) and by `ctx.invokeInline`
 * (which runs with journalLaneId = inline lane key per
 * `tisyn-inline-invocation-specification.md` §6.5.5 while keeping
 * effectiveCoroutineId = the caller's id).
 *
 * Notes:
 * - `journalLaneId` is used for `YieldEvent.coroutineId` and `ReplayIndex`
 *   cursor keys (peek/consume/getCursor/hasClose). This is what partitions
 *   the replay cursor.
 * - `effectiveCoroutineId` is used for child-ID formation
 *   (`${effectiveCoroutineId}.${frame.childSpawnCount++}`), subscription
 *   tokens, ancestry checks, and the `coroutineId` field installed on the
 *   `DispatchContext`. Ownership semantics follow this id.
 * - `frame.yieldIndex` is the caller's standard-effect ordinal. It advances
 *   only when iterateFrame is processing the caller's own cursor
 *   (journalLaneId === effectiveCoroutineId). Inline-lane iterations MUST
 *   NOT advance it; doing so would corrupt the `q` the caller captures for
 *   subsequent inline lane keys.
 * - iterateFrame does NOT wrap in `scoped()`, does NOT call
 *   `CoroutineContext.set`, does NOT write any `CloseEvent`, and does NOT
 *   tear down `frame.resourceChildren`. Those are the responsibility of the
 *   enclosing `driveKernel`.
 */
function* iterateFrame(
  kernel: Generator<EffectDescriptor, Val, Val>,
  journalLaneId: string,
  effectiveCoroutineId: string,
  env: Env,
  ctx: DriveContext,
  frame: FrameState,
): Operation<Val> {
  const isCallerCursor = journalLaneId === effectiveCoroutineId;
  let nextValue: Val = null;
  let pendingStep: IteratorResult<EffectDescriptor, Val> | null = null;

  for (;;) {
    const step = pendingStep ?? kernel.next(nextValue);
    pendingStep = null;

    if (step.done) {
      return step.value;
    }

    const descriptor = step.value as EffectDescriptor;

    // ── Compound effect interception ──
    if (isCompoundExternal(descriptor.id)) {
      const compoundData = descriptor.data as { __tisyn_inner: unknown; __tisyn_env: Env };
      const childEnv = compoundData.__tisyn_env;

      if (descriptor.id === "scope") {
        const inner = compoundData.__tisyn_inner as ScopeInner;
        const childId = `${effectiveCoroutineId}.${frame.childSpawnCount++}`;
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
            return throwResult.value;
          }
          pendingStep = throwResult;
          nextValue = null;
        }
      } else if (descriptor.id === "spawn") {
        // R1: deterministic child ID
        const childId = `${effectiveCoroutineId}.${frame.childSpawnCount++}`;
        const inner = compoundData.__tisyn_inner as { body: Expr };
        const childKernel = evaluate(inner.body, childEnv);

        const {
          operation: joinOp,
          resolve: joinResolve,
          reject: joinReject,
        } = withResolvers<EventResult>();
        frame.spawnedTasks.set(childId, { operation: joinOp });

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
        const taskHandle = compoundData.__tisyn_inner as Val;
        if (
          taskHandle === null ||
          typeof taskHandle !== "object" ||
          typeof (taskHandle as Record<string, unknown>).__tisyn_task !== "string"
        ) {
          throw new RuntimeBugError("join: inner value is not a valid task handle");
        }
        const childId = (taskHandle as { __tisyn_task: string }).__tisyn_task;
        if (frame.joinedTasks.has(childId)) {
          throw new RuntimeBugError(`join: task '${childId}' has already been joined`);
        }
        frame.joinedTasks.add(childId);
        const entry = frame.spawnedTasks.get(childId);
        if (!entry) {
          throw new RuntimeBugError(`join: no spawned task found for '${childId}'`);
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
      } else if (descriptor.id === "resource") {
        const childId = `${effectiveCoroutineId}.${frame.childSpawnCount++}`;
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
          frame.resourceChildren.push({
            childId,
            signalTeardown: teardownRes,
            waitCleanup: cleanupOp,
          });
          nextValue = resourceValue;
        } else {
          const throwResult = kernel.throw(resourceErr);
          if (throwResult.done) {
            return throwResult.value;
          }
          pendingStep = throwResult;
          nextValue = null;
        }
      } else if (descriptor.id === "timebox") {
        const inner = compoundData.__tisyn_inner as { duration: number; body: Expr };
        // TB-R2: allocate 2 child IDs — body = N, timeout = N+1
        const bodyChildId = `${effectiveCoroutineId}.${frame.childSpawnCount++}`;
        const timeoutChildId = `${effectiveCoroutineId}.${frame.childSpawnCount++}`;

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
            return throwResult.value;
          }
          pendingStep = throwResult;
          nextValue = null;
        }
      } else if (descriptor.id === "provide") {
        throw new RuntimeBugError("provide outside resource context");
      } else {
        const inner = compoundData.__tisyn_inner as { exprs: Expr[] };
        const exprs = inner.exprs;
        const startIndex = frame.childSpawnCount;
        frame.childSpawnCount += exprs.length;
        if (descriptor.id === "all") {
          nextValue = yield* orchestrateAll(exprs, effectiveCoroutineId, startIndex, childEnv, ctx);
        } else {
          nextValue = yield* orchestrateRace(
            exprs,
            effectiveCoroutineId,
            startIndex,
            childEnv,
            ctx,
          );
        }
      }
      // Compound effects do NOT advance parent yieldIndex
      continue;
    }

    // ── Standard effect dispatch ──
    // Compute the effect description for this dispatch. `sha` is the
    // deterministic payload fingerprint used by replay divergence detection
    // per scoped-effects §9.5.
    const description = describeEffect(descriptor);

    // Peek the replay cursor for divergence detection. Consumption happens
    // either in the built-in branch (for __config / stream.*) or inside the
    // RuntimeTerminalBoundary below (for dispatch-chain effects, so that
    // middleware re-executes on replay per scoped-effects §9.5).
    const stored = ctx.replayIndex.peekYield(journalLaneId);
    if (
      stored &&
      (stored.description.type !== description.type || stored.description.name !== description.name)
    ) {
      const cursor = ctx.replayIndex.getCursor(journalLaneId);
      throw new DivergenceError(
        `Divergence at ${journalLaneId}[${cursor}]: ` +
          `expected ${stored.description.type}.${stored.description.name}, ` +
          `got ${description.type}.${description.name}`,
      );
    }
    // Payload-sensitive divergence check per scoped-effects §9.5. Legacy
    // journals (no stored.description.sha) skip this check for that entry.
    if (
      stored &&
      stored.description.sha !== undefined &&
      stored.description.sha !== description.sha
    ) {
      const cursor = ctx.replayIndex.getCursor(journalLaneId);
      throw new DivergenceError(
        `Divergence at ${journalLaneId}[${cursor}]: ` +
          `payload fingerprint mismatch for ${description.type}.${description.name} ` +
          `(stored sha=${stored.description.sha}, current sha=${description.sha})`,
      );
    }
    if (!stored && ctx.replayIndex.hasClose(journalLaneId)) {
      throw new DivergenceError(
        `Divergence: journal shows ${journalLaneId} closed, but generator continues to yield effects`,
      );
    }

    // Built-in effects (`__config`, `stream.subscribe`, `stream.next`) are
    // handled in-frame, not via the middleware dispatch chain. Their replay
    // substitution is handled here too, keyed by journalLaneId.
    if (
      descriptor.id === "__config" ||
      descriptor.id === "stream.subscribe" ||
      descriptor.id === "stream.next"
    ) {
      if (stored) {
        // Replay a built-in from the cursor.
        ctx.replayIndex.consumeYield(journalLaneId);
        if (descriptor.id === "stream.subscribe" && stored.result.status === "ok") {
          const handle = stored.result.value as Record<string, unknown> | null;
          if (handle && typeof handle === "object" && "__tisyn_subscription" in handle) {
            ctx.subscriptions.set(handle.__tisyn_subscription as string, {
              subscription: null,
              sourceDefinition: descriptor.data,
            });
            frame.subscriptionCounter++;
          }
        }
        const replayedEvent: YieldEvent = {
          type: "yield",
          coroutineId: journalLaneId,
          description: stored.description,
          result: stored.result,
        };
        ctx.journal.push(replayedEvent);
        if (isCallerCursor) {
          frame.yieldIndex++;
        }
        if (stored.result.status === "ok") {
          nextValue = (stored.result.value ?? null) as Val;
        } else if (stored.result.status === "error") {
          const err = new EffectError(stored.result.error.message, stored.result.error.name);
          const throwResult = kernel.throw(err);
          if (throwResult.done) {
            return throwResult.value;
          }
          pendingStep = throwResult;
          nextValue = null;
          continue;
        } else {
          throw new Error("Cannot replay cancelled result");
        }
        continue;
      }

      // Live built-in handling.
      let effectResult: EventResult;
      try {
        let resultValue: Val;
        if (descriptor.id === "__config") {
          resultValue = (yield* ConfigContext.expect()) as Val;
        } else if (descriptor.id === "stream.subscribe") {
          const token = `sub:${effectiveCoroutineId}:${frame.subscriptionCounter++}`;
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
          const handleCid = token.split(":")[1]!;
          if (
            effectiveCoroutineId !== handleCid &&
            !effectiveCoroutineId.startsWith(handleCid + ".")
          ) {
            throw new SubscriptionCapabilityError(
              `stream.next: handle from '${handleCid}' cannot be used from '${effectiveCoroutineId}'`,
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
        effectResult = { status: "error", error: { message: err.message, name: err.name } };
      }

      const yieldEvent: YieldEvent = {
        type: "yield",
        coroutineId: journalLaneId,
        description,
        result: effectResult,
      };
      yield* ctx.stream.append(yieldEvent);
      ctx.journal.push(yieldEvent);
      if (isCallerCursor) {
        frame.yieldIndex++;
      }

      if (effectResult.status === "ok") {
        nextValue = (effectResult.value ?? null) as Val;
      } else {
        const err = new EffectError(effectResult.error.message, effectResult.error.name);
        const throwResult = kernel.throw(err);
        if (throwResult.done) {
          return throwResult.value;
        }
        pendingStep = throwResult;
        nextValue = null;
        continue;
      }
      continue;
    }

    // ── Dispatch-chain effect ──
    // RV2: reject subscription handles in non-stream effect dispatch data
    if (containsSubscriptionHandle(descriptor.data)) {
      throw new SubscriptionCapabilityError(
        `Effect '${descriptor.id}': resolved data contains a subscription handle, which is a restricted capability value`,
      );
    }

    // Install a per-dispatch RuntimeTerminalBoundary so in-repo terminals
    // (agent handlers, remote transport, mocks, built-in Effects fallback)
    // delegating through `runAsTerminal(...)` either substitute stored
    // results or run their live work. Middleware always re-executes per
    // scoped-effects §9.5. `replayBox.replayed` signals whether the
    // boundary consumed a stored cursor entry, so the outer journal-write
    // block knows not to append a duplicate live YieldEvent.
    const replayBox = { replayed: false };
    const boundary: RuntimeTerminalBoundary = {
      *run<T extends Val = Val>(
        _effectId: string,
        _data: Val,
        liveWork: () => Operation<T>,
      ): Operation<T> {
        if (stored) {
          ctx.replayIndex.consumeYield(journalLaneId);
          const replayedEvent: YieldEvent = {
            type: "yield",
            coroutineId: journalLaneId,
            description: stored.description,
            result: stored.result,
          };
          ctx.journal.push(replayedEvent);
          if (isCallerCursor) {
            frame.yieldIndex++;
          }
          replayBox.replayed = true;
          if (stored.result.status === "error") {
            throw new EffectError(stored.result.error.message, stored.result.error.name);
          }
          if (stored.result.status === "cancelled") {
            throw new Error("Cannot replay cancelled result");
          }
          return (stored.result.value ?? null) as T;
        }
        return yield* liveWork();
      },
    };

    const dispatchCtx = buildDispatchContext({
      coroutineId: effectiveCoroutineId,
      parentEnv: env,
      driveContext: ctx,
      frame,
      isInlineLane: !isCallerCursor,
    });

    let effectResult: EventResult;
    try {
      const resultValue = yield* RuntimeTerminal.with(boundary, () =>
        DispatchContext.with(dispatchCtx, () => dispatch(descriptor.id, descriptor.data as Val)),
      );
      effectResult = { status: "ok", value: resultValue as Json };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      effectResult = { status: "error", error: { message: err.message, name: err.name } };
    }

    // Journal write.
    if (replayBox.replayed) {
      // Boundary already consumed the stored entry and pushed a replayedEvent
      // to ctx.journal. Nothing else to do — the durable stream is unchanged
      // on replay.
    } else if (stored) {
      // Out-of-contract terminal: middleware short-circuited without
      // delegating through `runAsTerminal`, so the boundary never ran — but
      // the cursor does have a matching stored entry. Consume it and push a
      // replayed event to `ctx.journal` so subsequent dispatches see the
      // cursor at the correct position. This keeps the journal coherent for
      // terminals that compute deterministic results internally (e.g.
      // middleware that calls `invoke(...)` directly); out-of-contract
      // terminals performing non-idempotent IO still double-fire per §9.5.
      ctx.replayIndex.consumeYield(journalLaneId);
      const replayedEvent: YieldEvent = {
        type: "yield",
        coroutineId: journalLaneId,
        description: stored.description,
        result: stored.result,
      };
      ctx.journal.push(replayedEvent);
      if (isCallerCursor) {
        frame.yieldIndex++;
      }
      // Substitute stored result in place of middleware's return, per §9.5
      // (stored cursor is authoritative).
      effectResult = stored.result;
    } else {
      // Live dispatch.
      const yieldEvent: YieldEvent = {
        type: "yield",
        coroutineId: journalLaneId,
        description,
        result: effectResult,
      };
      yield* ctx.stream.append(yieldEvent);
      ctx.journal.push(yieldEvent);
      if (isCallerCursor) {
        frame.yieldIndex++;
      }
    }

    if (effectResult.status === "ok") {
      nextValue = (effectResult.value ?? null) as Val;
    } else if (effectResult.status === "error") {
      const err = new EffectError(effectResult.error.message, effectResult.error.name);
      const throwResult = kernel.throw(err);
      if (throwResult.done) {
        return throwResult.value;
      }
      pendingStep = throwResult;
      nextValue = null;
      continue;
    } else {
      throw new Error("Cannot replay cancelled result");
    }
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
        yield* appendCloseEvent(ctx, closeEvent);
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

        // ── Standard effect dispatch ──
        const description = describeEffect(descriptor);
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
          if (
            stored.description.sha !== undefined &&
            stored.description.sha !== description.sha
          ) {
            const cursor = ctx.replayIndex.getCursor(childId);
            throw new DivergenceError(
              `Divergence at ${childId}[${cursor}]: ` +
                `payload fingerprint mismatch for ${description.type}.${description.name} ` +
                `(stored sha=${stored.description.sha}, current sha=${description.sha})`,
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
          } else if (stored.result.status === "error") {
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
            status: "error",
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
        status: "error",
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

        // ── Standard effect dispatch ──
        const description = describeEffect(descriptor);
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
          if (
            stored.description.sha !== undefined &&
            stored.description.sha !== description.sha
          ) {
            const cursor = ctx.replayIndex.getCursor(childId);
            throw new DivergenceError(
              `Divergence at ${childId}[${cursor}]: ` +
                `payload fingerprint mismatch for ${description.type}.${description.name} ` +
                `(stored sha=${stored.description.sha}, current sha=${description.sha})`,
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
          } else if (stored.result.status === "error") {
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
            status: "error",
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
          status: "error",
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
