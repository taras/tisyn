/**
 * Dispatch API — middleware-based effect dispatch.
 *
 * Uses the createApi + around() pattern so that agents
 * can be composed as middleware layers.
 *
 * createApi is inlined from @effectionx/context-api to avoid a
 * worker-thread incompatibility: vitest v4 sets --conditions development,
 * which resolves to the package's TypeScript source, and Node cannot
 * type-strip .ts files inside node_modules.
 */

import { type Operation, createContext } from "effection";
import type { Val } from "@tisyn/ir";

// ---------------------------------------------------------------------------
// createApi — inlined from @effectionx/context-api v0.3.2
// ---------------------------------------------------------------------------

type Around<A> = {
  [K in keyof Operations<A>]: A[K] extends (...args: infer TArgs) => infer TReturn
    ? Middleware<TArgs, TReturn>
    : Middleware<[], A[K]>;
};

type Middleware<TArgs extends unknown[], TReturn> = (
  args: TArgs,
  next: (...args: TArgs) => TReturn,
) => TReturn;

interface Api<A> {
  operations: Operations<A>;
  around: (around: Partial<Around<A>>) => Operation<void>;
}

type Operations<T> = {
  [K in keyof T]: T[K] extends (...args: infer TArgs) => infer TReturn
    ? (...args: TArgs) => TReturn
    : T[K] extends Operation<infer TReturn>
      ? Operation<TReturn>
      : never;
};

function createApi<A extends {}>(name: string, handler: A): Api<A> {
  const fields = Object.keys(handler) as (keyof A)[];

  const defaultMiddleware: Around<A> = fields.reduce((sum, field) => {
    return Object.assign(sum, {
      // biome-ignore lint/suspicious/noExplicitAny: Dynamic middleware composition
      [field]: (args: any, next: any) => next(...args),
    });
  }, {} as Around<A>);

  const context = createContext<Around<A>>(`$api:${name}`, defaultMiddleware);

  const operations = fields.reduce((api, field) => {
    const handle = handler[field];
    if (typeof handle === "function") {
      return Object.assign(api, {
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic field types
        [field]: function* (...args: any[]) {
          const around = yield* context.expect();
          // biome-ignore lint/complexity/noBannedTypes: Dynamic middleware call
          const mw = around[field] as Function;
          return yield* mw(args, handle);
        },
      });
    }
    return Object.assign(api, {
      [field]: {
        *[Symbol.iterator]() {
          const around = yield* context.expect();
          // biome-ignore lint/complexity/noBannedTypes: Dynamic middleware call
          const mw = around[field] as Function;
          return yield* mw([], () => handle);
        },
      },
    });
  }, {} as Operations<A>);

  function* around(middlewares: Partial<Around<A>>): Operation<void> {
    const current = yield* context.expect();
    yield* context.set(
      fields.reduce(
        (sum, field) => {
          // biome-ignore lint/suspicious/noExplicitAny: Dynamic middleware types
          const prior = current[field] as Middleware<any[], any>;
          // biome-ignore lint/suspicious/noExplicitAny: Dynamic middleware types
          const mw = middlewares[field] as Middleware<any[], any>;
          return Object.assign(sum, {
            // biome-ignore lint/suspicious/noExplicitAny: Dynamic middleware composition
            [field]: (args: any, next: any) => mw(args, (...args) => prior(args, next)),
          });
        },
        Object.assign({}, current),
      ),
    );
  }

  return { operations, around };
}

// ---------------------------------------------------------------------------
// Dispatch API
// ---------------------------------------------------------------------------

export const Dispatch = createApi("Dispatch", {
  *dispatch(effectId: string, data: Val): Operation<Val> {
    throw new Error(`No agent registered for effect: ${effectId}`);
  },
});

export const { dispatch } = Dispatch.operations;
