/**
 * Tisyn execution loop — bridges kernel, journal, and agents.
 *
 * Drives the kernel generator, handles replay/live dispatch,
 * journals Yield/Close events, and enforces persist-before-resume.
 *
 * See Architecture §3.1 and Conformance Suite §3.
 */

import type { Operation } from "effection";
import {
  type Expr,
  type Val,
  type Json,
  type DurableEvent,
  type YieldEvent,
  type CloseEvent,
  type EffectDescriptor,
  type EventResult,
  parseEffectId,
  DivergenceError,
  EffectError,
} from "@tisyn/shared";
import { evaluate, validate, type Env, envFromRecord } from "@tisyn/kernel";
import {
  type DurableStream,
  InMemoryStream,
  ReplayIndex,
} from "@tisyn/durable-streams";
import { AgentRegistry } from "@tisyn/agent";

export interface ExecuteOptions {
  /** The IR tree to evaluate. */
  ir: Expr;
  /** Initial environment bindings. */
  env?: Record<string, Val>;
  /** The durable stream for journaling. */
  stream?: DurableStream;
  /** Agent registry for live dispatch. */
  agents?: AgentRegistry;
  /** Coroutine ID for the root task. Defaults to "root". */
  coroutineId?: string;
}

export interface ExecuteResult {
  result: EventResult;
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
  const {
    ir,
    env: envRecord = {},
    stream = new InMemoryStream(),
    agents = new AgentRegistry(),
    coroutineId = "root",
  } = options;

  // Phase 1: Validate IR before evaluation
  try {
    validate(ir);
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

  // Phase 3: Create kernel generator
  const kernel = evaluate(ir, env);

  // Phase 4: Drive the kernel
  let yieldIndex = 0;
  let nextValue: Val = null; // First .next() call gets undefined/null

  try {
    for (;;) {
      const step = kernel.next(nextValue);

      if (step.done) {
        // Kernel returned a value — evaluation complete
        const closeEvent: CloseEvent = {
          type: "close",
          coroutineId,
          result: { status: "ok", value: step.value as Json },
        };
        yield* stream.append(closeEvent);
        journal.push(closeEvent);

        return {
          result: { status: "ok", value: step.value as Json },
          journal,
        };
      }

      // Kernel yielded an effect descriptor — need to resolve it
      const descriptor = step.value as EffectDescriptor;
      const description = parseEffectId(descriptor.id);

      // Check replay index first
      const stored = replayIndex.peekYield(coroutineId);

      if (stored) {
        // CASE 1: Replay entry exists — check description match
        if (
          stored.description.type !== description.type ||
          stored.description.name !== description.name
        ) {
          // D1: Description mismatch — divergence
          const cursor = replayIndex.getCursor(coroutineId);
          throw new DivergenceError(
            `Divergence at ${coroutineId}[${cursor}]: ` +
              `expected ${stored.description.type}.${stored.description.name}, ` +
              `got ${description.type}.${description.name}`,
          );
        }

        // Match — consume entry, feed stored result
        // DO NOT re-append to stream — the event is already there.
        // Track the replayed event in the journal for the return value.
        replayIndex.consumeYield(coroutineId);

        const replayedEvent: YieldEvent = {
          type: "yield",
          coroutineId,
          description: stored.description,
          result: stored.result,
        };
        journal.push(replayedEvent);

        // Feed stored result to kernel
        if (stored.result.status === "ok") {
          nextValue = (stored.result.value ?? null) as Val;
        } else if (stored.result.status === "err") {
          // Re-raise stored error
          const err = new EffectError(
            stored.result.error.message,
            stored.result.error.name,
          );
          const throwResult = kernel.throw(err);
          if (throwResult.done) {
            const closeEvent: CloseEvent = {
              type: "close",
              coroutineId,
              result: { status: "ok", value: throwResult.value as Json },
            };
            yield* stream.append(closeEvent);
            journal.push(closeEvent);
            return {
              result: { status: "ok", value: throwResult.value as Json },
              journal,
            };
          }
          // Generator caught the error and continued — continue loop
          nextValue = null; // reset
          continue;
        } else {
          throw new Error("Cannot replay cancelled result");
        }

        yieldIndex++;
        continue;
      }

      // Check for D2: continue past close
      if (replayIndex.hasClose(coroutineId)) {
        throw new DivergenceError(
          `Divergence: journal shows ${coroutineId} closed, but generator continues to yield effects`,
        );
      }

      // CASE 3: No replay entry, no close — LIVE dispatch
      let effectResult: EventResult;
      try {
        const resultValue = yield* agents.dispatch(
          descriptor.id,
          descriptor.data as Val,
        );
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
      yield* stream.append(yieldEvent);
      journal.push(yieldEvent);

      // Resume kernel with result
      if (effectResult.status === "ok") {
        nextValue = (effectResult.value ?? null) as Val;
      } else {
        const err = new EffectError(
          effectResult.error.message,
          effectResult.error.name,
        );
        const throwResult = kernel.throw(err);
        if (throwResult.done) {
          const closeEvent: CloseEvent = {
            type: "close",
            coroutineId,
            result: { status: "ok", value: throwResult.value as Json },
          };
          yield* stream.append(closeEvent);
          journal.push(closeEvent);
          return {
            result: { status: "ok", value: throwResult.value as Json },
            journal,
          };
        }
        nextValue = null;
        continue;
      }

      yieldIndex++;
    }
  } catch (error) {
    // Kernel threw — write Close(err)
    const err = error instanceof Error ? error : new Error(String(error));
    const closeEvent: CloseEvent = {
      type: "close",
      coroutineId,
      result: {
        status: "err",
        error: { message: err.message, name: err.name },
      },
    };
    yield* stream.append(closeEvent);
    journal.push(closeEvent);

    return {
      result: {
        status: "err",
        error: { message: err.message, name: err.name },
      },
      journal,
    };
  }
}
