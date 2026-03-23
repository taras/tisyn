import type { Operation } from "effection";

/** Type-level operation spec — phantom types for Args and Result. */
export interface OperationSpec<Args = unknown, Result = unknown> {
  readonly __args?: Args;
  readonly __result?: Result;
}

/** Agent declaration — shared contract between host and agent. */
export interface AgentDeclaration<Ops extends Record<string, OperationSpec>> {
  readonly id: string;
  readonly operations: Ops;
}

/** Invocation data produced by host-side call methods. */
export interface Invocation<Args = unknown> {
  readonly effectId: string;
  readonly data: Args;
}

/** Infer the call signature for a declared operation. */
export type OperationCall<S extends OperationSpec> =
  S extends OperationSpec<infer Args, infer _Result> ? (args: Args) => Invocation<Args> : never;

/** Map all operations to their call signatures. */
export type AgentCalls<D extends AgentDeclaration<Record<string, OperationSpec>>> = {
  [K in keyof D["operations"]]: OperationCall<D["operations"][K]>;
};

/** Implementation handlers mapped from a declaration's operations. */
export type ImplementationHandlers<Ops extends Record<string, OperationSpec>> = {
  [K in keyof Ops]: Ops[K] extends OperationSpec<infer Args, infer Result>
    ? (args: Args) => Operation<Result>
    : never;
};

/** Extract the Args type from an OperationSpec. */
export type ArgsOf<S extends OperationSpec> =
  S extends OperationSpec<infer Args, any> ? Args : never;

/** Extract the Result type from an OperationSpec. */
export type ResultOf<S extends OperationSpec> =
  S extends OperationSpec<any, infer Result> ? Result : never;

/** An implemented agent, ready for middleware installation or direct execution. */
export interface AgentImplementation<Ops extends Record<string, OperationSpec>> {
  readonly id: string;
  readonly handlers: ImplementationHandlers<Ops>;
  /** Install this agent's dispatch middleware into the current scope. */
  install(): Operation<void>;
  /** Call a bound operation directly with typed args and result. */
  call<K extends keyof Ops & string>(
    name: K,
    args: ArgsOf<Ops[K]>,
  ): Operation<ResultOf<Ops[K]>>;
}
