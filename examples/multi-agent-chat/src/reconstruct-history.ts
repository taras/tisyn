/**
 * Reconstruct chat history from durable journal events.
 *
 * Scans yield events for chat.elicit (user message) and
 * llm.sample (assistant message) pairs. Only complete pairs are
 * included; trailing unmatched events are ignored.
 */

import type { DurableEvent } from "@tisyn/kernel";

export function reconstructHistory(
  events: DurableEvent[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  let pendingUserMessage: string | null = null;

  for (const event of events) {
    if (event.type !== "yield") continue;
    if (event.result.status !== "ok") continue;

    const { type, name } = event.description;
    const value = event.result.value as Record<string, unknown> | null;

    if (type === "chat" && name === "elicit" && value) {
      pendingUserMessage = value.message as string;
    } else if (type === "llm" && name === "sample" && value && pendingUserMessage !== null) {
      history.push(
        { role: "user", content: pendingUserMessage },
        { role: "assistant", content: value.message as string },
      );
      pendingUserMessage = null;
    }
  }

  return history;
}
