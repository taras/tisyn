/**
 * Conformance fixtures extracted from the Conformance Suite Spec §12.
 *
 * All fixtures are Core unless marked otherwise.
 * Each is a complete, machine-readable object matching the fixture schemas.
 */

import type { Fixture } from "./harness.js";

/** KERN-001: Integer literal evaluates to itself */
export const KERN_001: Fixture = {
  id: "KERN-001",
  suite_version: "2.0.0",
  tier: "core",
  level: 3,
  category: "kernel.evaluation.literal",
  spec_ref: "kernel.1.4",
  type: "evaluation",
  description: "Integer literal evaluates to itself",
  ir: 42,
  env: {},
  expected_result: { status: "ok", value: 42 },
  expected_journal: [
    {
      coroutineId: "root",
      result: { status: "ok", value: 42 },
      type: "close",
    },
  ],
};

/** KERN-020: Let binds value and makes it available in body */
export const KERN_020: Fixture = {
  id: "KERN-020",
  suite_version: "2.0.0",
  tier: "core",
  level: 3,
  category: "kernel.evaluation.let",
  spec_ref: "kernel.5.1",
  type: "evaluation",
  description: "Let binds value and makes it available in body",
  ir: {
    tisyn: "eval",
    id: "let",
    data: {
      tisyn: "quote",
      expr: {
        body: { tisyn: "ref", name: "x" },
        name: "x",
        value: 1,
      },
    },
  },
  env: {},
  expected_result: { status: "ok", value: 1 },
  expected_journal: [
    {
      coroutineId: "root",
      result: { status: "ok", value: 1 },
      type: "close",
    },
  ],
};

/** KERN-034: Free variable resolves at call site, not definition site */
export const KERN_034: Fixture = {
  id: "KERN-034",
  suite_version: "2.0.0",
  tier: "core",
  level: 3,
  category: "kernel.evaluation.call",
  spec_ref: "kernel.5.5",
  type: "evaluation",
  description: "Free variable resolves at call site, not definition site",
  ir: {
    tisyn: "eval",
    id: "let",
    data: {
      tisyn: "quote",
      expr: {
        body: {
          tisyn: "eval",
          id: "let",
          data: {
            tisyn: "quote",
            expr: {
              body: {
                tisyn: "eval",
                id: "let",
                data: {
                  tisyn: "quote",
                  expr: {
                    body: {
                      tisyn: "eval",
                      id: "call",
                      data: {
                        tisyn: "quote",
                        expr: {
                          args: [],
                          fn: { tisyn: "ref", name: "f" },
                        },
                      },
                    },
                    name: "x",
                    value: 2,
                  },
                },
              },
              name: "f",
              value: {
                tisyn: "fn",
                params: [],
                body: { tisyn: "ref", name: "x" },
              },
            },
          },
        },
        name: "x",
        value: 1,
      },
    },
  },
  env: {},
  expected_result: { status: "ok", value: 2 },
  expected_journal: [
    {
      coroutineId: "root",
      result: { status: "ok", value: 2 },
      type: "close",
    },
  ],
};

/** KERN-080: Two effects in let chain, second uses first result */
export const KERN_080: Fixture = {
  id: "KERN-080",
  suite_version: "2.0.0",
  tier: "core",
  level: 3,
  category: "kernel.effects.sequential",
  spec_ref: "kernel.4.3",
  type: "effect",
  description: "Two effects in let chain, second uses first result",
  ir: {
    tisyn: "eval",
    id: "let",
    data: {
      tisyn: "quote",
      expr: {
        body: {
          tisyn: "eval",
          id: "let",
          data: {
            tisyn: "quote",
            expr: {
              body: { tisyn: "ref", name: "b" },
              name: "b",
              value: {
                tisyn: "eval",
                id: "x.step2",
                data: [{ tisyn: "ref", name: "a" }],
              },
            },
          },
        },
        name: "a",
        value: { tisyn: "eval", id: "x.step1", data: [] },
      },
    },
  },
  env: {},
  effects: [
    {
      descriptor: { id: "x.step1", data: [] },
      result: { status: "ok", value: 10 },
    },
    {
      descriptor: { id: "x.step2", data: [10] },
      result: { status: "ok", value: 20 },
    },
  ],
  expected_result: { status: "ok", value: 20 },
  expected_journal: [
    {
      coroutineId: "root",
      description: { name: "step1", type: "x" },
      result: { status: "ok", value: 10 },
      type: "yield",
    },
    {
      coroutineId: "root",
      description: { name: "step2", type: "x" },
      result: { status: "ok", value: 20 },
      type: "yield",
    },
    {
      coroutineId: "root",
      result: { status: "ok", value: 20 },
      type: "close",
    },
  ],
};

/** KERN-071: Value resembling Ref in env not resolved further */
export const KERN_071: Fixture = {
  id: "KERN-071",
  suite_version: "2.0.0",
  tier: "core",
  level: 3,
  category: "kernel.resolve.opaque",
  spec_ref: "kernel.3.2",
  type: "effect",
  description: "Value resembling Ref in env not resolved further",
  ir: {
    tisyn: "eval",
    id: "x.check",
    data: [{ tisyn: "ref", name: "v" }],
  },
  env: { v: { tisyn: "ref", name: "y" } as never },
  effects: [
    {
      descriptor: {
        id: "x.check",
        data: [{ tisyn: "ref", name: "y" }],
      },
      result: { status: "ok", value: true },
    },
  ],
  expected_result: { status: "ok", value: true },
  expected_journal: [
    {
      coroutineId: "root",
      description: { name: "check", type: "x" },
      result: { status: "ok", value: true },
      type: "yield",
    },
    {
      coroutineId: "root",
      result: { status: "ok", value: true },
      type: "close",
    },
  ],
};

/** REPLAY-010: First two effects replayed, third dispatched live */
export const REPLAY_010: Fixture = {
  id: "REPLAY-010",
  suite_version: "2.0.0",
  tier: "core",
  level: 3,
  category: "kernel.replay.partial",
  spec_ref: "kernel.10.2",
  type: "replay",
  description: "First two effects replayed, third dispatched live",
  ir: {
    tisyn: "eval",
    id: "let",
    data: {
      tisyn: "quote",
      expr: {
        body: {
          tisyn: "eval",
          id: "let",
          data: {
            tisyn: "quote",
            expr: {
              body: {
                tisyn: "eval",
                id: "let",
                data: {
                  tisyn: "quote",
                  expr: {
                    body: { tisyn: "ref", name: "c" },
                    name: "c",
                    value: {
                      tisyn: "eval",
                      id: "x.step3",
                      data: [{ tisyn: "ref", name: "b" }],
                    },
                  },
                },
              },
              name: "b",
              value: {
                tisyn: "eval",
                id: "x.step2",
                data: [{ tisyn: "ref", name: "a" }],
              },
            },
          },
        },
        name: "a",
        value: { tisyn: "eval", id: "x.step1", data: [] },
      },
    },
  },
  env: {},
  stored_journal: [
    {
      coroutineId: "root",
      description: { name: "step1", type: "x" },
      result: { status: "ok", value: 10 },
      type: "yield" as const,
    },
    {
      coroutineId: "root",
      description: { name: "step2", type: "x" },
      result: { status: "ok", value: 20 },
      type: "yield" as const,
    },
  ],
  live_effects: [
    {
      descriptor: { id: "x.step3", data: [20] },
      result: { status: "ok", value: 30 },
    },
  ],
  expected_result: { status: "ok", value: 30 },
  expected_journal: [
    {
      coroutineId: "root",
      description: { name: "step1", type: "x" },
      result: { status: "ok", value: 10 },
      type: "yield",
    },
    {
      coroutineId: "root",
      description: { name: "step2", type: "x" },
      result: { status: "ok", value: 20 },
      type: "yield",
    },
    {
      coroutineId: "root",
      description: { name: "step3", type: "x" },
      result: { status: "ok", value: 30 },
      type: "yield",
    },
    {
      coroutineId: "root",
      result: { status: "ok", value: 30 },
      type: "close",
    },
  ],
};

/** REPLAY-020: Different effect type than stored produces DivergenceError */
export const REPLAY_020: Fixture = {
  id: "REPLAY-020",
  suite_version: "2.0.0",
  tier: "core",
  level: 3,
  category: "kernel.replay.divergence",
  spec_ref: "kernel.10.4",
  type: "replay",
  description: "Different effect type than stored produces DivergenceError",
  ir: { tisyn: "eval", id: "b.op2", data: [] },
  env: {},
  stored_journal: [
    {
      coroutineId: "root",
      description: { name: "op1", type: "a" },
      result: { status: "ok", value: 1 },
      type: "yield" as const,
    },
  ],
  live_effects: [],
  expected_result: {
    status: "err",
    error: { message: "<any>", name: "DivergenceError" },
  },
  expected_journal: [
    {
      coroutineId: "root",
      result: {
        status: "err",
        error: { message: "<any>", name: "DivergenceError" },
      },
      type: "close",
    },
  ],
};

/** NEG-020: Eval node with numeric id is malformed */
export const NEG_020: Fixture = {
  id: "NEG-020",
  suite_version: "2.0.0",
  tier: "core",
  level: 1,
  category: "ir.validation.malformed",
  spec_ref: "kernel.12.1",
  type: "negative_validation",
  description: "Eval node with numeric id is malformed",
  ir: { tisyn: "eval", id: 42, data: 1 },
  expected_error: "MalformedIR",
};

/** NEG-001: Ref to unbound name produces UnboundVariable */
export const NEG_001: Fixture = {
  id: "NEG-001",
  suite_version: "2.0.0",
  tier: "core",
  level: 3,
  category: "kernel.negative.unbound",
  spec_ref: "kernel.2.4",
  type: "negative_runtime",
  description: "Ref to unbound name produces UnboundVariable",
  ir: { tisyn: "ref", name: "unbound" },
  env: {},
  effects: [],
  expected_error: "UnboundVariable",
  expected_journal: [
    {
      coroutineId: "root",
      result: {
        status: "err",
        error: { message: "<any>", name: "UnboundVariable" },
      },
      type: "close",
    },
  ],
};

/** DET-005: 0.1 + 0.2 serialized as 0.30000000000000004 */
export const DET_005: Fixture = {
  id: "DET-005",
  suite_version: "2.0.0",
  tier: "core",
  level: 3,
  category: "kernel.determinism.numbers",
  spec_ref: "kernel.11.5",
  type: "evaluation",
  description: "0.1 + 0.2 serialized as 0.30000000000000004",
  ir: {
    tisyn: "eval",
    id: "add",
    data: {
      tisyn: "quote",
      expr: { a: 0.1, b: 0.2 },
    },
  },
  env: {},
  expected_result: { status: "ok", value: 0.30000000000000004 },
  expected_journal: [
    {
      coroutineId: "root",
      result: { status: "ok", value: 0.30000000000000004 },
      type: "close",
    },
  ],
};

/** KERN-014: And with falsy left does not dispatch right-side effect */
export const KERN_014: Fixture = {
  id: "KERN-014",
  suite_version: "2.0.0",
  tier: "core",
  level: 3,
  category: "kernel.evaluation.shortcircuit",
  spec_ref: "kernel.5.10",
  type: "evaluation",
  description: "And with falsy left does not dispatch right-side effect",
  ir: {
    tisyn: "eval",
    id: "and",
    data: {
      tisyn: "quote",
      expr: {
        a: false,
        b: { tisyn: "eval", id: "a.op", data: [] },
      },
    },
  },
  env: {},
  expected_result: { status: "ok", value: false },
  expected_journal: [
    {
      coroutineId: "root",
      result: { status: "ok", value: false },
      type: "close",
    },
  ],
};

/** All conformance fixtures. */
export const ALL_FIXTURES: Fixture[] = [
  KERN_001,
  KERN_020,
  KERN_034,
  KERN_080,
  KERN_071,
  REPLAY_010,
  REPLAY_020,
  NEG_020,
  NEG_001,
  DET_005,
  KERN_014,
];
