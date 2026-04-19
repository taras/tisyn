# Deterministic Peer Loop Example

This example packages the Tisyn deterministic peer loop reference MVP as a
private workspace package: `@tisyn/example-deterministic-peer-loop`.

It forks the earlier `multi-agent-chat` example into a three-speaker loop:

- `taras` provides human input through the browser
- `opus` takes turns through the Claude-backed peer binding
- `gpt` takes turns through the Codex-backed peer binding

The example persists transcript, loop control, peer records, and effect request
records to a single JSON file so reconnects and observer sessions can hydrate
from durable state.

## Prerequisites

Install workspace dependencies from the repo root:

```sh
pnpm install
```

Live peer turns require Claude and Codex credentials. The default test suite
does not require live credentials.

Claude auth:

```sh
npx @anthropic-ai/claude-code auth
```

Codex auth:

```sh
npm install -g @openai/codex
codex auth
```

## Location

Work from:

```sh
cd examples/deterministic-peer-loop
```

Main entrypoints:

- `src/workflow.ts` - authored workflow
- `browser/` - React client
- `src/browser-agent.ts` / `src/browser-session.ts` - browser transport and
  session hydration
- `src/db-agent.ts` / `src/store.ts` - JSON-backed persistence
- `src/peers/` - Opus and GPT bindings
- `src/effects/` - effect policy, queue, and handler bindings

## Build

Generate workflow IR:

```sh
pnpm build:workflow
```

Build the Node side:

```sh
pnpm build:node
```

Build the browser bundle:

```sh
pnpm build:browser
```

Build workflow + Node together:

```sh
pnpm build
```

## Run Locally

Use two terminals.

Terminal 1 starts the workflow host and websocket server:

```sh
pnpm dev
```

Terminal 2 starts Vite for the browser UI:

```sh
pnpm dev:browser
```

Then open:

```text
http://localhost:4173
```

Default local ports:

- workflow websocket server: `3000`
- Vite dev server: `4173`

The Vite config proxies websocket traffic to port `3000`. If you change
`PORT`, the default browser dev flow will no longer line up unless you also
update `vite.config.ts`.

## Environment

Supported environment variables:

- `PORT`
  Default: `3000`
  Controls the workflow websocket server started by `pnpm dev`.
- `PEER_LOOP_DB_PATH`
  Default: `./data/peer-loop.json`
  Controls the persisted JSON state file.

The persisted store contains:

- `messages`
- `control`
- `peerRecords`
- `effectRequests`

To reset local state, stop the dev server and remove the JSON file at
`PEER_LOOP_DB_PATH`.

## Using the Example

The first browser tab to connect becomes the owner session. Later tabs connect
as observers.

Owner behavior:

- can answer Taras prompts
- can use the control panel
- sees live transcript and control updates

Observer behavior:

- sees live transcript and control updates
- remains read-only for the session

Control panel:

- `paused` prevents the next peer step
- `stopRequested` stops the loop and flips the UI into read-only mode
- `nextSpeakerOverride` forces the next peer turn to `opus` or `gpt`, then
  clears back to automatic alternation

Taras gate behavior:

- in `optional` mode, the loop waits briefly for human input and can continue
  without it
- in `required` mode, Taras input is required before the next peer step

## Tests

Run the example test suite:

```sh
pnpm test
```

This covers the scripted conformance and unit tests and does not require live
credentials.

Browser test commands are present:

```sh
pnpm test:browser
```

But browser test coverage is still tracked as follow-up work in the current PR,
so treat it as in-progress rather than the stable default verification path for
this example.

## Notes on Live Peers

The peer bindings use one fresh backend session per turn:

- Opus defaults to model `claude-sonnet-4-6` and `permissionMode: "plan"`
- GPT defaults to Codex `sandbox: "read-only"` and `approval: "never"`

Peer output is parsed as strict JSON and validated with TypeBox before it can
affect workflow control flow.

## Current Scope

This example is the reference MVP, not the final full-surface implementation.

Current limits:

- Core coverage is partial relative to the longer-term full test-plan target
- live-adapter smoke behavior is credential-dependent
- browser test coverage is still being finished separately
- effect execution is example-local through the policy, queue, and handler
  bindings
