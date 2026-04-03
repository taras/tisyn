# Tisyn

**Tisyn** (pronounced like the chicken) is a runtime for AI agent workflows where execution is deterministic, journaled, and replayable by construction.

Workflows are defined in a structured DSL, compiled to a serializable intermediate representation, validated before execution, and run against an append-only event journal. The kernel guarantees crash recovery via exact replay. Agents operate within scoped, supervised execution boundaries with explicit contracts. The system separates non-deterministic planning from constrained execution: the plan is a program, not a prompt.

## What Tisyn is for

Tisyn is for systems where work needs to cross boundaries without becoming ambiguous.

Typical examples include:

- handing work from a host to a remote agent
- delegating a single task or a subtree of tasks
- streaming progress back while work is running
- resuming after interruption without losing the execution story
- keeping concurrent work bounded so unnecessary background activity does not leak resources

The key idea is that Tisyn makes the work itself explicit. Instead of depending on opaque in-memory runtime state, Tisyn represents execution as serializable structure that can be validated, transported, interpreted, and resumed.

## Core properties

### Explicit work

Tisyn programs are data. They can be inspected, validated, transported, stored, and replayed.

### Predictable boundaries

Agents exchange explicit work and explicit results rather than hidden runtime state.

### Bounded concurrency

Concurrent work is structured, so child work stays tied to its parent and does not continue indefinitely after its purpose is gone.

### Durable continuation

Execution can resume from journaled results after interruption without requiring the interpreter’s in-memory state to be serialized.

## Package relationships

Tisyn is easiest to understand as layers:

1. Program model and validation
   - [`@tisyn/ir`](./packages/ir/README.md): the Tisyn expression/value model
   - [`@tisyn/validate`](./packages/validate/README.md): boundary validation for untrusted or external IR

2. Semantics
   - [`@tisyn/kernel`](./packages/kernel/README.md): evaluation, environments, core errors, and durable event shapes

3. Execution and continuation
   - [`@tisyn/durable-streams`](./packages/durable-streams/README.md): append-only replay/journal primitives
   - [`@tisyn/runtime`](./packages/runtime/README.md): execution of IR, including durable and remote flows

4. Agents and remoting
   - [`@tisyn/agent`](./packages/agent/README.md): typed agent declarations, implementations, dispatch, and invocation helpers
   - [`@tisyn/protocol`](./packages/protocol/README.md): wire-level host/agent messages
   - [`@tisyn/transport`](./packages/transport/README.md): sessions and concrete transports

5. Tooling and verification
   - [`@tisyn/compiler`](./packages/compiler/README.md): compile restricted generator-shaped TypeScript into Tisyn IR
   - [`@tisyn/dsl`](./packages/dsl/README.md): parse Tisyn Constructor DSL text into IR (inverse of `print()`)
   - [`@tisyn/conformance`](./packages/conformance/README.md): fixture harness for validating runtime behavior

## Recommended reading order

Start in different places depending on what you want to learn.

- Start with [`@tisyn/ir`](./packages/ir/README.md) if you want to see what a Tisyn program looks like.
- Read [`@tisyn/validate`](./packages/validate/README.md) and [`@tisyn/kernel`](./packages/kernel/README.md) if you want to understand correctness and semantics.
- Read [`@tisyn/runtime`](./packages/runtime/README.md) and [`@tisyn/durable-streams`](./packages/durable-streams/README.md) if you want to understand execution and continuation.
- Read [`@tisyn/agent`](./packages/agent/README.md), [`@tisyn/protocol`](./packages/protocol/README.md), and [`@tisyn/transport`](./packages/transport/README.md) if you want to understand host/agent integration and cross-boundary execution.
- Read [`@tisyn/compiler`](./packages/compiler/README.md) if you want to generate IR from TypeScript source instead of building IR by hand.
- Read [`@tisyn/dsl`](./packages/dsl/README.md) if you want to parse Constructor DSL text (e.g. from an LLM) back into IR.

## Package guide

| Package | Purpose |
| --- | --- |
| [`@tisyn/ir`](./packages/ir/README.md) | AST types, constructors, walkers, printers, and value types |
| [`@tisyn/validate`](./packages/validate/README.md) | IR validation and `MalformedIR` errors |
| [`@tisyn/kernel`](./packages/kernel/README.md) | Core evaluation, environments, and runtime error/event types |
| [`@tisyn/durable-streams`](./packages/durable-streams/README.md) | Durable append-only stream abstractions used by replay |
| [`@tisyn/runtime`](./packages/runtime/README.md) | Execution of IR, including durable and remote flows |
| [`@tisyn/agent`](./packages/agent/README.md) | Typed agents, implementations, dispatch, and invocation helpers |
| [`@tisyn/protocol`](./packages/protocol/README.md) | Parsed/constructed protocol messages for host-agent communication |
| [`@tisyn/transport`](./packages/transport/README.md) | Protocol sessions and transports like `stdio`, `websocket`, `worker`, and `sse-post` |
| [`@tisyn/compiler`](./packages/compiler/README.md) | Compile restricted TypeScript generator functions into Tisyn IR |
| [`@tisyn/dsl`](./packages/dsl/README.md) | Parse Tisyn Constructor DSL text into IR; inverse of `print()` |
| [`@tisyn/conformance`](./packages/conformance/README.md) | Execute fixtures against the runtime to verify behavior |

## Typical flows

### Build and run IR directly

```ts
import { Add, Q } from "@tisyn/ir";
import { execute } from "@tisyn/runtime";

const ir = Add(Q(20), Q(22));
const { result } = yield* execute({ ir });
```

### Define an agent and install a remote transport

```ts
import { agent, operation, invoke } from "@tisyn/agent";
import { installRemoteAgent, websocketTransport } from "@tisyn/transport";

const math = agent("math", {
  double: operation<{ value: number }, number>(),
});

yield* installRemoteAgent(math, websocketTransport({ url: "ws://localhost:8080" }));
const result = yield* invoke(math.double({ value: 21 }));
```

For the detailed agent model and API examples, see [`@tisyn/agent`](./packages/agent/README.md).

## Specifications

| Document | Scope |
| --- | --- |
| [Tisyn Specification 1.0](./specs/tisyn-specification-1.0.md) | Core language: values, expressions, and evaluation rules |
| [Kernel Specification](./specs/tisyn-kernel-specification.md) | Kernel semantics, environments, and effect dispatch |
| [Agent Specification 1.1.0](./specs/tisyn-agent-specification-1.1.0.md) | Typed agent declarations, implementations, and invocation |
| [Compiler Specification 1.1.0](./specs/tisyn-compiler-specification-1.1.0.md) | TypeScript-to-IR compilation rules and restrictions |
| [Compound Concurrency Spec](./specs/tisyn-compound-concurrency-spec.md) | `all`, `race`, `spawn`, and `join` orchestration semantics |
| [Spawn Specification](./specs/tisyn-spawn-specification.md) | Authored `spawn(...)`, task handles, `join`, and structured child-task lifecycle |
| [Resource Specification](./specs/tisyn-resource-specification.md) | `resource(...)` and `provide(...)` scope-creating primitives for managed initialization and cleanup |
| [Stream Iteration Specification](./specs/tisyn-stream-iteration-specification.md) | Authored `for (const x of yield* each(expr))`, `stream.subscribe`, `stream.next`, and subscription-handle runtime rules |
| [Browser Contract Specification](./specs/tisyn-browser-contract-specification.md) | Browser transport boundary with `navigate`, batched in-browser `execute`, and transport-configured local capability composition |
| [Timebox Specification](./specs/tisyn-timebox-specification.md) | `timebox` compound external: deadline-bounded execution returning completed/timeout result |
| [Converge Amendment](./specs/tisyn-converge-amendment.md) | `converge` compiler sugar: poll-until-predicate lowered to timebox + recursive Fn + sleep |
| [Timebox/Converge Conformance Plan](./specs/tisyn-timebox-converge-conformance-plan.md) | Test plan for timebox and converge across compiler, runtime, and journaling layers |
| [Authoring Layer Spec](./specs/tisyn-authoring-layer-spec.md) | Generator-based authoring format and contract declarations |
| [Constructor DSL Specification](./specs/tisyn-constructor-dsl-specification.md) | Grammar, constructor table, and recovery semantics for the DSL parser |
| [Architecture](./specs/tisyn-architecture.md) | System architecture and package relationships |

## Design summary

Tisyn separates concerns cleanly:

- the **program model** is explicit and serializable
- the **kernel** defines how expressions evaluate
- the **runtime** executes and continues work
- the **agent layer** moves work across boundaries
- the **transport layer** carries messages between hosts and agents

That separation is what lets Tisyn support deterministic coordination, safe delegation, bounded concurrency, and durable continuation in one system.
