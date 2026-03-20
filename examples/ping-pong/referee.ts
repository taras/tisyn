/**
 * Referee workflow — orchestrates a ping-pong rally between two players.
 *
 * The workflow:
 * 1. Player A serves (player-a.hit with initial ball)
 * 2. Player B returns (player-b.hit with result)
 * 3. Repeat for N rallies
 * 4. Return final score
 *
 * Expressed as Tisyn IR.
 */

import type { Expr } from "@tisyn/shared";

/**
 * Helper to build a Quote-wrapped eval node.
 */
function Q(expr: unknown): { tisyn: "quote"; expr: unknown } {
  return { tisyn: "quote", expr };
}

function Eval(id: string, data: unknown): { tisyn: "eval"; id: string; data: unknown } {
  return { tisyn: "eval", id, data };
}

function Ref(name: string): { tisyn: "ref"; name: string } {
  return { tisyn: "ref", name };
}

/**
 * Build the referee IR for a game with `rallies` exchanges.
 *
 * Since Tisyn uses immutable environments (no mutable state),
 * we unroll the rallies into a sequence of let-bindings:
 *
 *   let ball = "ping"
 *   let ball = player-a.hit(ball)   // rally 1
 *   let ball = player-b.hit(ball)
 *   let ball = player-a.hit(ball)   // rally 2
 *   let ball = player-b.hit(ball)
 *   ...
 *   rallies  // return the count
 */
export function refereeIR(rallies: number): Expr {
  // Build from inside out: the innermost expression returns the score
  let body: unknown = rallies;

  // Build rallies in reverse order (inside out)
  for (let i = rallies - 1; i >= 0; i--) {
    // Player B returns
    body = Eval("let", Q({
      name: "ball",
      value: Eval("player-b.hit", Ref("ball")),
      body,
    }));

    // Player A hits
    body = Eval("let", Q({
      name: "ball",
      value: Eval("player-a.hit", Ref("ball")),
      body,
    }));
  }

  // Initial ball
  return Eval("let", Q({
    name: "ball",
    value: "ping",
    body,
  })) as Expr;
}
