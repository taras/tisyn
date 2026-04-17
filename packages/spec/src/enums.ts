// v2 enum const arrays per §4 of tisyn-spec-system-specification.source.md.
// Exposed as `as const` readonly tuples; their element types are the canonical
// union types used across the type surface.

// §4.3 SpecModule.status
export const SPEC_STATUS = ["draft", "active", "superseded"] as const;
export type SpecStatus = (typeof SPEC_STATUS)[number];

// §4.5 Rule.level — the five RFC 2119 levels.
export const RULE_LEVELS = ["must", "must-not", "should", "should-not", "may"] as const;
export type RuleLevel = (typeof RULE_LEVELS)[number];

// §4.7 Relationship.type
export const RELATIONSHIP_TYPES = [
  "complements",
  "depends-on",
  "amends",
  "extends",
  "implements",
  "superseded-by",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

// §4.8 OpenQuestion.status
export const OPEN_QUESTION_STATUS = ["open", "resolved", "deferred"] as const;
export type OpenQuestionStatus = (typeof OPEN_QUESTION_STATUS)[number];

// §4.16 CoverageEntry.status
export const COVERAGE_STATUS = ["covered", "uncovered", "deferred"] as const;
export type CoverageStatus = (typeof COVERAGE_STATUS)[number];

// §4.15 TestCase.priority
export const TEST_PRIORITY = ["p0", "p1", "deferred"] as const;
export type TestPriority = (typeof TEST_PRIORITY)[number];

// §4.15 TestCase.type
export const TEST_TYPE = ["unit", "integration", "e2e"] as const;
export type TestType = (typeof TEST_TYPE)[number];
