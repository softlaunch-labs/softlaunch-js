/**
 * @module types
 *
 * Config blob wire format.
 *
 * This is the contract between the compiler (dashboard) and every SDK.
 * Changes here are breaking changes across all clients.
 *
 * Two formats exist:
 *   "server" — plain text, used by server SDKs in trusted environments
 *   "client" — obfuscated (MD5 + base64), used by browser/mobile SDKs
 *
 * Evaluation order:
 *   1. Flag exists? → FLAG_NOT_FOUND
 *   2. Flag enabled? → OFF (returns offVariationId)
 *   3. Walk assignments (ordered, first match wins):
 *      a. Resolve rules (audience ref or inline)
 *      b. Match rules: OR between groups, AND within conditions
 *      c. If match: hash(assignmentId, subjectKey) → bucket
 *         → check shard ranges → return matched variation
 *         → if no range matches (outside traffic): next assignment
 *   4. Return defaultVariationId
 */

export const CURRENT_FORMAT_VERSION = 1;

// ---------------------------------------------------------------------------
// Config blob
// ---------------------------------------------------------------------------

export type ConfigFormat = "server" | "client";

export interface ConfigBlob {
  readonly formatVersion: number;
  readonly format: ConfigFormat;
  /** Environment ID this config was compiled for. */
  readonly environment: string;
  /** Monotonically increasing. Higher = newer. */
  readonly version: number;
  readonly generatedAt: number;
  /** All shard ranges in [0, totalShards). Default: 10_000. */
  readonly totalShards: number;
  /** Keyed by audience ID (or MD5 hash in client format). */
  readonly audiences: Readonly<Record<string, Audience>>;
  /** Keyed by flag key (or MD5 hash in client format). */
  readonly flags: Readonly<Record<string, Flag>>;
}

// ---------------------------------------------------------------------------
// Audiences
// ---------------------------------------------------------------------------

export interface Audience {
  /** OR between groups, AND within each group's conditions. */
  readonly rules: readonly RuleGroup[];
}

export interface RuleGroup {
  readonly conditions: readonly Condition[];
}

export interface Condition {
  /** Context attribute name (or MD5 hash in client format). */
  readonly attribute: string;
  /** Operator name (or MD5 hash in client format). */
  readonly operator: string;
  /**
   * ONE_OF / NOT_ONE_OF → string[]
   * GT / GTE / LT / LTE / MATCHES → string
   * IS_NULL / IS_NOT_NULL → null
   *
   * In client format: list values are MD5-hashed, scalars are base64-encoded.
   */
  readonly value: string | readonly string[] | null;
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export type FlagType = "boolean" | "string" | "integer" | "numeric" | "json";

export interface Flag {
  readonly type: string;
  readonly enabled: boolean;
  /** Keyed by variation ID (or base64 in client format). */
  readonly variations: Readonly<Record<string, FlagVariation>>;
  /** Variation ID returned when flag is disabled. */
  readonly offVariationId: string;
  /** Variation ID returned when no assignments match. */
  readonly defaultVariationId: string;
  /** Ordered. First matching assignment wins. */
  readonly assignments: readonly Assignment[];
}

export interface FlagVariation {
  readonly value: unknown;
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export interface Assignment {
  /** Stable ID for bucketing salt and debug logging. */
  readonly id: string;
  /**
   * If set, use the referenced audience's rules instead of inline rules.
   * In client format this is MD5-hashed.
   */
  readonly audienceId: string | undefined;
  /** Inline rules. Ignored if audienceId is set. */
  readonly rules: readonly RuleGroup[];
  /**
   * Pre-computed shard ranges per variation.
   * Compiler converts trafficExposure + variationSplits → ranges.
   * Evaluator just checks: bucket in [start, end)?
   */
  readonly variations: readonly AssignmentVariation[];
}

export interface AssignmentVariation {
  readonly variationId: string;
  readonly shardRanges: readonly ShardRange[];
}

export interface ShardRange {
  readonly start: number;
  readonly end: number;
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

export const OPERATORS = [
  "ONE_OF",
  "NOT_ONE_OF",
  "GT",
  "GTE",
  "LT",
  "LTE",
  "MATCHES",
  "IS_NULL",
  "IS_NOT_NULL",
] as const;

export type Operator = (typeof OPERATORS)[number];

/** Operators where value is a string[]. */
export const LIST_OPERATORS = new Set<Operator>(["ONE_OF", "NOT_ONE_OF"]);

/** Operators where value is null. */
export const NULL_OPERATORS = new Set<Operator>(["IS_NULL", "IS_NOT_NULL"]);

// ---------------------------------------------------------------------------
// Evaluation input
//
// subjectKey and subjectAttributes are intentionally separate to avoid
// collisions (e.g. an attribute named "key") and to mirror the downstream
// SDK API pattern: getFlag(flagKey, subjectKey, attributes, default).
// ---------------------------------------------------------------------------

/** Targeting attributes. Values must be concrete — omit absent attributes rather than passing undefined. */
export type SubjectAttributes = Record<string, string | number | boolean | string[]>;

// ---------------------------------------------------------------------------
// Evaluation result
// ---------------------------------------------------------------------------

export type EvaluationReason =
  | "OFF" // Flag is disabled → offVariationId
  | "ASSIGNMENT_MATCH" // A targeting rule matched → assignment's variation
  | "DEFAULT" // No assignments matched → defaultVariationId (fallthrough)
  | "FLAG_NOT_FOUND" // Flag key doesn't exist in config → caller's defaultValue
  | "ERROR"; // Config format unsupported or other error → caller's defaultValue

export interface EvaluationDetail<T = unknown> {
  readonly value: T;
  readonly variationId: string | undefined;
  readonly reason: EvaluationReason;
  /** Assignment ID that matched, if reason is ASSIGNMENT_MATCH. */
  readonly assignmentId: string | undefined;
  readonly errorMessage: string | undefined;
}
