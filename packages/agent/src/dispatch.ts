/**
 * Dispatch Api — middleware-based effect dispatch.
 *
 * Uses effection's createApi + around() pattern so that agents
 * can be composed as middleware layers.
 */

import type { Operation } from "effection";
import { createApi } from "effection/experimental";
import type { Val } from "@tisyn/shared";

export const Dispatch = createApi("Dispatch", {
  *dispatch(effectId: string, data: Val): Operation<Val> {
    throw new Error(`No agent registered for effect: ${effectId}`);
  },
});

export const { dispatch } = Dispatch.operations;