import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Json } from "@tisyn/ir";
import { canonical } from "./canonical.js";

export function payloadSha(value: Json): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonical(value))));
}

/**
 * Compute a self-consistent durable payload identity from a single snapshot.
 *
 * Both fields are derived from the same canonical encoding of `value`:
 *   - `input` is parsed back from the canonical string, so it is a fresh
 *     value graph with no live references into the caller's data. Subsequent
 *     in-place mutation of the original `value` cannot drift `input` or `sha`.
 *   - `sha` is `bytesToHex(sha256(utf8(canonical(value))))` over the same
 *     canonical encoding, so `sha === payloadSha(input)` always holds.
 *
 * Use this at every site that constructs an `EffectDescription` for journal
 * writes; the two-field shape is the load-bearing invariant that makes
 * payload-sensitive replay work (kernel §9.1, scoped-effects §9.5.3 / §9.5.5
 * / §9.5.8).
 */
export function payloadIdentity(value: Json): { input: Json; sha: string } {
  const encoded = canonical(value);
  return {
    input: JSON.parse(encoded) as Json,
    sha: bytesToHex(sha256(new TextEncoder().encode(encoded))),
  };
}
