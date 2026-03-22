Topic to revisit: UI-embedded agents

Discussion seed:

- Treat a UI-embedded agent as another agent runtime boundary with UI-local capabilities.
- Example UI capabilities: `ui.navigate`, `ui.showToast`, `ui.readForm`, `ui.setDraft`, `ui.openModal`.
- Shared `agent(...)` declaration remains the contract.
- UI framework installs implementations into contextual middleware.
- Tisyn can orchestrate UI and backend capabilities together.

Questions to revisit:

- local-only UI runtime vs receiving programs over the wire
- imperative UI effects vs state-transition-oriented effects
- cancellation semantics on unmount/navigation
- whether replay means anything in a UI runtime
- framework-specific shape, especially React hooks/component integration

Suggested next discussion:

- sketch a React-oriented API with hooks and component/runtime boundaries
