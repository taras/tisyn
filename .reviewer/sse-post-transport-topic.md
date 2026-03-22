Topic to revisit: SSE + POST transport

Why:
- The specs explicitly list SSE + POST as a supported transport binding.
- Current transport planning discussion has focused on inprocess, stdio, websocket, and worker.
- SSE + POST still needs to be accounted for in the transport roadmap.

What to resolve later:
- whether SSE + POST is part of the first transport wave or a later follow-up
- framing and connection model for asymmetric transport
- how progress and cancel behave over SSE down / POST up
- whether the protocol adapter can stay fully transport-agnostic with this asymmetric binding

Current note:
- Do not lose SSE + POST from the transport scope just because the immediate implementation focus is on inprocess first.
