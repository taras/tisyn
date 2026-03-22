import { Value } from "@sinclair/typebox/value";
import { HostMessageSchema, AgentMessageSchema } from "./schemas.js";
import type { HostMessage, AgentMessage } from "./types.js";

/**
 * Validate an already-parsed JS value as a HostMessage.
 * Throws on invalid structure.
 */
export function parseHostMessage(input: unknown): HostMessage {
  if (!Value.Check(HostMessageSchema, input)) {
    const errors = [...Value.Errors(HostMessageSchema, input)];
    const detail = errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`Invalid HostMessage: ${detail}`);
  }
  return input as HostMessage;
}

/**
 * Validate an already-parsed JS value as an AgentMessage.
 * Throws on invalid structure.
 */
export function parseAgentMessage(input: unknown): AgentMessage {
  if (!Value.Check(AgentMessageSchema, input)) {
    const errors = [...Value.Errors(AgentMessageSchema, input)];
    const detail = errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`Invalid AgentMessage: ${detail}`);
  }
  return input as AgentMessage;
}
