/**
 * Player B — served over Worker.
 *
 * Runs inside a worker thread, handles dispatch requests by
 * hitting the ball back (appending "-ping" to the ball).
 */

import type { Operation } from "effection";
import type { Val } from "@tisyn/shared";
import { agent } from "@tisyn/agent";

export const PlayerB = agent("player-b", {
  *hit(ball: Val): Operation<Val> {
    const incoming = String(ball);
    console.log(`  Player B received: ${incoming}`);
    const response = incoming === "pong" ? "ping" : `${incoming}-ping`;
    console.log(`  Player B returns:  ${response}`);
    return response;
  },
});
