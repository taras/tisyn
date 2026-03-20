/**
 * Transport interface for remote agent communication.
 *
 * A transport handles dispatching operations to a remote agent
 * and returning the result.
 */

import type { Operation } from "effection";
import type { Val } from "@tisyn/shared";

export interface Transport {
  dispatch(operation: string, args: Val): Operation<Val>;
}
