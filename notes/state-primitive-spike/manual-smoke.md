# State Primitive Spike — Manual Browser Smoke

This document captures the steps for the manual browser-side smoke test
that the spike's automated suite cannot exercise (it requires a real
browser session and the `pnpm dev` host process). Run from
`worktrees/state-primitive-spike/examples/deterministic-peer-loop`.

## Goal

Confirm end-to-end that:

1. A live host run accepts a Taras message → runs a peer turn →
   the browser observes the resulting transcript and control updates
   via the authority subscription (no `App.hydrate` op anywhere).
2. After killing the host, restarting reads the journal at startup,
   seeds the authority via `state-agent.transition` events, and a
   freshly-attached browser sees identical state.
3. Authority subscription on first session attach delivers the
   current snapshot without a per-iteration workflow push.

## Prerequisites

```sh
cd worktrees/state-primitive-spike
pnpm install
```

## Steps

1. **Reset journal**
   ```sh
   rm -f examples/deterministic-peer-loop/data/peer-loop.ndjson
   ```

2. **Boot host + browser dev servers** (two terminals)
   ```sh
   # terminal A
   cd examples/deterministic-peer-loop
   pnpm dev

   # terminal B
   cd examples/deterministic-peer-loop/browser
   pnpm dev:browser
   ```

3. **Attach owner browser** — open the URL printed by
   `pnpm dev:browser`, click "attach", confirm the empty transcript
   and default control panel render.

4. **Drive a peer turn**
   - Submit one Taras message ("hi").
   - Wait for one peer turn (Opus or GPT, depending on default
     alternation).
   - Confirm: transcript shows Taras + peer entries; control panel
     reflects current loop state; no console errors.

5. **Inspect the journal** (optional, for evidence)
   ```sh
   tail -n 5 examples/deterministic-peer-loop/data/peer-loop.ndjson | jq .
   ```
   Expect: yield events with `description.type == "state-agent"` and
   `description.name in {"readInitialState", "transition"}`. No
   `description.type == "projection"` and no `description.name == "hydrate"`.

6. **Kill the host** — Ctrl-C in terminal A.

7. **Restart host**
   ```sh
   # terminal A
   cd examples/deterministic-peer-loop
   pnpm dev
   ```
   Expect: host startup reads the journal, seeds the authority via
   the recorded `state-agent.transition` events. No errors logged.

8. **Re-attach browser** — refresh terminal B's browser tab, attach
   again.

9. **Confirm replay-equivalent state**
   - Transcript: identical to step 4.
   - Control panel: identical loop control (paused, stopRequested,
     nextSpeakerOverride, etc.).
   - Read-only banner (if applicable): identical reason.

## Pass criteria

All 9 steps complete with the post-restart browser observing the
exact pre-restart state. No code changes between the two runs.

## Fail modes

- **Empty transcript after restart** → authority seed failed. Check
  `main.ts:journalPath` and the `description.type` filter
  (`"state-agent"`, not `"__state"` or `"projection"`).
- **Browser sees stale state on first attach** → on-attach push not
  installed. Verify `browser-agent.ts:createBinding()` calls
  `session.applySnapshot(authority.getState())` on attach.
- **Per-iteration browser updates missing** → authority subscription
  not installed. Verify `browser-agent.ts:createBinding()` calls
  `authority.subscribe(snapshot => session.applySnapshot(snapshot))`.

## Out of scope for this manual test

- Multi-browser observers (the authority supports it; not exercised).
- Replay-bypass under host restart (covered automatically in
  `state-replay.test.ts`).
- Concurrent browser writes (the existing `App.elicit` /
  `App.nextControlPatch` ingress channels are unchanged by the
  spike).
