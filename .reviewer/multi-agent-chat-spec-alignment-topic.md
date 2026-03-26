Topic to revisit: multi-agent chat spec vs implementation alignment

Current state:

- PR #27 is functionally close to the intended demo
- the example type-checks cleanly
- the compiler `while` Case A binding bug is fixed
- the dummy `if (false) { return; }` workaround is gone
- browser is WebSocket-backed, LLM is Worker-backed, and the host remains the sole orchestrator

Remaining follow-up:

- do a final spec-alignment pass against `examples/multi-agent-chat.md`
- make sure the browser boundary is explained clearly as a host-facing interaction boundary
- make sure the `waitForUser` / `showAssistantMessage` split is documented as the concrete realization of the intended `elicit` semantics
- remove any stale comments or naming that still reflect older architecture/workarounds
- confirm whether there are any remaining material deltas between the spec and implementation, or declare it aligned enough for v1

Preferred scope:

- polish/alignment only
- no architectural redesign
- no new major features
- no agent-to-agent communication
