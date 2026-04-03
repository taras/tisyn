# Multi-Agent Chat Demo

## Summary

This demo proves that Tisyn can coordinate a host-controlled chat loop across
multiple boundaries:

- browser interaction crosses a WebSocket-backed browser agent boundary
- the host owns the chat loop
- the host calls a Worker-backed LLM agent to sample responses
- the compiler is used to author the host workflow

This is not an autonomous multi-agent system. Agents do not talk to each
other. The host is the only orchestrator.

The browser-facing contract in this demo is example-specific. It should not be
read as the canonical generic browser transport contract for Tisyn. The
generic transport-level browser contract is specified separately in
`specs/tisyn-browser-contract-specification.md` and is intentionally narrower.

## Goals

The demo should prove all of the following:

- the host can explicitly request user input from the browser through an agent
  boundary
- the browser can return the user's response as the result of that request
- the host can call an LLM agent in a Worker with `sample(...)`
- the host can send assistant output back to the browser through the browser
  agent
- the host loop can be expressed through the compiler rather than only through
  hand-written IR or direct TypeScript orchestration

## Non-Goals

Version 1 does not attempt any of the following:

- direct agent-to-agent communication
- browser-owned orchestration
- token streaming
- durable persistence across refresh or restart
- tool-calling graphs or planner/executor architectures
- a specific local-model runtime in the Worker

## Topology

```text
+-------------------+      WebSocket       +------------------------+
| Browser UI        | <------------------> | Browser Agent Gateway  |
| - transcript      |                      | - browser boundary     |
| - input box       |                      | - request/response     |
| - send button     |                      +-----------+------------+
+-------------------+                                  |
                                                       |
                                            typed agent operations
                                                       |
                                                       v
                                          +------------+------------+
                                          | Server Host             |
                                          | - owns the loop         |
                                          | - compiled workflow     |
                                          | - coordinates agents    |
                                          +------------+------------+
                                                       |
                                               worker transport
                                                       |
                                                       v
                                          +------------+------------+
                                          | Worker LLM Agent        |
                                          | - sample(...)           |
                                          | - isolated inference    |
                                          +-------------------------+
```

Control flow for one cycle:

1. host asks the browser agent to elicit input
2. browser renders the request and waits for the user
3. browser returns the user's response to the host
4. host calls the Worker LLM agent to sample a reply
5. host asks the browser agent to display the assistant output
6. repeat

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

### Browser Agent Gateway

The browser gateway is a real agent boundary between the host and the browser.

For this demo, the gateway exposes app-specific operations like
`waitForUser(...)` and `showAssistantMessage(...)`. Those are not intended to
be the generic reusable browser transport API for Tisyn as a whole.

It owns:

- translating host requests into UI actions
- waiting for browser user input when the host asks for it
- returning the user's response to the host
- displaying assistant output when the host sends it

It does not own:

- the conversation loop
- LLM prompting
- conversation state decisions
- direct communication with the Worker agent

### Server Host

The host is the control plane for the demo.

It owns:

- the chat loop
- execution of the compiled workflow
- coordination between Browser and LLM agents
- conversation state
- error handling for this demo

It is the only orchestrator.

### Worker LLM Agent

The Worker agent is an isolated inference boundary.

It owns:

- receiving prompt/context from the host
- returning one complete assistant response

It does not own:

- the chat loop
- browser interaction
- session state
- communication with the browser agent

The inference backend is intentionally pluggable in this spec. The important
contract is the typed agent boundary, not the backend behind it.

## Host Workflow Design

The host workflow is the heart of the demo.

Semantically, it should model this loop:

1. elicit input from the browser
2. sample the LLM agent
3. display the assistant output in the browser
4. repeat

Recommended source shape:

```ts
function* chat(): Workflow<void> {
  while (true) {
    const user = yield* Browser().waitForUser({
      prompt: "Say something",
    });

    const assistant = yield* LLM().sample({
      history: [],
      message: user.message,
    });

    yield* Browser().showAssistantMessage({
      message: assistant.message,
    });
  }
}
```

The exact message/state shapes may vary, but this control flow is the intended
architecture.

## Compiler Role

The compiler should be used for the host workflow rather than only for a tiny
subroutine.

The implementation may still keep surrounding bootstrapping and server setup in
ordinary TypeScript, but the core host logic should be compiler-authored.

If the compiler subset forces a narrower shape, that constraint should be
documented explicitly in the implementation plan and reflected back here.

## Agent Contracts

### Browser agent

Use explicit browser-facing operations rather than generic socket plumbing.

Recommended contract:

```ts
Browser().waitForUser(input: {
  prompt?: string;
}): { message: string }

Browser().showAssistantMessage(input: {
  message: string;
}): void
```

Semantics:

- `waitForUser(...)` renders any prompt and resolves only when the browser user
  submits input
- `showAssistantMessage(...)` displays the assistant output and completes once
  the browser has accepted it for rendering

### LLM agent

Keep the Worker contract narrow.

Recommended contract:

```ts
LLM().sample(input: {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  message: string;
}): { message: string }
```

Replies are whole-message, not streaming.

## Conversation State

Version 1 may keep conversation state in memory on the host.

Recommended shape:

```ts
type ChatEntry = {
  role: "user" | "assistant";
  content: string;
};

type SessionState = {
  sessionId: string;
  history: ChatEntry[];
  status: "idle" | "waiting" | "responding" | "error";
  lastError?: string;
};
```

The host owns this state. Agents do not own canonical session state.

## UX Behavior

The browser UI should stay minimal:

- transcript area
- single input box
- send button
- pending indicator while the host is waiting
- disconnected/error indicator when transport fails

The UI exists to make the architecture visible, not to demonstrate product
polish.

## Failure Behavior

Version 1 failure behavior is explicit and simple.

- If `LLM().sample(...)` fails, the host sends a friendly error message through
  the browser agent and marks the session state as `error`
- If the WebSocket connection fails, the browser shows a disconnected state and
  stops submitting until reconnect
- There are no hidden retries unless deliberately added later

## Test Strategy

Validation should happen in stages.

### 1. Compiler and local agent interaction

Before browser or Worker wiring:

- compile the host workflow
- install local Browser and LLM agent implementations
- assert:
  - the host asks the browser for input
  - the user's response feeds into `LLM().sample(...)`
  - the browser receives the assistant output

### 2. Worker LLM integration

Then prove:

- the host can call the LLM agent through `workerTransport()`
- the Worker result flows back into browser display behavior

### 3. WebSocket browser gateway integration

Then prove:

- host `waitForUser(...)` requests are rendered to the browser
- browser submissions resolve the host-side browser agent call
- host `showAssistantMessage(...)` results reach the browser UI

### 4. Full end-to-end demo

Finally prove:

- the host loop runs
- browser input is elicited by the host
- Worker LLM is sampled by the host
- assistant output is displayed back in the browser

## Acceptance Criteria

The demo is complete when all of the following are true:

- the host owns the loop
- the browser is exposed through a WebSocket-backed browser agent
- the Worker is exposed through an LLM agent
- the host alternates between browser elicitation and LLM sampling
- the compiler is used for the host workflow
- there is no agent-to-agent communication
- replies are returned as complete messages per turn
