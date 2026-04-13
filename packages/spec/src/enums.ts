// String-backed enums per §4.4 of spec-system-specification.source.md.
// Values are the JSON-stable string backing required by A8.

export enum Status {
  Draft = "draft",
  Active = "active",
  Superseded = "superseded",
}

export enum Strength {
  MUST = "MUST",
  MUST_NOT = "MUST NOT",
  SHOULD = "SHOULD",
  SHOULD_NOT = "SHOULD NOT",
  MAY = "MAY",
}

export enum Tier {
  Core = "core",
  Extended = "extended",
  Draft = "draft",
}

export enum EvidenceTier {
  Normative = "normative",
  Harness = "harness",
}

export enum ChangeType {
  Added = "added",
  Modified = "modified",
  Removed = "removed",
}

export enum Resolution {
  Resolved = "resolved",
  Deferred = "deferred",
  Unresolved = "unresolved",
}
