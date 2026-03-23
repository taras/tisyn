# (T)ypeScript (I)nterpreter (Syn)tax

Tisyn (pronounced like the Chicken) is a minimal set of interfaces and
constructors to represent an abstract syntax tree that can be
interpreted.

Tisyn expressions do not come with any semantics whatsoever, they
purely express how to compose values by ensuring that the types line
up. This allows language designers to skip the development of their
own syntax while they are figuring out how execution should work.

The repository is split into small packages with clear boundaries. The root README explains how they fit together; package-level READMEs cover the concrete APIs.

## Package relationships

Tisyn is easiest to understand as layers:

1. Syntax and validation
   - [`@tisyn/ir`](./packages/ir/README.md): the Tisyn expression/value model
   - [`@tisyn/validate`](./packages/validate/README.md): boundary validation for untrusted or external IR

2. Core semantics
   - [`@tisyn/kernel`](./packages/kernel/README.md): evaluation, environments, core errors, and durable event shapes

3. Execution
   - [`@tisyn/durable-streams`](./packages/durable-streams/README.md): append-only replay/journal primitives
   - [`@tisyn/runtime`](./packages/runtime/README.md): durable execution and remote IR execution

4. Agents and remoting
   - [`@tisyn/agent`](./packages/agent/README.md): typed agent declarations, implementations, dispatch, and invocation helpers
   - [`@tisyn/protocol`](./packages/protocol/README.md): wire-level host/agent messages
   - [`@tisyn/transport`](./packages/transport/README.md): sessions and concrete transports

5. Tooling and verification
   - [`@tisyn/compiler`](./packages/compiler/README.md): compile generator-shaped TypeScript into Tisyn IR
   - [`@tisyn/conformance`](./packages/conformance/README.md): fixture harness for validating runtime behavior

## Recommended reading order

- Start with [`@tisyn/ir`](./packages/ir/README.md) to see what a Tisyn program looks like.
- Read [`@tisyn/validate`](./packages/validate/README.md) and [`@tisyn/kernel`](./packages/kernel/README.md) for correctness and semantics.
- Read [`@tisyn/runtime`](./packages/runtime/README.md) for actual execution.
- Read [`@tisyn/agent`](./packages/agent/README.md), [`@tisyn/protocol`](./packages/protocol/README.md), and [`@tisyn/transport`](./packages/transport/README.md) for host/agent integration.
- Read [`@tisyn/compiler`](./packages/compiler/README.md) if you want to generate IR from TypeScript source instead of building IR by hand.

## Package guide

| Package                                                          | Purpose                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`@tisyn/ir`](./packages/ir/README.md)                           | AST types, constructors, walkers, printers, and value types                          |
| [`@tisyn/validate`](./packages/validate/README.md)               | IR validation and `MalformedIR` errors                                               |
| [`@tisyn/kernel`](./packages/kernel/README.md)                   | Core evaluation, environments, and runtime error/event types                         |
| [`@tisyn/durable-streams`](./packages/durable-streams/README.md) | Durable append-only stream abstractions used by runtime replay                       |
| [`@tisyn/runtime`](./packages/runtime/README.md)                 | Durable execution of IR plus remote IR execution                                     |
| [`@tisyn/agent`](./packages/agent/README.md)                     | Typed agents, implementations, dispatch, and invocation helpers                      |
| [`@tisyn/protocol`](./packages/protocol/README.md)               | Parsed/constructed protocol messages for host-agent communication                    |
| [`@tisyn/transport`](./packages/transport/README.md)             | Protocol sessions and transports like `stdio`, `websocket`, `worker`, and `sse-post` |
| [`@tisyn/compiler`](./packages/compiler/README.md)               | Compile TypeScript generator functions into Tisyn IR                                 |
| [`@tisyn/conformance`](./packages/conformance/README.md)         | Execute fixtures against the runtime to verify behavior                              |

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
| -------- | ----- |
| [Tisyn Specification 1.0](./specs/tisyn-specification-1.0.md) | Core language: values, expressions, and evaluation rules |
| [Kernel Specification](./specs/tisyn-kernel-specification.md) | Kernel semantics, environments, and effect dispatch |
| [Agent Specification 1.1.0](./specs/tisyn-agent-specification-1.1.0.md) | Typed agent declarations, implementations, and invocation |
| [Compiler Specification 1.1.0](./specs/tisyn-compiler-specification-1.1.0.md) | TypeScript-to-IR compilation rules and restrictions |
| [Compound Concurrency Spec](./specs/tisyn-compound-concurrency-spec.md) | `all` and `race` orchestration semantics |
| [Authoring Layer Spec](./specs/tisyn-authoring-layer-spec.md) | Generator-based authoring format and contract declarations |
| [Architecture](./specs/tisyn-architecture.md) | System architecture and package relationships |
