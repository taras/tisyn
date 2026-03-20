/**
 * Ping-Pong Host — wires up two players and runs the referee.
 *
 * Demonstrates the middleware-based agent system:
 * - PlayerA and PlayerB install themselves as Dispatch middleware
 * - The referee IR dispatches effects through the Dispatch Api
 * - Each agent intercepts its own effects, passes others through
 *
 * Run: npx tsx examples/ping-pong/host.ts
 */

import { main } from "effection";
import { execute } from "@tisyn/runtime";
import { dispatch, Dispatch } from "@tisyn/agent";
import { PlayerA } from "./player-a.ts";
import { PlayerB } from "./player-b.ts";
import { refereeIR } from "./referee.ts";

const RALLIES = 3;

await main(function* () {
  // Add a logging middleware layer first (outermost — sees all dispatches)
  yield* Dispatch.around({
    *dispatch([effectId, data], next) {
      console.log(`[dispatch] ${effectId}`, JSON.stringify(data));
      const result = yield* next(effectId, data);
      console.log(`[result]   ${effectId} =>`, JSON.stringify(result));
      return result;
    },
  });

  // Install both players as Dispatch middleware.
  // Each player intercepts effects matching its agent ID
  // and passes everything else to the next middleware.
  yield* PlayerA.install();
  yield* PlayerB.install();

  console.log(`\nPing-Pong Game: ${RALLIES} rallies\n${"=".repeat(40)}\n`);

  // Execute the referee workflow, dispatching through the middleware stack
  const { result } = yield* execute({
    ir: refereeIR(RALLIES),
    dispatch,
  });

  console.log(`\n${"=".repeat(40)}`);
  if (result.status === "ok") {
    console.log(`Game over! Final score: ${result.value} rallies completed`);
  } else {
    console.log(`Game error:`, result);
  }
});
