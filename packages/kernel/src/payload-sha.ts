import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import type { Json } from "@tisyn/ir";
import { canonical } from "./canonical.js";

/**
 * Deterministic, isomorphic payload fingerprint.
 *
 * Returns `bytesToHex(sha256(utf8(canonical(data))))` — a lower-case hex
 * string of the SHA-256 digest of the UTF-8 canonical JSON serialization of
 * `data`. Synchronous; works in both Node and browser runtimes because
 * `@noble/hashes` is isomorphic and tree-shakable.
 *
 * Used by the runtime's replay divergence check (see
 * `tisyn-scoped-effects-specification.md` §9.5). Written at
 * `YieldEvent.description.sha` at dispatch time; compared at replay time
 * against the fingerprint of the currently dispatched payload. Mismatch
 * raises `DivergenceError`; absent stored `sha` (legacy journal entry)
 * skips the payload check for that single entry.
 */
export function payloadSha(data: Json): string {
  const encoder = new TextEncoder();
  return bytesToHex(sha256(encoder.encode(canonical(data))));
}
