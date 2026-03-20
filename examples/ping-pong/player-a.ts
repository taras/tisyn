/**
 * Player A — served over WebSocket.
 *
 * Listens for dispatch requests on a WebSocket server and responds
 * by hitting the ball back (appending "-pong" to the ball).
 */

/// <reference lib="dom" />

// In a real setup, this would run as a standalone WebSocket server process.
// For the demo, we define the agent and its serve logic.

import type { Operation } from "effection";
import type { Val } from "@tisyn/shared";
import { agent } from "@tisyn/agent";

export const PlayerA = agent("player-a", {
  *hit(ball: Val): Operation<Val> {
    const incoming = String(ball);
    console.log(`  Player A received: ${incoming}`);
    const response = incoming === "ping" ? "pong" : `${incoming}-pong`;
    console.log(`  Player A returns:  ${response}`);
    return response;
  },
});
