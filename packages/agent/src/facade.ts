/**
 * Per-agent operation-shaped Context API facade.
 *
 * Each agent declaration gets a backing `createApi()` with one operation
 * per declared agent operation. The core handler for each operation
 * delegates to `dispatch(\`${agentId}.${opName}\`, args)`.
 *
 * Middleware installed via `facade.around({ *opName(args, next) { ... } })`
 * composes structurally before the Effects chain — the facade layer calls
 * dispatch(), which enters the Effects middleware stack.
 */
import type { Operation } from "effection";
import { createContext } from "effection";
import type { Val } from "@tisyn/ir";
import type { Api } from "@effectionx/context-api";
import { createApi } from "@effectionx/context-api";
import type { AgentDeclaration, OperationSpec, ArgsOf, ResultOf } from "./types.js";
import { dispatch } from "./dispatch.js";

// ---------------------------------------------------------------------------
// AgentFacade type
// ---------------------------------------------------------------------------

/** Handler shape used by the backing Context API. */
type AgentApiHandler = Record<string, (args: Val) => Operation<Val>>;

/** Typed agent facade: per-operation methods + .around() from the backing API. */
export type AgentFacade<Ops extends Record<string, OperationSpec>> = {
  [K in keyof Ops]: (args: ArgsOf<Ops[K]>) => Operation<ResultOf<Ops[K]>>;
} & {
  /** Install per-operation middleware on this agent's backing Context API. */
  around: Api<AgentApiHandler>["around"];
};

// ---------------------------------------------------------------------------
// Per-declaration context registry (shape-safe construction only)
//
// The WeakMap maps declaration object references to their createContext.
// No middleware state lives here — that's scope-local via the Api's
// internal context. Two declaration objects with the same ID but different
// operations get separate WeakMap entries and cannot alias.
// ---------------------------------------------------------------------------

const declarationContexts = new WeakMap<
  AgentDeclaration<Record<string, OperationSpec>>,
  ReturnType<typeof createContext<Api<AgentApiHandler> | null>>
>();

// ---------------------------------------------------------------------------
// Construction helper
// ---------------------------------------------------------------------------

/**
 * Build an operation-shaped Context API for an agent declaration.
 *
 * Pure function — the returned Api is stateless (all middleware state
 * lives in Effection scope contexts via collectMiddleware).
 */
function createAgentApi(
  declaration: AgentDeclaration<Record<string, OperationSpec>>,
): Api<AgentApiHandler> {
  const { id } = declaration;
  const handler: AgentApiHandler = {};

  for (const name of Object.keys(declaration.operations)) {
    handler[name] = function* (args: Val): Operation<Val> {
      return yield* dispatch(`${id}.${name}`, args);
    };
  }

  return createApi(`agent:${id}`, handler);
}

// ---------------------------------------------------------------------------
// Scope-local get-or-create
// ---------------------------------------------------------------------------

/**
 * Retrieve (or create) the per-agent backing Api for this declaration
 * in the current scope. Subsequent calls with the same declaration
 * reference in the same scope return the same Api, sharing middleware
 * visibility.
 */
export function* getOrCreateAgentApi(
  declaration: AgentDeclaration<Record<string, OperationSpec>>,
): Operation<Api<AgentApiHandler>> {
  let ctx = declarationContexts.get(declaration);
  if (!ctx) {
    ctx = createContext<Api<AgentApiHandler> | null>(`$agent-facade:${declaration.id}`, null);
    declarationContexts.set(declaration, ctx);
  }

  const existing = yield* ctx.get();
  if (existing) {
    return existing;
  }

  const api = createAgentApi(declaration);
  yield* ctx.set(api);
  return api;
}

// ---------------------------------------------------------------------------
// Facade builder
// ---------------------------------------------------------------------------

/**
 * Build a typed AgentFacade from a backing Api and declaration.
 */
export function buildFacade<Ops extends Record<string, OperationSpec>>(
  api: Api<AgentApiHandler>,
  declaration: AgentDeclaration<Ops>,
): AgentFacade<Ops> {
  const facade = {} as AgentFacade<Ops>;

  for (const name of Object.keys(declaration.operations) as (keyof Ops & string)[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (facade as any)[name] = (args: unknown): Operation<unknown> =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (api.operations as any)[name](args as Val);
  }

  // Attach the backing Api's around method directly
  facade.around = api.around;

  return facade;
}
