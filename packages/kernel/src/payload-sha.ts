import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Json } from "@tisyn/ir";
import { canonical } from "./canonical.js";

export function payloadSha(value: Json): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonical(value))));
}
