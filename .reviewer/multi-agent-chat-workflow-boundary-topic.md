Topic to revisit: multi-agent chat workflow boundary and test surface

Current assessment:

- the demo proves typed agent boundaries and compiler-authored orchestration
- the host still carries too much application policy relative to the workflow
- the current test surface is too coupled to websocket/session internals

Workflow-boundary concerns:

- browser hydration, read-only transitions, and pending-prompt recovery are mostly host/session-driven
- conversation policy is too thin in the compiled workflow to make Tisyn feel central
- the host reads as the real program, while the workflow reads as a narrow subroutine

Testing direction:

- prefer Playwright as the primary acceptance layer for the demo
- keep low-level tests only for pure logic and transport invariants that are hard to observe through the UI
- optimize for refactor safety around browser transport, session internals, and host orchestration

Preferred scope:

- move application/session policy toward explicit workflow and agent operations
- keep process startup, transport installation, and resource lifetime in the host
- replace implementation-shaped example tests with browser-visible behavior tests
