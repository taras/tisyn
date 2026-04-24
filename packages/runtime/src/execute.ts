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
  /**
   * Subscription-token counters keyed by owner coroutineId. All dispatch
   * sites that share an owner — the owner's own coroutine plus every inline
   * lane whose captured owner is that coroutine — allocate subscription
   * tokens from the same counter entry. Ensures token uniqueness across
   * sibling inline lanes and across the caller/lane boundary, per
   * `tisyn-inline-invocation-specification.md` §12.4. Runtime state only;
   * never journaled.
   */
  subscriptionCounters: Map<string, number>;
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

/**
 * Registration target for a `resource` yielded from inside an
 * `invokeInline` body. Per `tisyn-inline-invocation-specification.md`
 * §11.4 + §11.8, a resource acquired inside an inline body attaches
 * to the caller's scope — but only when the hosting dispatch context
 * is a caller `driveKernel`. When the hosting context is a
 * resource-init or resource-cleanup phase inside
 * `orchestrateResourceChild`, nested resources are unsupported (the
 * ordinary-yield nested-resource path throws
 * `RuntimeBugError("Nested resource is not supported")`); the inline
 * path preserves that rejection via a `"reject"` target so inline
 * invocation cannot silently bypass it.
 */
type InlineResourceTarget =
  | {
      kind: "caller-scope";
      register(child: ResourceChild): void;
    }
  | {
      kind: "reject";
      reason: string;
    };

/**
 * Shared spawn/join state for an `invokeInline` body. Inline bodies
 * do not maintain their own spawn/join tracking per §11.2 "no
 * intermediate scope"; instead they read and write the HOSTING
 * dispatch site's existing maps — `driveKernel`'s own
 * `spawnedTasks` + `joinedTasks`, or `orchestrateResourceChild`'s
 * init/cleanup-phase maps when the hosting dispatch is inside a
 * resource body. The shared map/set gives sibling inline lanes and
 * post-return caller code resolution parity with the hosting
 * kernel's own spawn/join yields (§11.5).
 *
 * Runtime-internal only. No `kind` discriminant: every dispatch
 * site passes a caller-scope registry because `spawn`/`join` are
 * already supported by every current hosting site.
 */
interface InlineTaskRegistry {
  spawnedTasks: Map<string, { operation: Operation<EventResult> }>;
  joinedTasks: Set<string>;
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
  ownerCoroutineId: string;
  parentEnv: Env;
  driveContext: DriveContext;
  allocateChildId: () => string;
  inlineResourceTarget: InlineResourceTarget;
  inlineTaskRegistry: InlineTaskRegistry;
}): DispatchContext {
  const {
    coroutineId,
    ownerCoroutineId,
    parentEnv,
    driveContext,
    allocateChildId,
    inlineResourceTarget,
    inlineTaskRegistry,
  } = args;
  const self: DispatchContext = {
    coroutineId,
    ownerCoroutineId,
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

      // v6 §12.3 capture-and-propagate: inherit owner from the active
      // ctx. For the outermost invokeInline `self.ownerCoroutineId ===
      // self.coroutineId`, so this captures the caller's coroutineId;
      // for nested inline, it propagates the already-captured owner.
      const laneOwner = self.ownerCoroutineId;

      const laneEnv = extendMulti(parentEnv, [...fn.params], invokeArgs as Val[]);
      const laneKernel = evaluate(fn.body as Expr, laneEnv);

      const driveLane = () =>
        driveInlineBody<T>(
          laneKernel,
          laneId,
          laneEnv,
          driveContext,
          laneOwner,
          inlineResourceTarget,
          inlineTaskRegistry,
        );

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
 * scope. Implements the relevant parts of
 * `tisyn-inline-invocation-specification.md` v6:
 *
 * - Standard-effect dispatches (agent effects + `__config` + the
 *   `stream.subscribe` / `stream.next` intrinsics) journal under
 *   `laneId` via the shared `dispatchStandardEffect` helper and
 *   participate in replay on the lane's independent cursor. The
 *   stream intrinsics allocate subscription tokens from the **owner's**
 *   shared counter (§12.4) rather than the lane's own counter, so
 *   sibling inline lanes and the original caller can use each other's
 *   handles without collisions (§12.7).
 * - Lane has its own `childSpawnCount` starting at 0 (v6 §7.3); nested
 *   `invokeInline` / `invoke` from middleware handling the body's
 *   dispatched effects allocate from this per-lane counter.
 * - Lane produces NO `CloseEvent` — ever. Normal completion returns
 *   the kernel's final value directly; uncaught errors propagate
 *   directly to the caller's middleware frame.
 * - `resource` inside an inline body provides in the caller's scope
 *   and cleans up at caller teardown (§11.4 + §11.8). The resource
 *   child is allocated `laneId.{m}` from the lane's own
 *   `inlineChildSpawnCount`, produces its own `CloseEvent` under
 *   that id, and registers with the caller's `resourceChildren`
 *   array via the `InlineResourceTarget` passed from the hosting
 *   dispatch. When the hosting dispatch is a resource-init or
 *   resource-cleanup phase, the target rejects instead — preserving
 *   the ordinary-yield nested-resource rejection.
 * - `spawn` / `join` inside an inline body attach to the hosting
 *   caller's Effection scope and shared task registry (§11.5).
 *   Spawned child id is `laneId.{m}` from the lane's own
 *   `inlineChildSpawnCount`; the child runs via a full
 *   `driveKernel` and produces its own `CloseEvent` under that id.
 *   Handles register in the hosting caller's `spawnedTasks` map so
 *   sibling inline lanes, the original caller's own later code, or
 *   the inline body itself can `join` them; the caller's
 *   `joinedTasks` set is shared so a double-join across the
 *   boundary fails with the existing "already been joined" error.
 * - The remaining four compound externals (`scope`, `timebox`,
 *   `all`, `race`) inside an inline body are still rejected with a
 *   clear error: this runtime phase does NOT run them under
 *   inline-lane semantics yet.
 */
function* driveInlineBody<T = Val>(
  kernel: Generator<EffectDescriptor, Val, Val>,
  laneId: string,
  env: Env,
  ctx: DriveContext,
  ownerCoroutineId: string,
  inlineResourceTarget: InlineResourceTarget,
  inlineTaskRegistry: InlineTaskRegistry,
): Operation<T> {
  // Own childSpawnCount per v6 §7.3. Subscription counter state lives on
  // `ctx.subscriptionCounters[ownerCoroutineId]`, shared with the caller
  // and any sibling/nested inline lanes whose captured owner matches.
  let inlineChildSpawnCount = 0;
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

    // §11.4 + §11.8: `resource` inside an inline body provides in
    // the caller's scope and cleans up at caller teardown — but only
    // when the hosting dispatch context is a caller `driveKernel`.
    // When invokeInline was called from middleware running on a
    // resource-init / resource-cleanup dispatch, the target rejects,
    // preserving the ordinary-yield "Nested resource is not supported"
    // rule. Non-resource compound externals stay rejected uniformly.
    if (isCompoundExternal(descriptor.id)) {
      if (descriptor.id === "resource") {
        if (inlineResourceTarget.kind === "reject") {
          // Do NOT advance the lane's child-spawn counter for a
          // rejected call (matches "rejected calls do not advance
          // allocators"); do NOT start `orchestrateResourceChild`.
          throw new Error(inlineResourceTarget.reason);
        }
        const compoundData = descriptor.data as {
          __tisyn_inner: { body: Expr };
          __tisyn_env: Env;
        };
        const childId = `${laneId}.${inlineChildSpawnCount++}`;
        const childEnv = compoundData.__tisyn_env;
        const childResourceKernel = evaluate(compoundData.__tisyn_inner.body, childEnv);
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
          // §11.4: register with CALLER's resourceChildren array so
          // cleanup runs at caller teardown alongside caller resources.
          inlineResourceTarget.register({
            childId,
            signalTeardown: teardownRes,
            waitCleanup: cleanupOp,
          });
          nextValue = resourceValue;
          continue;
        }
        // Init failed — route through kernel.throw with the three
        // outcomes. Do NOT run teardownResourceChildren (lane has no
        // teardown; the caller's teardown will pick up anything we
        // already registered).
        const throwResult = kernel.throw(resourceErr);
        if (throwResult.done) {
          return (throwResult.value ?? null) as T;
        }
        pendingStep = throwResult;
        nextValue = null;
        continue;
      }
      if (descriptor.id === "spawn") {
        // §11.5: spawn a foreground child at the HOSTING caller's
        // Effection scope and task registry. Lane allocator advances
        // by exactly +1 (matches the `resource` rule above).
        const compoundData = descriptor.data as {
          __tisyn_inner: { body: Expr };
          __tisyn_env: Env;
        };
        const spawnChildId = `${laneId}.${inlineChildSpawnCount++}`;
        const childEnv = compoundData.__tisyn_env;
        const spawnChildKernel = evaluate(compoundData.__tisyn_inner.body, childEnv);
        const {
          operation: joinOp,
          resolve: joinResolve,
          reject: joinReject,
        } = withResolvers<EventResult>();
        // Register in the hosting site's shared spawnedTasks so
        // sibling inline lanes and post-return caller code can
        // resolve this handle.
        inlineTaskRegistry.spawnedTasks.set(spawnChildId, { operation: joinOp });

        yield* spawn(function* () {
          try {
            const childResult = yield* driveKernel(spawnChildKernel, spawnChildId, childEnv, ctx);
            joinResolve(childResult);
            if (childResult.status === "error") {
              const errResult = childResult as {
                status: "error";
                error: { message: string; name?: string };
              };
              throw new EffectError(errResult.error.message, errResult.error.name);
            }
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e));
            joinReject(err);
            throw err; // R12: tear down hosting Effection scope on child failure
          }
        });

        // R4: resume inline body immediately with the task handle.
        nextValue = { __tisyn_task: spawnChildId } as Val;
        continue;
      }

      if (descriptor.id === "join") {
        const compoundData = descriptor.data as { __tisyn_inner: Val };
        const taskHandle = compoundData.__tisyn_inner;

        if (
          taskHandle === null ||
          typeof taskHandle !== "object" ||
          typeof (taskHandle as Record<string, unknown>).__tisyn_task !== "string"
        ) {
          throw new RuntimeBugError("join: inner value is not a valid task handle");
        }

        const joinChildId = (taskHandle as { __tisyn_task: string }).__tisyn_task;

        // R8: double-join — shared set with hosting caller, so a
        // second join attempt from any lane or from caller code
        // against the same handle fails.
        if (inlineTaskRegistry.joinedTasks.has(joinChildId)) {
          throw new RuntimeBugError(`join: task '${joinChildId}' has already been joined`);
        }
        inlineTaskRegistry.joinedTasks.add(joinChildId);

        const entry = inlineTaskRegistry.spawnedTasks.get(joinChildId);
        if (!entry) {
          throw new RuntimeBugError(`join: no spawned task found for '${joinChildId}'`);
        }

        let childResult: EventResult;
        try {
          childResult = yield* entry.operation;
        } catch (e) {
          // Child task threw — route through kernel.throw with the
          // three outcomes (uncaught re-throw / caught-return /
          // caught-yield), same as other errors in driveInlineBody.
          const err = e instanceof EffectError ? e : new EffectError(String(e));
          const throwResult = kernel.throw(err);
          if (throwResult.done) {
            return (throwResult.value ?? null) as T;
          }
          pendingStep = throwResult;
          nextValue = null;
          continue;
        }

        if (childResult.status === "ok") {
          nextValue = (childResult.value ?? null) as Val;
          continue;
        }
        if (childResult.status === "cancelled") {
          throw new InvocationCancelledError();
        }
        const err = new EffectError(childResult.error.message, childResult.error.name);
        const throwResult = kernel.throw(err);
        if (throwResult.done) {
          return (throwResult.value ?? null) as T;
        }
        pendingStep = throwResult;
        nextValue = null;
        continue;
      }

      // `scope`, `timebox`, `all`, `race` — still deferred. Reject
      // uniformly with a clear error naming the id. (`provide` is
      // only legal inside a resource init body; a bare `provide`
      // yield here is caller IR misuse rather than an unsupported
      // inline compound, so it also hits this branch.)
      throw new Error(
        `invokeInline body dispatched compound external '${descriptor.id}'; ` +
          `compound primitives 'scope', 'timebox', 'all', 'race' ` +
          `inside inline bodies are deferred ` +
          `(see tisyn-inline-invocation-specification.md §11)`,
      );
    }

    // Agent effects, `__config`, and stream intrinsics all go through the
    // shared helper. The lane's journal coroutineId is `laneId`; the
    // owner coroutineId captured at the outermost `invokeInline` (and
    // inherited unchanged through nested inline) drives subscription-
    // token allocation and `stream.next` ancestry — v6 §12.3–§12.7.
    const { result } = yield* dispatchStandardEffect({
      descriptor,
      coroutineId: laneId,
      ownerCoroutineId,
      env,
      ctx,
      allocateChildId: () => `${laneId}.${inlineChildSpawnCount++}`,
      // Thread the caller's target unchanged — nested `invokeInline`
      // invoked from middleware on a lane-dispatch inherits the
      // outermost caller's registration destination, so sibling lanes
      // and nested lanes all register with the same caller's array.
      inlineResourceTarget,
      // Same inheritance for the task registry: sibling and nested
      // inline lanes share the hosting caller's spawn/join maps so
      // task handles are resolvable across lanes (§11.5).
      inlineTaskRegistry,
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
      subscriptionCounters: new Map(),
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
        // Ordinary driveKernel dispatch: owner == coroutineId (§12.8
        // says `invoke` children get their own coroutineId as owner,
        // which is exactly what this driveKernel call represents — its
        // coroutineId was allocated by a parent and is this kernel's own
        // identity).
        const { result: effectResult } = yield* dispatchStandardEffect({
          descriptor,
          coroutineId,
          ownerCoroutineId: coroutineId,
          env,
          ctx,
          allocateChildId: () => `${coroutineId}.${childSpawnCount++}`,
          // §11.4: caller `driveKernel` hosts the dispatch — inline
          // bodies invoked from middleware here attach resources to
          // THIS kernel's `resourceChildren`.
          inlineResourceTarget: {
            kind: "caller-scope",
            register: (child) => {
              resourceChildren.push(child);
            },
          },
          // §11.5: inline-body spawn/join shares this kernel's own
          // task registry so handles acquired inside an inline body
          // are resolvable across sibling inline lanes and
          // post-return caller code.
          inlineTaskRegistry: { spawnedTasks, joinedTasks },
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
        // Resource child is an ordinary coroutine with owner == childId.
        const { result: effectResult } = yield* dispatchStandardEffect({
          descriptor,
          coroutineId: childId,
          ownerCoroutineId: childId,
          env: childEnv,
          ctx,
          allocateChildId: () => `${childId}.${childSpawnCount++}`,
          // Nested resources inside a resource body are unsupported
          // (cf. the ordinary-yield rejection in the compound
          // interception block of this same phase). Inline invocation
          // MUST NOT silently bypass that rule.
          inlineResourceTarget: {
            kind: "reject",
            reason:
              "invokeInline body dispatched 'resource' from inside a resource " +
              "init dispatch context; nested resources inside a resource body " +
              "are not supported " +
              "(see tisyn-inline-invocation-specification.md §11.4)",
          },
          // §11.5: inline-body spawn/join from middleware running on
          // a resource-init dispatch attaches to the init phase's
          // shared task registry — matching where ordinary-yield
          // `spawn` inside the resource init body already lands.
          inlineTaskRegistry: { spawnedTasks, joinedTasks },
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
        // Resource child cleanup body runs under the same coroutineId +
        // owner as the init body: both are ordinary dispatches from the
        // resource child's perspective.
        const { result: effectResult } = yield* dispatchStandardEffect({
          descriptor,
          coroutineId: childId,
          ownerCoroutineId: childId,
          env: childEnv,
          ctx,
          allocateChildId: () => `${childId}.${childSpawnCount++}`,
          // Nested resources inside a resource body are unsupported —
          // same rule as the init-phase target. Preserves the existing
          // rejection against inline invocation silently bypassing it.
          inlineResourceTarget: {
            kind: "reject",
            reason:
              "invokeInline body dispatched 'resource' from inside a resource " +
              "cleanup dispatch context; nested resources inside a resource body " +
              "are not supported " +
              "(see tisyn-inline-invocation-specification.md §11.4)",
          },
          // §11.5: inline-body spawn/join from middleware running on
          // a resource-cleanup dispatch attaches to the cleanup
          // phase's shared task registry — matching where
          // ordinary-yield `spawn` inside the cleanup body itself
          // already lands.
          inlineTaskRegistry: { spawnedTasks, joinedTasks },
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
  /**
   * Runtime-only owner identity for this dispatch. Used for
   * subscription-token counter allocation (§12.4) and `stream.next`
   * ancestry checks (§12.7). Equals `coroutineId` for ordinary
   * dispatch; equals the original caller's coroutineId for inline
   * lanes (`tisyn-inline-invocation-specification.md` §12.3).
   */
  ownerCoroutineId: string;
  env: Env;
  ctx: DriveContext;
  allocateChildId: () => string;
  /**
   * Where to register a resource acquired inside an `invokeInline`
   * body. `"caller-scope"` pushes into the hosting caller's
   * `resourceChildren`; `"reject"` throws — preserving the existing
   * nested-resource rejection when the host is a resource-init or
   * resource-cleanup dispatch (`tisyn-inline-invocation-specification.md`
   * §11.4 + §11.8). Unused by ordinary (non-inline) dispatch paths.
   */
  inlineResourceTarget: InlineResourceTarget;
  /**
   * Shared `spawn` / `join` tracking for `invokeInline` bodies:
   * pair of maps from the hosting dispatch site's own
   * `driveKernel`-like scope. Inline-body spawn/join reads and
   * writes these maps directly so sibling inline lanes and
   * post-return caller code can resolve task handles registered
   * inside an inline body, and double-join is detected across the
   * shared boundary (§11.5). Unused by ordinary (non-inline)
   * dispatch paths.
   */
  inlineTaskRegistry: InlineTaskRegistry;
}

/**
 * Allocate the next subscription token for `owner` and advance the
 * owner's shared counter in `ctx.subscriptionCounters`. Token format
 * is `sub:<owner>:<n>` — same structure as pre-Phase-5C, but under
 * inline-lane dispatches `<owner>` is the inherited owner coroutineId
 * rather than the journal coroutineId.
 */
function allocateSubscriptionToken(ctx: DriveContext, owner: string): string {
  const n = ctx.subscriptionCounters.get(owner) ?? 0;
  ctx.subscriptionCounters.set(owner, n + 1);
  return `sub:${owner}:${n}`;
}

/**
 * Advance the owner's subscription counter without emitting a token —
 * used on replay of `stream.subscribe` so the live frontier can't
 * reuse an already-consumed token.
 */
function advanceSubscriptionCounter(ctx: DriveContext, owner: string): void {
  const n = ctx.subscriptionCounters.get(owner) ?? 0;
  ctx.subscriptionCounters.set(owner, n + 1);
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
    ownerCoroutineId,
    env,
    ctx,
    allocateChildId,
    inlineResourceTarget,
    inlineTaskRegistry,
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
      // handle AND advance the owner's shared counter (§12.4) so the live
      // frontier does not reuse a token.
      if (descriptor.id === "stream.subscribe" && stored.result.status === "ok") {
        const handle = stored.result.value as Record<string, unknown> | null;
        if (handle && typeof handle === "object" && "__tisyn_subscription" in handle) {
          ctx.subscriptions.set(handle.__tisyn_subscription as string, {
            subscription: null,
            sourceDefinition: descriptor.data,
          });
          advanceSubscriptionCounter(ctx, ownerCoroutineId);
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
        const token = allocateSubscriptionToken(ctx, ownerCoroutineId);
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
        // Ancestry check (§12.7). Compare the token's embedded owner
        // against the current dispatch's owner, not the journal
        // coroutineId. This lets sibling inline lanes (shared owner)
        // use each other's handles and the caller reuse handles
        // acquired inside inline bodies, while keeping `invoke`
        // children's handles (own owner) scoped to the child subtree.
        const handleOwner = token.split(":")[1]!;
        if (ownerCoroutineId !== handleOwner && !ownerCoroutineId.startsWith(handleOwner + ".")) {
          throw new SubscriptionCapabilityError(
            `stream.next: handle from '${handleOwner}' cannot be used from '${ownerCoroutineId}'`,
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
    ownerCoroutineId,
    parentEnv: env,
    driveContext: ctx,
    allocateChildId,
    inlineResourceTarget,
    inlineTaskRegistry,
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
