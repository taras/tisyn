# Multi-Agent Chat Demo

## Summary

This demo proves that Tisyn can coordinate a workflow-driven chat loop across
multiple boundaries using `tsn run`:

- browser interaction crosses a WebSocket-backed App agent boundary
- the workflow orchestrates all agent interactions
- a Worker-backed LLM agent samples responses
- an in-process DB agent persists chat history
- the compiler is used to author the workflow

This is not an autonomous multi-agent system. Agents do not talk to each
other. The workflow is the only orchestrator.

The browser-facing contract in this demo is example-specific. It should not be
read as the canonical generic browser transport contract for Tisyn. The
generic transport-level browser contract is specified separately in
`specs/tisyn-browser-contract-specification.md` and is intentionally narrower.

## Goals

The demo should prove all of the following:

- the workflow can explicitly request user input from the browser through an
  agent boundary (`App().elicit(...)`)
- the browser can return the user's response as the result of that request
- the workflow can call an LLM agent in a Worker with `Llm().sample(...)`
- the workflow can send assistant output back to the browser through the App
  agent (`App().showAssistantMessage(...)`)
- chat history persists across process restarts via `DB().loadMessages()` and
  `DB().appendMessage(...)`
- the workflow loop can be expressed through the compiler and executed via
  `tsn run`
- there is no imperative host orchestrator

## Non-Goals

Version 1 does not attempt any of the following:

- direct agent-to-agent communication
- browser-owned orchestration
- token streaming
- journal-based workflow replay across restarts
- tool-calling graphs or planner/executor architectures
- a specific local-model runtime in the Worker

## Topology

```text
+-------------------+      WebSocket       +------------------------+
| Browser UI        | <------------------> | App Agent (local)      |
| - transcript      |                      | - browser boundary     |
| - input box       |                      | - elicit / loadChat    |
| - send button     |                      +-----------+------------+
+-------------------+                                  |
                                                       |
                                            typed agent operations
                                                       |
                                                       v
                                          +------------+------------+
                                          | Workflow (chat)         |
                                          | - owns the loop         |
                                          | - compiled from TS      |
                                          | - executed via tsn run  |
                                          +---+----------------+----+
                                              |                |
                                     worker transport    inprocess transport
                                              |                |
                                              v                v
                                 +------------+--+   +---------+--------+
                                 | LLM Agent     |   | DB Agent         |
                                 | - sample(...)  |   | - loadMessages() |
                                 | - echo stub    |   | - appendMessage()|
                                 +---------------+   | - JSON file      |
                                                     +------------------+
```

Control flow for one cycle:

1. workflow asks the App agent to elicit input
2. browser renders the request and waits for the user
3. browser returns the user's response to the workflow
4. workflow persists the user message via `DB().appendMessage(...)`
5. workflow calls the Worker LLM agent to sample a reply
6. workflow persists the assistant message via `DB().appendMessage(...)`
7. workflow asks the App agent to display the assistant output
8. repeat

On startup, the workflow loads prior chat from `DB().loadMessages()` and
pushes it to the browser via `App().loadChat(messages)`.

## Component Responsibilities

### Browser UI

The browser is a thin UI client.

It owns:

- transcript rendering
- user input
- send action
- pending and connection indicators

It does not own:

- the chat loop
- prompt construction
- model sampling
- agent orchestration
- chat persistence

### App Agent

The App agent is a real agent boundary between the workflow and the browser.

For this demo, the App agent exposes app-specific operations. Those are not
intended to be the generic reusable browser transport API for Tisyn.

It owns:

- translating workflow requests into UI actions via WebSocket
- waiting for browser user input when the workflow asks for it (`elicit`)
- returning the user's response to the workflow
- displaying assistant output when the workflow sends it (`showAssistantMessage`)
- delivering chat history to the browser on connect/reconnect (`loadChat`)
- session identity and owner/observer semantics

It does not own:

- the conversation loop
- LLM prompting
- conversation state decisions
- chat persistence

### Workflow (chat)

The workflow is the control plane for the demo.

It owns:

- the chat loop
- execution as compiled IR via `tsn run`
- coordination between App, LLM, and DB agents
- conversation history accumulation
- startup restoration (load from DB, push to browser)

It is the only orchestrator.

### LLM Agent (Worker)

The Worker agent is an isolated inference boundary.

It owns:

- receiving prompt/context from the workflow
- returning one complete assistant response

The inference backend is intentionally pluggable. The demo uses an echo stub.

### DB Agent (In-Process)

The DB agent is the persistence boundary.

It owns:

- reading persisted chat history (`loadMessages`)
- writing individual messages (`appendMessage`)

Demo-minimal: JSON file adapter, single conversation per process, synchronous
file I/O.

## Workflow Source

```ts
export function* chat() {
  const prior = yield* DB().loadMessages({});
  yield* App().loadChat(prior);

  let history = prior;
  while (true) {
    const user = yield* App().elicit({ message: "Say something" });
    yield* DB().appendMessage({ role: "user", content: user.message });

    const contextForSampling = [
      ...history,
      { role: "user", content: user.message },
    ];
    const assistant = yield* Llm().sample({
      history: contextForSampling,
      message: user.message,
    });
    yield* DB().appendMessage({ role: "assistant", content: assistant.message });

    history = [
      ...contextForSampling,
      { role: "assistant", content: assistant.message },
    ];
    yield* App().showAssistantMessage({ message: assistant.message });
  }
}
```

## Agent Contracts

### App agent

```ts
App().elicit(input: { message: string }): { message: string }
App().showAssistantMessage(input: { message: string }): void
App().loadChat(messages: Array<{ role: string; content: string }>): void
App().setReadOnly(input: { reason: string }): void
```

### LLM agent

```ts
Llm().sample(input: {
  history: Array<{ role: string; content: string }>;
  message: string;
}): { message: string }
```

### DB agent

```ts
DB().loadMessages(input: {}): Array<{ role: string; content: string }>
DB().appendMessage(input: { role: string; content: string }): void
```

## Runtime API Note

The workflow source above uses the compiled authored surface:
`App().elicit(...)`, `Llm().sample(...)`, `DB().loadMessages(...)`.
These compile down to IR that the runtime dispatches through agent
boundaries.

At the runtime/host level, agent access uses `useAgent()`, which
returns a typed facade with direct operation methods and an
`.around()` method for per-agent middleware. This is the API used
by runtime infrastructure and transport bindings, not by compiled
workflow source. All behavioral extension (tracing, budgets,
guards) uses the single `.around()` primitive from the Context API
model — there is no separate enforcement mechanism.

When the demo binds local host-side handlers directly, it now uses
`Agents.use(Agent, handlers)` rather than constructing a separate
`implementAgent(...).install()` value first. The lower-level
`implementAgent()` helper remains for transport/server internals
such as protocol-server wiring.

See `packages/agent/README.md` for the runtime-facing facade API
and middleware examples.

## Running the Demo

```sh
pnpm dev
```

This runs `predev` (compiles TypeScript, builds browser bundle) then
`tsn run src/workflow.ts -e dev`.

The workflow module configures three agents, a memory journal, and a dev
entrypoint with a WebSocket server serving the browser bundle.

## Session Behavior

- First browser to connect becomes the owner
- Owner can submit messages; non-owners get read-only view
- Browser disconnect is non-fatal: the workflow stays blocked on `elicit`
  across disconnects and resumes when the same browser reconnects
- On connect/reconnect, the App agent sends `loadChat` with accumulated state
- On cold restart, the workflow loads prior history from `DB()` and pushes it
  to the browser via `loadChat`

## Test Strategy

### 1. Compiler and local agent interaction

- compile the workflow
- install local App, LLM, and DB agent stubs
- assert the full call sequence: loadMessages, loadChat, elicit, appendMessage,
  sample, appendMessage, showAssistantMessage

### 2. Worker LLM integration

- the workflow calls the LLM agent through `workerTransport()`
- the Worker result flows back into browser display behavior

### 3. Session manager reconnect semantics

- `elicit` suspension and resolution
- disconnect/reconnect continuation
- identity-safe detach
- non-owner read-only view
- `loadChat` state management

### 4. Full end-to-end

- session manager + worker LLM + compiled workflow
- simulated browser WebSocket client
- multi-turn chat completion

## Acceptance Criteria

The demo is complete when all of the following are true:

- `host.ts` is deleted
- `pnpm dev` runs `tsn run src/workflow.ts -e dev`
- the workflow loads chat from `DB()` on startup
- the workflow calls `App().loadChat(messages)` to populate the browser
- new user messages persist through `DB().appendMessage()`
- new assistant messages persist through `DB().appendMessage()`
- browser receives `loadChat` on connect
- browser receives `elicit` when workflow requests input
- browser disconnect/reconnect delivers accumulated chat state
- non-owner browser receives `loadChat` + `setReadOnly`
- cold restart: chat history survives (read from JSON file)
- the compiler is used for the workflow
- there is no agent-to-agent communication
- all existing tests pass with updated contracts
