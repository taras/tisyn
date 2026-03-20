/**
 * Worker transport adapter.
 *
 * Uses @effectionx/worker to dispatch operations to a worker thread
 * and receive results via the send/response protocol.
 */

import type { Operation } from "effection";
import { useWorker, type WorkerResource } from "@effectionx/worker";
import type { Val } from "@tisyn/shared";
import type { Transport } from "../transport.js";

/**
 * Message sent from host to worker for dispatch.
 */
export interface WorkerDispatchRequest {
  type: "dispatch";
  operation: string;
  args: Val;
}

/**
 * Response sent from worker to host.
 */
export interface WorkerDispatchResponse {
  status: "ok" | "err";
  value?: Val;
  error?: { name: string; message: string };
}

/**
 * Create a Worker transport that dispatches operations to a worker thread.
 *
 * The worker must use `workerTransport()` on its side to handle requests.
 */
export function worker(url: string | URL): Transport {
  type W = WorkerResource<WorkerDispatchRequest, WorkerDispatchResponse, void>;
  let workerResource: W | null = null;

  return {
    *dispatch(operation: string, args: Val): Operation<Val> {
      if (!workerResource) {
        workerResource = yield* useWorker<WorkerDispatchRequest, WorkerDispatchResponse, void, void>(
          url,
          { type: "module" },
        );
      }

      const request: WorkerDispatchRequest = {
        type: "dispatch",
        operation,
        args,
      };

      const response = yield* workerResource.send(request);

      if (response.status === "ok") {
        return response.value as Val;
      }

      const err = new Error(response.error?.message ?? "Worker agent error");
      if (response.error?.name) err.name = response.error.name;
      throw err;
    },
  };
}

/**
 * Worker-side transport handler. Call this from `workerMain()` to
 * serve an agent's handlers over the worker message channel.
 *
 * @param handler - The agent's operation handler
 * @returns An operation suitable for use inside workerMain's messages.forEach
 */
export function workerTransport(
  handler: (operation: string, args: Val) => Operation<Val>,
) {
  return {
    *handleRequest(request: WorkerDispatchRequest): Operation<WorkerDispatchResponse> {
      try {
        const value = yield* handler(request.operation, request.args);
        return { status: "ok" as const, value };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        return {
          status: "err" as const,
          error: { name: err.name, message: err.message },
        };
      }
    },
  };
}
