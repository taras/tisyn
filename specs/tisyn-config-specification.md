# Tisyn Configuration Specification

**Version:** 0.4.1
**Complements:** Tisyn System Specification 1.0.0
**Status:** Draft

---

## 1. Purpose and Scope

### 1.1 Purpose

This specification defines the Tisyn configuration descriptor
model: the data structures, constructors, validation rules,
and resolution semantics that declare a workflow's runtime
topology.

### 1.2 Core Principle

Configuration follows the same pattern as Tisyn IR: typed
constructors produce serializable tagged data. The runtime
consumes data, not arbitrary code. The entire descriptor is
walkable and inspectable without execution.

### 1.3 In Scope

- Workflow descriptor data model
- `@tisyn/config` constructor vocabulary
- Environment reference nodes (deferred resolution)
- Transport, journal, and server descriptor nodes
- Entrypoint overlay model
- Descriptor validation rules
- Resolution boundary (what is resolved, when, in what order)
- Security and determinism constraints

### 1.4 Out of Scope

- Workflow IR semantics (system specification)
- CLI command surface, flag parsing, help text
  (CLI specification)
- Transport protocol details (transport specification)
- Scoped effects, middleware, dispatch (scoped effects
  specification)
- Compilation of workflow source (compiler specification)
- Workflow-parameter-to-CLI-flag derivation
  (CLI specification)

### 1.5 Normative Language

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY
are used as defined in RFC 2119.

### 1.6 Terminology: "Workflow"

This specification uses "workflow" in three related senses:

- **Workflow descriptor** (`WorkflowDescriptor`): the
  top-level config data structure declaring runtime bindings.
- **Workflow function** (or **workflow entrypoint**): the
  compiled generator function that the runtime executes,
  referenced by the descriptor's `run` field.
- **Workflow** (unqualified, informal): the running
  execution combining the function with its configured
  bindings.

Where precision matters, this specification uses the
qualified forms. `WorkflowRef` refers to a reference to the
workflow function, not to the descriptor.

---

## 2. Architectural Model

### 2.1 Three Value Categories

**Static values.** Known at authoring time. Strings, numbers,
booleans. Embedded directly in the descriptor.

**Deferred values.** Described at authoring time, resolved at
startup. Environment variable references. Represented as
tagged nodes. The runtime resolves them before starting any
transport or executing any workflow.

**Live values.** Created by the runtime at startup. Transport
connections, session managers. These MUST NOT appear in the
descriptor.

### 2.2 Where Config Source Lives

The normative config model is **placement-agnostic**. A
`WorkflowDescriptor` is a portable data structure. Any module that
produces one via `@tisyn/config` constructors and exports it
as the default export is a valid config source.

**Recommendation.** Config declarations SHOULD be colocated
with workflow source and agent contract declarations. The
workflow file already declares agent topology; transport
bindings and environment dependencies are part of the same
workflow definition. Separate config modules MAY be used
when organizational or build-system constraints warrant it.

### 2.3 Evaluation Model

Config constructors are regular function calls that return
tagged data. They require no special toolchain support.

1. The config-bearing module is evaluated
2. The `default` export is extracted as the `WorkflowDescriptor`
3. The runtime walks, validates, and resolves the descriptor

The descriptor is fully formed after step 1. Steps 2–3 are
runtime responsibilities specified in §7.

### 2.4 Config and IR Are Disjoint Domains

Config nodes and IR nodes are distinct tagged domains. Config
uses the `tisyn_config` discriminant. IR uses the `tisyn`
discriminant. A single object MUST NOT carry both fields.
Config descriptors MUST NOT appear inside IR expression trees.
IR expression trees MUST NOT appear inside config descriptors.

---

## 3. Descriptor Data Model

### 3.1 Serializable Data Domain

All values in a config descriptor MUST belong to the
**portable serializable data domain**, defined as:

- `null`
- `boolean`
- `number` (finite; no `NaN`, no `Infinity`)
- `string`
- plain objects (no prototype chain beyond `Object.prototype`,
  no Symbol keys, no methods)
- arrays of values from this domain
- no `undefined`, `BigInt`, `Symbol`, `Date`, `RegExp`,
  `Map`, `Set`, `ArrayBuffer`, class instances, functions,
  or circular references

This domain is a subset of JSON-representable values. JSON
round-trip (`JSON.parse(JSON.stringify(v))`) MAY be used as
a practical conformance check, but the normative definition
is the domain above.

### 3.2 Workflow Descriptor

The top-level descriptor produced by `workflow()`.

```typescript
interface WorkflowDescriptor {
  readonly tisyn_config: "workflow";
  readonly run: WorkflowRef;
  readonly agents: readonly AgentBinding[];
  readonly journal?: JournalDescriptor;
  readonly entrypoints?: Readonly<Record<string, EntrypointDescriptor>>;
}
```

The base `WorkflowDescriptor` MUST NOT include a `server` field.
Server infrastructure is introduced only via entrypoint
overlays (§3.8).

### 3.3 Workflow Reference

A `WorkflowRef` identifies the workflow function (§1.6) to
execute. The type is named `WorkflowRef` (not `RunRef`)
because it refers to a workflow function specifically.

```typescript
interface WorkflowRef {
  readonly export: string;
  readonly module?: string;
}
```

**`export`** (required): The name of the exported workflow
entrypoint symbol (e.g., `"chat"`). The named export MUST
be a valid workflow function in the target module.

**`module`** (optional): A relative path to the module
containing the workflow export. When omitted, the runtime
MUST resolve the export from the module from which the
`WorkflowDescriptor` was loaded — that is, the module whose
`default` export produced this descriptor.

When config and workflow declarations are in the same source
module (or compile into the same output module), `module`
MAY be omitted. When config is in a separate module from
the workflow, `module` MUST be specified.

### 3.4 Agent Binding

Associates a declared agent identity with a transport.

```typescript
interface AgentBinding {
  readonly tisyn_config: "agent";
  readonly id: string;
  readonly transport: TransportDescriptor;
}
```

The `id` MUST match the agent ID produced by the
corresponding contract declaration (e.g., `"llm"` for
a contract declared as `Llm()`).

### 3.5 Transport Descriptors

Each transport descriptor is a tagged node identifying a
transport kind and its configuration.

```typescript
interface TransportDescriptorBase {
  readonly tisyn_config: "transport";
  readonly kind: string;
}
```

**Built-in kinds:**

```typescript
interface WorkerTransportDescriptor extends TransportDescriptorBase {
  readonly kind: "worker";
  readonly url: string | EnvDescriptor;
}

interface LocalTransportDescriptor extends TransportDescriptorBase {
  readonly kind: "local";
  readonly module: string;
}

interface StdioTransportDescriptor extends TransportDescriptorBase {
  readonly kind: "stdio";
  readonly command: string | EnvDescriptor;
  readonly args?: readonly (string | EnvDescriptor)[];
}

interface WebSocketTransportDescriptor extends TransportDescriptorBase {
  readonly kind: "websocket";
  readonly url: string | EnvDescriptor;
}

interface InprocessTransportDescriptor extends TransportDescriptorBase {
  readonly kind: "inprocess";
  readonly module: string;
}
```

#### 3.5.1 Transport Extensibility

The `kind` field is a string. The five kinds above are the
built-in set specified by this document.

Additional transport kinds MAY be introduced by:

- Future revisions of this specification
- Extension packages that export constructors returning
  `TransportDescriptorBase` with a custom `kind` string

Extension descriptors MUST conform to all rules in this
specification: `tisyn_config: "transport"`, fully within
the serializable data domain (§3.1), no live handles,
walkable for env nodes.

The runtime MUST reject unknown `kind` values with a
descriptive error unless an extension resolver is registered.

### 3.6 Environment Descriptors

Environment descriptors reference values resolved at startup
from the process environment. They MUST NOT read environment
variables during construction.

```typescript
interface EnvOptionalDescriptor {
  readonly tisyn_config: "env";
  readonly mode: "optional";
  readonly name: string;
  readonly default: string | number | boolean;
}

interface EnvRequiredDescriptor {
  readonly tisyn_config: "env";
  readonly mode: "required";
  readonly name: string;
}

interface EnvSecretDescriptor {
  readonly tisyn_config: "env";
  readonly mode: "secret";
  readonly name: string;
}

type EnvDescriptor =
  | EnvOptionalDescriptor
  | EnvRequiredDescriptor
  | EnvSecretDescriptor;
```

### 3.7 Journal Descriptor

```typescript
interface FileJournalDescriptor {
  readonly tisyn_config: "journal";
  readonly kind: "file";
  readonly path: string | EnvDescriptor;
}

interface MemoryJournalDescriptor {
  readonly tisyn_config: "journal";
  readonly kind: "memory";
}

type JournalDescriptor = FileJournalDescriptor | MemoryJournalDescriptor;
```

When no journal is specified, the runtime MUST default to
in-memory journaling.

### 3.8 Entrypoint Descriptor

An entrypoint is an **overlay** applied to the base
workflow descriptor. It provides deployment-variant
configuration without duplicating the full descriptor.

```typescript
interface EntrypointDescriptor {
  readonly tisyn_config: "entrypoint";
  readonly agents?: readonly AgentBinding[];
  readonly journal?: JournalDescriptor;
  readonly server?: ServerDescriptor;
}
```

Every field in an entrypoint is optional. Omitted fields
inherit from the base descriptor. Present fields override
the base per §7.3. The entrypoint is a sparse patch, not
a complete descriptor.

Entrypoints MUST NOT override the workflow reference. The
workflow identity is fixed by the base `WorkflowDescriptor`.
Entrypoints vary runtime and deployment behavior only:
which transports are used, which journal backend is active,
and whether a dev server is started.

### 3.9 Server Descriptor

Declares a server the runtime starts to accept incoming
connections.

```typescript
interface ServerDescriptor {
  readonly tisyn_config: "server";
  readonly kind: string;
  readonly port: number | EnvDescriptor;
  readonly static?: string;
}
```

The built-in server kind is `"websocket"`. The `kind` field
follows the same extensibility model as transport descriptors
(§3.5.1).

Server descriptors appear only inside entrypoint overlays.
The base `WorkflowDescriptor` MUST NOT include a server. This
reflects the architectural intent that server infrastructure
is a deployment concern — typically a dev convenience — not
a property of the workflow definition itself.

### 3.10 Discriminant Convention

All config nodes use `tisyn_config` as the discriminant.
Recognized values: `"workflow"`, `"agent"`, `"transport"`,
`"env"`, `"journal"`, `"entrypoint"`, `"server"`.

---

## 4. Constructor Vocabulary

### 4.1 Package

```
@tisyn/config
```

Exports only pure functions that return values within the
serializable data domain (§3.1).

### 4.2 Constructors

#### `workflow`

```typescript
function workflow(config: {
  run: string | WorkflowRef;
  agents: AgentBinding[];
  journal?: JournalDescriptor;
  entrypoints?: Record<string, EntrypointDescriptor>;
}): WorkflowDescriptor;
```

When `run` is a plain string, `workflow()` MUST normalize
it to `{ export: <the provided string> }`.

#### `agent`

```typescript
function agent(id: string, transport: TransportDescriptor): AgentBinding;
```

#### `transport.*`

```typescript
const transport: {
  worker(url: string | EnvDescriptor): WorkerTransportDescriptor;
  local(module: string): LocalTransportDescriptor;
  stdio(command: string | EnvDescriptor,
        args?: (string | EnvDescriptor)[]): StdioTransportDescriptor;
  websocket(url: string | EnvDescriptor): WebSocketTransportDescriptor;
  inprocess(module: string): InprocessTransportDescriptor;
};
```

#### `env`

```typescript
function env(name: string,
             defaultValue: string | number | boolean): EnvOptionalDescriptor;

env.required = (name: string): EnvRequiredDescriptor;
env.secret = (name: string): EnvSecretDescriptor;
```

The mode is determined by the constructor form:

| Form | Mode | Implicitly required? |
|---|---|---|
| `env("X", value)` | `optional` | No |
| `env.required("X")` | `required` | Yes |
| `env.secret("X")` | `secret` | Yes |

#### `journal.*`

```typescript
const journal: {
  file(path: string | EnvDescriptor): FileJournalDescriptor;
  memory(): MemoryJournalDescriptor;
};
```

#### `entrypoint`

```typescript
function entrypoint(config?: {
  agents?: AgentBinding[];
  journal?: JournalDescriptor;
  server?: ServerDescriptor;
}): EntrypointDescriptor;
```

#### `server.*`

```typescript
const server: {
  websocket(config: {
    port: number | EnvDescriptor;
    static?: string;
  }): ServerDescriptor;
};
```

### 4.3 Extension Constructors

Packages outside `@tisyn/config` MAY export constructors for
custom transport or server kinds. Extension constructors MUST
return values within the serializable data domain (§3.1),
tagged with the appropriate `tisyn_config` value and a custom
`kind` string.

---

## 5. Environment Reference Model

### 5.1 Semantics

An `EnvDescriptor` is a **deferred reference** — a data node
that names an environment variable to be resolved at startup.
It is not a value. It is a description of where a value will
come from.

### 5.2 Three Modes

**Optional** (`env("NAME", default)`): If the variable is
set, its value is used. If not set, the default is used. The
runtime MUST NOT fail for a missing optional variable.

**Required** (`env.required("NAME")`): The variable MUST be
set. If missing, startup MUST fail.

**Secret** (`env.secret("NAME")`): The variable MUST be set.
The resolved value MUST be redacted from all human-readable
surfaces (§8.1). Secret implies required.

### 5.3 Static Discoverability

All environment requirements are discoverable by walking the
descriptor without executing any workflow:

```
walk(descriptor) → collect nodes where tisyn_config === "env"
```

This enables pre-startup validation and tooling such as
environment checks or `.env.example` generation.

### 5.4 Resolution Typing

In this version of the specification, the resolved type
depends on the constructor form:

| Form | Resolved type |
|---|---|
| `env("X", stringDefault)` | `string` |
| `env("X", numberDefault)` | `number` (coerced from string) |
| `env("X", booleanDefault)` | `boolean` (coerced from string) |
| `env.required("X")` | `string` |
| `env.secret("X")` | `string` |

This asymmetry is intentional. Optional env nodes infer their
resolved type from the default value's type. Required and
secret nodes always resolve to `string` because there is no
default from which to infer a target type.

**Coercion rules** (applied only to optional nodes with
non-string defaults, when the variable is set):

| Target type | Rule |
|---|---|
| `number` | `parseFloat(value)`. `NaN` → type error. |
| `boolean` | `"true"`, `"1"` → `true`; `"false"`, `"0"` → `false`; else → type error. |

Coercion is a resolution concern (§7), not a construction
concern.

### 5.5 No Resolved Values in Descriptors

An `EnvDescriptor` MUST NOT contain a `value` field. Resolved
values exist only in runtime memory after resolution. They
MUST NOT be persisted in the descriptor or any emitted
artifact.

---

## 6. Validation Rules

### 6.1 Config-Owned Validations (Blocking)

These validations are fully owned by the config layer. They
require only the descriptor. A failing check MUST prevent
startup.

V1. Every node MUST have a `tisyn_config` field with a
    recognized value.

V2. `WorkflowDescriptor` MUST have a `run` field (valid
    `WorkflowRef` or non-empty string) and a non-empty
    `agents` array.

V3. Each `AgentBinding` MUST have a non-empty `id` and a
    valid `TransportDescriptor`.

V4. Agent `id` values within `agents` MUST be unique.

V5. Each `TransportDescriptor` MUST have a `kind` field.
    Built-in kinds MUST include their required fields
    (e.g., `worker` requires `url`).

V6. `EnvOptionalDescriptor` MUST have a `default` field.
    `EnvRequiredDescriptor` and `EnvSecretDescriptor` MUST
    NOT have a `default` field.

V7. Entrypoint keys MUST be non-empty strings matching
    `[a-z][a-z0-9-]*`.

V8. All values MUST be within the serializable data domain
    (§3.1).

V9. No node MAY carry both `tisyn_config` and `tisyn` fields.

V10. `WorkflowDescriptor` MUST NOT include a `server` field.

### 6.2 Compiler-Integrated Validations (Advisory)

These validations require workflow or contract metadata
beyond the descriptor itself. They SHOULD be enforced when
such metadata is available but are not blocking at the config
layer alone.

V11. The `run.export` field SHOULD name a workflow
     entrypoint export in the target module.

V12. Each agent `id` SHOULD correspond to an agent ID
     declared by a contract in the workflow module.

V13. Entrypoint agent overlay `id` values SHOULD reference
     `id` values present in the base `agents` array.

### 6.3 Runtime-Integrated Validations (Blocking at Startup)

These validations require runtime state. They occur during
resolution (§7) and MUST block execution on failure.

V14. Required and secret env variables MUST be set in the
     process environment.

V15. Env value coercion MUST succeed (no type errors).

V16. The `run.module` path, if specified, MUST resolve
     to an importable module.

V17. Transport modules (for `local` and `inprocess` kinds)
     MUST resolve to importable modules.

> **MVP Scope (v0.8.0):** V14 and V15 are delivered as
> `resolveEnv()` behavior in `@tisyn/runtime`. V16 and V17
> are **deferred** — they require module loading
> infrastructure not present in this MVP. Module resolution
> is deferred to the companion run/CLI/runtime-entrypoint
> spec.

---

## 7. Resolution Boundary and Startup Semantics

### 7.1 Resolution Order

When the runtime starts a workflow from a config
descriptor, it MUST perform the following steps in order:

1. **Descriptor extraction.** Obtain the `WorkflowDescriptor`
   from the config-bearing module's `default` export.

2. **Entrypoint overlay.** If an entrypoint is named, apply
   the overlay per §7.3. If not, use the base descriptor.

3. **Config validation.** Validate the merged descriptor
   against §6.1.

4. **Environment collection.** Walk the descriptor and
   collect all `EnvDescriptor` nodes.

5. **Environment resolution.** For each node:
   - Read the named variable from the process environment
   - If set: use the value (coercing per §5.4 if applicable)
   - If not set and `optional`: use `node.default`
   - If not set and `required` or `secret`: record as missing

6. **Environment validation.** If any variables are missing,
   report ALL missing variables in a single diagnostic and
   fail.

7. **Resource startup.** Create journal. Start transports.
   Start server if the merged descriptor includes one.
   Execute workflow.

> **MVP Scope (v0.8.0):** Steps 2–6 are delivered as pure
> functions in `@tisyn/runtime` (`applyOverlay`,
> `resolveEnv`, `resolveConfig`, `projectConfig`). Step 1
> (descriptor extraction from module) and step 7 (resource
> startup / workflow execution) are **deferred** to the
> companion run/CLI/runtime-entrypoint spec.

### 7.2 Fail-Before-Execute

Steps 1–6 MUST succeed before any transport starts or any
workflow executes. Configuration errors surface at startup,
not mid-execution.

### 7.3 Entrypoint Overlay Merge

An entrypoint is applied to the base descriptor as a sparse
overlay. Omitted fields inherit the base value.

| Entrypoint field | Merge rule |
|---|---|
| `agents` | Merge by `id`. Matching base agents are replaced. Non-matching base agents are retained. Entrypoint agents with `id` values not in the base are appended. |
| `journal` | Full replacement. Entrypoint journal replaces base journal. |
| `server` | Additive. The base has no server; the entrypoint introduces one. |

The `run` field is not part of the entrypoint schema.
Entrypoints MUST NOT alter the workflow identity.

### 7.4 Shutdown

Structured shutdown is a runtime concern. The config
descriptor does not model shutdown behavior.

### 7.5 Resolved Config and Workflow Access

#### 7.5.1 Descriptor vs. Resolved Config

This specification distinguishes two representations:

- The **config descriptor** (`WorkflowDescriptor`): serializable
  authored data that MAY contain deferred nodes such as
  `EnvDescriptor`. Produced by constructors. Walkable and
  inspectable before startup.

- The **resolved config**: a runtime-only value derived
  from the descriptor after entrypoint overlay application
  (§7.3) and environment resolution (§7.1 steps 2–6).
  All deferred nodes have been replaced with concrete
  values. Intended for workflow consumption, not descriptor
  inspection.

The resolved config is a runtime-internal value. It MAY
contain sensitive data (resolved secrets). It MUST NOT be
persisted, emitted, or exposed by config infrastructure on
any human-readable surface. The redaction requirements of
§8.1 apply.

#### 7.5.2 Resolved Config Is a Projection

The resolved config is a **workflow-visible projection** of
the merged descriptor, not the raw descriptor with env nodes
filled in.

Descriptor-only metadata MAY be omitted from the resolved
config. Fields that serve authoring, validation, or overlay
mechanics — but are not meaningful to workflow code at
runtime — need not be exposed. Examples of descriptor-only
concerns that MAY be omitted:

- `entrypoints` (overlays are already applied)
- `tisyn_config` discriminant fields
- `WorkflowRef` metadata (the workflow is already running)
- overlay patch structure

The exact shape of the resolved config projection is defined
by companion runtime and compiler specifications (§7.5.4).
This specification establishes only that the projection is
permitted and that it MUST satisfy the semantic rules below.

#### 7.5.3 `Config.useConfig()` Semantic Contract

The runtime MUST make the resolved config available to
workflow code through a dedicated access mechanism referred
to in this specification as `Config.useConfig()`.

R1. `Config.useConfig()` MUST return the post-overlay,
    post-resolution config for the active execution context.
    Entrypoint overlays MUST already be applied. Environment
    references MUST already be resolved. The workflow MUST
    NOT observe intermediate descriptor forms.

R2. `Config.useConfig()` MUST NOT expose unresolved `EnvDescriptor`
    nodes. Every deferred reference MUST be replaced with
    its concrete value before the workflow can observe it.

R3. `Config.useConfig()` MUST NOT expose invocation-time inputs.
    The resolved config (runtime bindings declared in the
    descriptor) and invocation arguments (parameters passed
    to the workflow function at call time) are separate
    channels. `Config.useConfig()` exposes the resolved config
    only. Invocation arguments are provided through the
    workflow function's parameters.

R4. Secret values MAY be present in the resolved config in
    runtime memory. The redaction requirements of §8.1
    govern all human-readable surfaces. The resolved config
    itself is a runtime-internal value, not a human-readable
    surface.

#### 7.5.4 Typing and Binding

The exact TypeScript signature of `Config.useConfig()`, the
resolved config projection shape, the mechanism by which
the return type is inferred or declared, and how a workflow
is bound to a specific `WorkflowDescriptor` are defined by
companion runtime and compiler specifications.

This specification defines only the semantic contract:
what `Config.useConfig()` returns, when it is valid to call, and
what guarantees it provides.

> **Implementation (v0.8.0+):** Workflow-authored config
> access is provided via `yield* Config.useConfig(Token)`, where
> `Token` is a `ConfigToken<T>` that carries static typing
> for the resolved config projection. The compiler lowers
> this to `ExternalEval("__config", Q(null))`, erasing the
> token. The runtime resolves the `__config` effect from
> an execution-scoped config context. See Compiler Specification §4.6
> for lowering details. Automatic type inference from
> descriptor shape is not yet specified — the token
> approach provides explicit typing.

---

## 8. Security and Determinism Constraints

### 8.1 Secret Redaction

Resolved secret values MUST be redacted from all
human-readable surfaces, including:

- diagnostic messages
- log output
- validation error messages
- command output (e.g., `tsn check`, `tsn inspect`, or
  similar tooling)
- verbose or debug output
- any other inspection, reporting, or debugging surface

The descriptor itself MUST NOT contain resolved secret
values. It contains the `EnvSecretDescriptor` node (the
variable name only, never the value).

Resolved secrets MUST exist only in process memory. They
MUST NOT be written to the journal or any persistent store
by config infrastructure.

### 8.2 Constructor Purity

Config constructors MUST be pure functions with no side
effects. They MUST NOT read environment variables, access
the filesystem, make network requests, or modify global
state.

Constructors MUST produce the same descriptor on every
evaluation of the same source. No constructor MAY use
non-deterministic operations.

### 8.3 Environment Resolution Non-Determinism

Environment resolution is intentionally non-deterministic
across environments. The descriptor captures the shape of
dependencies; the runtime resolves values. This is by design.

---

## 9. Worked Examples

### 9.1 Minimal Workflow (Colocated)

```typescript
import { workflow, agent, transport } from "@tisyn/config";

export default workflow({
  run: "hello",
  agents: [
    agent("greeter", transport.inprocess("./greeter-impl.ts")),
  ],
});

export function* hello() {
  const result = yield* Greeter().greet({ name: "World" });
  return result.message;
}
```

`run: "hello"` normalizes to `{ export: "hello" }`.
Since no `module` is specified, the runtime resolves `hello`
from the module that produced this descriptor.

### 9.2 Multi-Agent Chat (Colocated with Entrypoint)

```typescript
import { workflow, agent, transport, env, journal, entrypoint, server } from "@tisyn/config";

export default workflow({
  run: "chat",
  agents: [
    agent("llm", transport.worker("./llm-worker.js")),
    agent("app", transport.local("./browser-agent.ts")),
  ],
  journal: journal.file(env("JOURNAL_PATH", "./data/chat.journal")),
  entrypoints: {
    dev: entrypoint({
      server: server.websocket({
        port: env("PORT", 3000),
        static: "./dist",
      }),
    }),
  },
});

export function* chat() {
  let history: Array<{ role: string; content: string }> = [];
  while (true) {
    const user = yield* App().waitForUser({ prompt: "Say something" });
    const assistant = yield* Llm().sample({ history, message: user.message });
    history = [...history,
      { role: "user", content: user.message },
      { role: "assistant", content: assistant.message },
    ];
    yield* App().showAssistantMessage({ message: assistant.message });
  }
}
```

Dev: `tsn run workflow.ts --entrypoint dev` — starts a
WebSocket server on port 3000 and serves static files.

Production: `tsn run workflow.ts` — no server, connections
arrive via external infrastructure.

### 9.3 Separate Config Module

```typescript
// app.config.ts
import { workflow, agent, transport, env } from "@tisyn/config";

export default workflow({
  run: { export: "chat", module: "./workflow.generated.ts" },
  agents: [
    agent("llm", transport.websocket(env.required("LLM_ENDPOINT"))),
    agent("app", transport.local("./browser-agent.ts")),
  ],
});
```

The `module` field is required here because the workflow
export lives in a different module from the descriptor.

### 9.4 Environment Variable Report

Walking the descriptor from §9.2 yields two env nodes:

```
JOURNAL_PATH    optional    default: "./data/chat.journal"
PORT            optional    default: 3000
```

Walking §9.3 yields one:

```
LLM_ENDPOINT    required    ✗ missing
```

### 9.5 Secret Usage

```typescript
agent("llm", transport.websocket(env.secret("OPENAI_API_KEY")))
```

The descriptor contains
`{ tisyn_config: "env", mode: "secret", name: "OPENAI_API_KEY" }`.
The resolved value is redacted from all human-readable
surfaces per §8.1.

### 9.6 Resolved Config Projection

Given this descriptor:

```typescript
export default workflow({
  run: "chat",
  agents: [
    agent("llm", transport.worker("./llm-worker.js")),
    agent("app", transport.local("./browser-agent.ts")),
  ],
  journal: journal.file(env("JOURNAL_PATH", "./data/chat.journal")),
  entrypoints: {
    dev: entrypoint({
      server: server.websocket({ port: env("PORT", 3000) }),
    }),
  },
});
```

The `yield* Config.useConfig(Token)` authored form gives workflow
code access to the resolved config projection. The runtime
resolution pipeline produces this projection, which the
runtime makes available through the `__config` effect:

```typescript
const config = resolveConfig(descriptor, {
  entrypoint: "dev",
  processEnv: {
    JOURNAL_PATH: "./data/chat.journal",
    PORT: "3000",
  },
});

// Journal path is a resolved string — the EnvDescriptor
// for JOURNAL_PATH has been replaced with its concrete
// value.
const journalPath: string = config.journal.path;

// Agent bindings are available with resolved transport
// config. If a transport URL used env.required(), the
// resolved URL string is here, not the EnvDescriptor.

// Descriptor-only metadata is not present:
// - no config.entrypoints (overlays already applied)
// - no config.run (workflow selection remains outside the
//   projected runtime view)
// - no tisyn_config discriminant fields
```

Workflow code accesses this projection via
`yield* Config.useConfig(Token)`, as described in §7.5.3. The
`Token` is a `ConfigToken<T>` providing static typing.
The compiler erases the token and emits an
`ExternalEval("__config", Q(null))` effect; the runtime
resolves it from the execution-scoped config context.

### 9.7 Invalid Config

```typescript
// V4 violation: duplicate agent IDs
workflow({
  run: "chat",
  agents: [
    agent("llm", transport.worker("./a.js")),
    agent("llm", transport.worker("./b.js")),
  ],
});

// V6 violation: required env with default
// (not expressible via constructors, but detectable
// on manually constructed nodes)
{ tisyn_config: "env", mode: "required", name: "X", default: "y" }
```

---

## 10. Open Questions

Q1. **`transport.local()` module contract.** Should the
    implementation module export a specific shape (e.g.,
    default export of `AgentImplementation`), or accept a
    factory function? Needs alignment with `@tisyn/agent`.

Q2. **Entrypoint agent append behavior.** §7.3 allows
    entrypoint agents with IDs not in the base to be
    appended. Should this be restricted to overlay-only
    (replace existing IDs, never add new ones)?

Q3. **Direct-run vs. generated-only.** Should `tsn run`
    accept the authored `.ts` file (compiling on the fly)
    or only the generated output? Affects DX and toolchain
    requirements at runtime.

Q4. **Typed required env.** In future versions,
    `env.required("PORT", { type: "number" })` could enable
    typed resolution for required and secret nodes. Deferred
    because the current string-only model is simpler and
    covers most cases.

---

## 11. Non-Normative Implementation Notes

### 11.1 Package Boundaries

```
@tisyn/config           constructors, types, validation, walk
@tisyn/cli              tsn run, tsn check commands
@tisyn/runtime          resolution, transport startup, execution
@tisyn/durable-streams  FileJournalStream
```

### 11.2 Descriptor Walking

```typescript
function walkConfig(descriptor: WorkflowDescriptor, visitor: ConfigVisitor): void;
function collectEnvNodes(descriptor: WorkflowDescriptor): EnvDescriptor[];
```

Depth-first traversal of all `tisyn_config` nodes.

### 11.3 CLI Argument Derivation (Adjacent Feature)

`tsn run` MAY derive CLI flags from the workflow entrypoint's
TypeScript parameter type and JSDoc annotations. This is a
CLI feature, not part of the config descriptor grammar. The
descriptor does not contain CLI metadata.

The companion CLI specification SHOULD consider Configliere
as an implementation option for CLI flag parsing, environment
variable handling, precedence, help text, and provenance.

### 11.4 `tsn check` (Adjacent Feature)

A `tsn check` command MAY validate a config descriptor without
starting transports — performing steps 1–6 of §7.1. This is
a CLI feature.

---

## 12. Implementation Readiness Assessment

### Ready Now

- **Descriptor data model** (§3): Fully specified.
  Implementable as `@tisyn/config`.
- **Constructor vocabulary** (§4): Fully specified.
- **Environment reference model** (§5): Fully specified.
  Three modes, coercion rules, discoverability.
- **Config-owned validation** (§6.1): Implementable
  standalone.
- **`Config.useConfig()` semantic contract** (§7.5): Semantic
  rules specified. Typed token binding is implemented
  via `ConfigToken<T>` (see Compiler Specification §4.6).
  Runtime config is execution-scoped via `ConfigContext`.
- **Security constraints** (§8): Fully specified.

### Needs Companion Spec

- **`tsn run` / `tsn check`**: CLI specification for module
  evaluation, entrypoint selection, flag parsing, process
  lifecycle, and Configliere integration.
- **`Config.useConfig()` type inference**: Automatic type inference
  of the `Config.useConfig()` return type from the descriptor shape
  is not yet specified. The current approach uses explicit
  `ConfigToken<T>` typing.
- **`transport.local()` runtime contract**: Alignment with
  `@tisyn/agent` and transport specification.
- **Extension transport registration**: How the runtime
  discovers resolvers for unknown transport kinds.

### Decisions Remaining

- Q1: `transport.local()` module export contract
- Q2: Entrypoint agent append vs. overlay-only
- Q3: Direct-run vs. generated-only
- Q4: Typed required env (future version)

---

## Final Editorial Cleanup

1. **Terminology disambiguation.** §1.6 clarifies the three
   senses of "workflow" used in this specification:
   workflow descriptor (the data structure), workflow
   function (the compiled entrypoint), and workflow
   (informal, the running execution). Qualified forms
   used where precision matters.

2. **`WorkflowRef` name confirmed.** §3.3 explicitly notes
   that `WorkflowRef` is kept (not renamed to `RunRef`)
   because it refers to a workflow function specifically.
   The field is `run`; the type describes what it
   references.

3. **Article grammar.** "An `WorkflowDescriptor`" corrected
   to "A `WorkflowDescriptor`" in §2.2.

4. **R3 wording clarified.** The config-vs-invocation-args
   rule now distinguishes "resolved config (runtime
   bindings)" from "invocation arguments (parameters passed
   at call time)" without repeating "workflow" ambiguously.

5. **No semantic changes.** All architecture, data model,
   validation, resolution, and security rules unchanged.
