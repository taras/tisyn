import { Value } from "@sinclair/typebox/value";
import { PeerTurnResultSchema, type PeerTurnResult } from "../schemas.js";

const FENCED = /^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/;

export class PeerResultParseError extends Error {
  readonly name = "PeerResultParseError";
  constructor(
    message: string,
    public readonly raw: string,
  ) {
    super(message);
  }
}

export function parsePeerResult(raw: string): PeerTurnResult {
  let source = raw.trim();
  const fenced = source.match(FENCED);
  if (fenced && fenced[1]) {
    source = fenced[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    throw new PeerResultParseError(
      `Peer response was not valid JSON: ${(err as Error).message}`,
      raw,
    );
  }

  if (!Value.Check(PeerTurnResultSchema, parsed)) {
    const errors = [...Value.Errors(PeerTurnResultSchema, parsed)];
    const detail = errors
      .slice(0, 5)
      .map((e) => `${e.path}: ${e.message}`)
      .join("; ");
    throw new PeerResultParseError(
      `Peer response did not match PeerTurnResult schema: ${detail}`,
      raw,
    );
  }

  return parsed as PeerTurnResult;
}

export function buildPeerPrompt(input: {
  transcript: ReadonlyArray<{ speaker: string; content: string }>;
  tarasMode: "optional" | "required";
  peerName: "opus" | "gpt";
}): string {
  const lines: string[] = [];
  lines.push(
    `You are ${input.peerName.toUpperCase()}, one of two AI peers collaborating with Taras.`,
  );
  lines.push("");
  lines.push("You will receive the full transcript so far. Your job is to take one turn.");
  lines.push("");
  lines.push(
    "Respond with exactly one JSON object matching this TypeScript shape — nothing else, no surrounding prose, no code fences:",
  );
  lines.push("");
  lines.push(
    '{ "display": string, "status": "continue" | "needs_taras" | "done", "data"?: JSON, "requestedEffects"?: Array<{ id: string, input: JSON }>, "usage"?: object }',
  );
  lines.push("");
  lines.push(
    `The next Taras gate is "${input.tarasMode}". If "optional", you may choose to continue without input; if "required", Taras will be asked before the next peer step.`,
  );
  lines.push("");
  lines.push('Use status = "needs_taras" to require Taras input next cycle.');
  lines.push('Use status = "done" only if the collaboration is finished.');
  lines.push('Use status = "continue" to keep the loop running.');
  lines.push("");
  lines.push("---");
  lines.push("Transcript (oldest first):");
  for (const entry of input.transcript) {
    lines.push(`[${entry.speaker}] ${entry.content}`);
  }
  lines.push("---");
  lines.push("");
  lines.push("Respond now with exactly one JSON object.");
  return lines.join("\n");
}
