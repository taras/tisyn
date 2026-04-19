export { operation } from "./operation.js";
export { agent } from "./agent.js";
export { implementAgent } from "./implementation.js";
export { useAgent } from "./use-agent.js";
export { Agents } from "./agents.js";
export type { AgentHandle } from "./use-agent.js";
export type { AgentFacade } from "./facade.js";
export { resource, provide } from "./workflow.js";
export type {
  OperationSpec,
  AgentDeclaration,
  AgentCalls,
  DeclaredAgent,
  AgentImplementation,
  ImplementationHandlers,
  ArgsOf,
  ResultOf,
  Workflow,
} from "./types.js";

// ── Dispatch-boundary surface — moved to @tisyn/effects (Issue #113) ──
// These re-exports preserve source-compatibility for one release cycle.
// New code should import from `@tisyn/effects` directly. The re-exports
// will be removed in a subsequent release.

/** @deprecated Import from `@tisyn/effects`. */
export { Effects } from "@tisyn/effects";
/** @deprecated Import from `@tisyn/effects`. */
export { dispatch } from "@tisyn/effects";
/** @deprecated Import from `@tisyn/effects`. */
export { resolve } from "@tisyn/effects";
/** @deprecated Import from `@tisyn/effects`. */
export { invoke } from "@tisyn/effects";
/** @deprecated Import from `@tisyn/effects`. */
export { installCrossBoundaryMiddleware } from "@tisyn/effects";
/** @deprecated Import from `@tisyn/effects`. */
export { getCrossBoundaryMiddleware } from "@tisyn/effects";
/** @deprecated Import from `@tisyn/effects`. */
export { InvalidInvokeCallSiteError } from "@tisyn/effects";
/** @deprecated Import from `@tisyn/effects`. */
export { InvalidInvokeInputError } from "@tisyn/effects";
/** @deprecated Import from `@tisyn/effects`. */
export { InvalidInvokeOptionError } from "@tisyn/effects";
/** @deprecated Import from `@tisyn/effects`. */
export type { InvokeOpts, ScopedEffectFrame } from "@tisyn/effects";
