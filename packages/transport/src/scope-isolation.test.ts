/**
 * Scope isolation tests for inprocessTransport.
 *
 * Verifies that the agent-side server runs in an isolated scope that does not
 * inherit host Effects middleware or routing-based agent bindings.
 *
 * SL-1: Host Effects.around() middleware does NOT bleed into child server
 * SL-2: Cross-boundary middleware propagated via protocol DOES affect child
 * SL-3: Host agent bindings (installed by useTransport) not visible in child server
 * SL-4: Host Effects.around({ at: "min" }) does NOT bleed into child server
 */

import { describe, it } from "@effectionx/vitest";
import { expect } from "vitest";
import { scoped } from "effection";
import type { Val } from "@tisyn/ir";
import { Fn, Throw } from "@tisyn/ir";
import {
  agent,
  operation,
  invoke,
  Effects,
  installCrossBoundaryMiddleware,
  dispatch,
  useAgent,
} from "@tisyn/agent";
import { installRemoteAgent } from "./install-remote.js";
import { inprocessTransport } from "./transports/inprocess.js";
import { useTransport } from "./index.js";

// Sentinel effect ID used by child handlers to probe for host middleware leakage.
// Host interceptor only fires on this ID — all others pass through to next.
const PROBE_ID = "sl.probe";

// IR middleware that unconditionally denies any dispatch (throws "denied")
const alwaysDeny = Fn(["effectId", "data"], Throw("denied"));

describe("inprocessTransport scope isolation", () => {
  // SL-1: host Effects.around() does NOT bleed into isolated child scope
  it("host Effects.around() does not leak into child server without protocol middleware", function* () {
    const calc = agent("calc-sl1", {
      add: operation<{ a: number; b: number }, number>(),
    });

    // Child handler internally dispatches to PROBE_ID.
    // If host middleware leaked, it would throw "host-leaked".
    // In an isolated scope, "no agent registered" is thrown instead — swallowed, returns a+b.
    const factory = inprocessTransport(calc, {
      *add({ a, b }: { a: number; b: number }) {
        try {
          yield* dispatch(PROBE_ID, null as Val);
        } catch (e) {
          const msg = (e as Error).message ?? "";
          if (msg === "host-leaked") {
            throw e;
          } // host middleware leaked — test should fail
          // "No agent registered..." → expected in isolated scope, continue
        }
        return a + b;
      },
    });

    yield* scoped(function* () {
      // Install host-side interceptor that only fires for PROBE_ID
      yield* Effects.around({
        *dispatch([effectId, data]: [string, Val], next) {
          if (effectId === PROBE_ID) {
            throw new Error("host-leaked");
          }
          return yield* next(effectId, data);
        },
      });

      yield* installRemoteAgent(calc, factory);

      const result = yield* invoke(calc.add({ a: 1, b: 2 }));
      expect(result).toBe(3);
    });
  });

  // SL-2: cross-boundary middleware propagated via protocol DOES affect child
  it("cross-boundary protocol middleware still reaches child after isolation fix", function* () {
    const calc = agent("calc-sl2", {
      add: operation<{ a: number; b: number }, number>(),
    });

    // Same handler as SL-1: internally dispatches PROBE_ID so enforcement can fire on it.
    const factory = inprocessTransport(calc, {
      *add({ a, b }: { a: number; b: number }) {
        // alwaysDeny enforcement fires on this dispatch and throws "denied"
        yield* dispatch(PROBE_ID, null as Val);
        return a + b;
      },
    });

    yield* scoped(function* () {
      // Host interceptor (same as SL-1) — should NOT be what throws; enforcement should fire first
      yield* Effects.around({
        *dispatch([effectId, data]: [string, Val], next) {
          if (effectId === PROBE_ID) {
            throw new Error("host-leaked");
          }
          return yield* next(effectId, data);
        },
      });

      yield* installRemoteAgent(calc, factory);
      yield* installCrossBoundaryMiddleware(alwaysDeny);

      try {
        yield* invoke(calc.add({ a: 1, b: 2 }));
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        // Must be "denied" from protocol enforcement, not "host-leaked" from host middleware
        expect((error as Error).message).toContain("denied");
      }
    });
  });

  // SL-3: host agent bindings (routing middleware set by useTransport) not visible in isolated child scope
  it("host agent bindings do not leak into child server", function* () {
    const inner = agent("calc-sl3-inner", {
      add: operation<{ a: number; b: number }, number>(),
    });

    const helper = agent("helper-sl3", {
      run: operation<{ a: number; b: number }, number>(),
    });

    // inner is the agent that will be bound in the HOST scope
    const innerFactory = inprocessTransport(inner, {
      *add({ a, b }: { a: number; b: number }) {
        return a + b;
      },
    });

    // helper handler tries to useAgent(inner) — should fail inside the isolated scope
    const helperFactory = inprocessTransport(helper, {
      *run({ a, b }: { a: number; b: number }) {
        // useAgent queries Effects.resolve(); in isolated scope no bindings exist → throws
        const handle = yield* useAgent(inner);
        return yield* handle.add({ a, b });
      },
    });

    yield* scoped(function* () {
      // Bind inner in HOST scope — installs routing middleware for "calc-sl3-inner"
      yield* useTransport(inner, innerFactory);

      // Helper runs in its own isolated scope — must NOT see host's agent bindings
      yield* installRemoteAgent(helper, helperFactory);

      try {
        yield* invoke(helper.run({ a: 1, b: 2 }));
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("not bound in the current scope");
      }
    });
  });

  // SL-4: host Effects.around({ at: "min" }) does NOT bleed into isolated child scope
  it("host Effects.around({ at: 'min' }) does not leak into child server", function* () {
    const calc = agent("calc-sl4", {
      add: operation<{ a: number; b: number }, number>(),
    });

    // Same child handler as SL-1: dispatches PROBE_ID to detect host middleware leakage.
    const factory = inprocessTransport(calc, {
      *add({ a, b }: { a: number; b: number }) {
        try {
          yield* dispatch(PROBE_ID, null as Val);
        } catch (e) {
          const msg = (e as Error).message ?? "";
          if (msg === "host-leaked") {
            throw e;
          }
          // "No agent registered..." → expected in isolated scope, continue
        }
        return a + b;
      },
    });

    yield* scoped(function* () {
      // Install host-side interceptor at min priority
      yield* Effects.around(
        {
          *dispatch([effectId, _data]: [string, Val]) {
            if (effectId === PROBE_ID) {
              throw new Error("host-leaked");
            }
            return "host-min" as Val;
          },
        },
        { at: "min" },
      );

      yield* installRemoteAgent(calc, factory);

      const result = yield* invoke(calc.add({ a: 1, b: 2 }));
      expect(result).toBe(3);
    });
  });
});
