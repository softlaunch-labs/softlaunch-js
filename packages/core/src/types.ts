/**
 * @module types
 *
 * Canonical type definitions for the Softlaunch config blob format.
 *
 * These types define the wire format that every SDK (JS, Go, Python, etc.)
 * must be able to parse and evaluate. Changes here are breaking changes
 * across all clients. Version the format via `formatVersion`.
 *
 * Two config formats exist:
 *   - "server": Plain text keys, operators, values. Used by server SDKs
 *     that hold an admin token and operate in trusted environments.
 *   - "client": Obfuscated keys and values. Used by browser/mobile SDKs
 *     where the config is visible via DevTools. Flag keys, attribute names,
 *     and equality values are MD5-hashed. String patterns and variation
 *     values are base64-encoded.
 */

// ---------------------------------------------------------------------------
// Format version — bump on breaking changes to the blob schema
// ---------------------------------------------------------------------------

/** Current format version. SDKs must reject configs with unknown versions. */
export const CURRENT_FORMAT_VERSION = 1;

// ---------------------------------------------------------------------------
// Config blob — top-level structure
// ---------------------------------------------------------------------------

export type ConfigFormat = "server" | "client";

export interface ConfigBlob {
  /** Schema version. SDKs reject configs with `formatVersion > CURRENT_FORMAT_VERSION`. */
  readonly formatVersion: number;

  /** Whether keys/values are plain text ("server") or obfuscated ("client"). */
  readonly format: ConfigFormat;

  /** Environment key this config was compiled for (plain text in both formats). */
  readonly environment: string;

  /** Monotonically increasing version. Higher = newer. */
  readonly version: number;

  /** Unix ms timestamp of when this blob was generated. */
  readonly generatedAt: number;

  /**
   * Total number of shards for percentage rollouts.
   * All shard ranges in this config are in [0, totalShards).
   * Default: 10_000 (0.01% granularity).
   */
  readonly totalShards: number;

  /** Reusable segment definitions, keyed by segment key (or MD5 hash in client format). */
  readonly segments: Readonly<Record<string, Segment>>;

  /** Flag definitions, keyed by flag key (or MD5 hash in client format). */
  readonly flags: Readonly<Record<string, Flag>>;
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export type FlagType = "boolean" | "string" | "number" | "json";

export interface Flag {
  /**
   * Value type. In client format this is base64-encoded.
   * Determines how variation values are interpreted.
   */
  readonly type: string;

  /** Whether this flag is currently enabled for this environment. */
  readonly enabled: boolean;

  /**
   * Variation definitions.
   * Key = variation key (or base64 in client format).
   * Value = the actual value to return (or base64/encoded in client format).
   */
  readonly variations: Readonly<Record<string, FlagVariation>>;

  /** Variation key to return when the flag is disabled. */
  readonly offVariation: string;

  /** Flags that must evaluate to specific variations before this flag is evaluated. */
  readonly prerequisites: readonly Prerequisite[];

  /**
   * Explicit context-key → variation assignments.
   * Evaluated before rules. First match wins.
   */
  readonly individualTargets: readonly IndividualTarget[];

  /**
   * Targeting rules, evaluated top-to-bottom. First matching rule wins.
   * If no rules match, `fallthrough` is used.
   */
  readonly rules: readonly TargetingRule[];

  /** Serve config used when no rules match. */
  readonly fallthrough: ServeConfig;
}

export interface FlagVariation {
  /** The value to return. Type depends on `Flag.type`. */
  readonly value: unknown;
}

// ---------------------------------------------------------------------------
// Prerequisites
// ---------------------------------------------------------------------------

export interface Prerequisite {
  /** Flag key (or MD5 hash in client format) that must be evaluated first. */
  readonly flagKey: string;

  /** The prerequisite flag must resolve to this variation key. */
  readonly variationKey: string;
}

// ---------------------------------------------------------------------------
// Individual targets
// ---------------------------------------------------------------------------

export interface IndividualTarget {
  /** Variation key to serve for matched context keys. */
  readonly variationKey: string;

  /**
   * Context keys (the `key` field of the evaluation context) that receive
   * this variation. In client format these are MD5-hashed.
   */
  readonly contextKeys: readonly string[];
}

// ---------------------------------------------------------------------------
// Targeting rules
// ---------------------------------------------------------------------------

export interface TargetingRule {
  /** Stable identifier for this rule (for audit/debug). */
  readonly id: string;

  /**
   * Conditions that must ALL be true for this rule to match (AND logic).
   * Each condition is either a segment membership check or an attribute condition.
   */
  readonly conditions: readonly RuleCondition[];

  /** What to serve when this rule matches. */
  readonly serve: ServeConfig;
}

export type RuleCondition = SegmentCondition | AttributeCondition;

export interface SegmentCondition {
  readonly type: "segment";

  /** Segment key (or MD5 hash in client format). */
  readonly segmentKey: string;
}

export interface AttributeCondition {
  readonly type: "attribute";

  /** The attribute condition to evaluate. */
  readonly condition: Condition;
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export interface Condition {
  /**
   * Context attribute name to evaluate (or MD5 hash in client format).
   * Matched against keys in the evaluation context.
   */
  readonly attribute: string;

  /**
   * Operator identifier. In server format this is a plain `Operator` string.
   * In client format this is the MD5 hash of the operator name.
   */
  readonly operator: string;

  /**
   * Value(s) to compare against. Shape depends on operator:
   *
   * - List operators (ONE_OF, NOT_ONE_OF): `string[]`
   *   In client format: MD5 hashes of each value.
   *
   * - Scalar operators (IS, IS_NOT, GT, LT, etc.): `string`
   *   In client format: base64-encoded for string/regex ops,
   *   MD5-hashed for equality ops.
   *
   * - Pattern operators (CONTAINS, STARTS_WITH, ENDS_WITH, MATCHES): `string`
   *   In client format: base64-encoded (must be decoded before evaluation).
   */
  readonly value: string | readonly string[];
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

/**
 * All supported comparison operators.
 *
 * IMPORTANT: This list is part of the wire format. Adding operators is safe.
 * Removing or renaming operators is a breaking change.
 */
export const OPERATORS = [
  // Equality
  "IS",
  "IS_NOT",

  // Set membership
  "ONE_OF",
  "NOT_ONE_OF",

  // String matching
  "CONTAINS",
  "NOT_CONTAINS",
  "STARTS_WITH",
  "ENDS_WITH",
  "MATCHES", // regex

  // Numeric comparison
  "GT",
  "GTE",
  "LT",
  "LTE",

  // Semantic version comparison
  "SEMVER_EQ",
  "SEMVER_GT",
  "SEMVER_GTE",
  "SEMVER_LT",
  "SEMVER_LTE",

  // Date/time comparison (ISO 8601 strings or unix ms)
  "BEFORE",
  "AFTER",
] as const;

export type Operator = (typeof OPERATORS)[number];

/**
 * Operators that compare a context value against a list of values.
 * In client format, values are individually hashed.
 */
export const LIST_OPERATORS: ReadonlySet<Operator> = new Set(["ONE_OF", "NOT_ONE_OF"]);

/**
 * Operators that compare a context value against a single hashed value.
 * In client format, both the stored value and the context value are hashed.
 */
export const EQUALITY_OPERATORS: ReadonlySet<Operator> = new Set(["IS", "IS_NOT"]);

/**
 * Operators where the stored value is a pattern (string or regex).
 * In client format, the stored value is base64-encoded (not hashed)
 * because the SDK needs the raw pattern to evaluate.
 */
export const PATTERN_OPERATORS: ReadonlySet<Operator> = new Set([
  "CONTAINS",
  "NOT_CONTAINS",
  "STARTS_WITH",
  "ENDS_WITH",
  "MATCHES",
]);

/**
 * Operators where the stored value is a comparable scalar (number, date, semver).
 * In client format, the stored value is base64-encoded.
 */
export const COMPARISON_OPERATORS: ReadonlySet<Operator> = new Set([
  "GT",
  "GTE",
  "LT",
  "LTE",
  "SEMVER_EQ",
  "SEMVER_GT",
  "SEMVER_GTE",
  "SEMVER_LT",
  "SEMVER_LTE",
  "BEFORE",
  "AFTER",
]);

// ---------------------------------------------------------------------------
// Serve config (what to return when a rule matches)
// ---------------------------------------------------------------------------

export type ServeConfig = FixedServeConfig | RolloutServeConfig;

export interface FixedServeConfig {
  readonly type: "fixed";

  /** Variation key to serve. */
  readonly variationKey: string;
}

export interface RolloutServeConfig {
  readonly type: "rollout";

  /**
   * Which context attribute to hash for bucket assignment.
   * Defaults to "key" (the context's stable identifier).
   */
  readonly bucketBy: string;

  /**
   * Salt for this specific rollout. Ensures different flags/rules
   * produce independent bucket assignments for the same user.
   * Typically: `${flagKey}-${ruleId}`.
   */
  readonly salt: string;

  /**
   * Variations with their shard range assignments.
   * Shard ranges are in [0, totalShards) and must not overlap.
   * Gaps in coverage mean "no assignment" (fallthrough to next rule or default).
   */
  readonly variations: readonly RolloutVariation[];
}

export interface RolloutVariation {
  /** Variation key to serve if the bucket falls in any of the shard ranges. */
  readonly variationKey: string;

  /** Shard ranges this variation occupies. Ranges are [start, end). */
  readonly shardRanges: readonly ShardRange[];
}

export interface ShardRange {
  /** Inclusive start of the range. */
  readonly start: number;

  /** Exclusive end of the range. */
  readonly end: number;
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export interface Segment {
  /**
   * Rules are OR'd together: a context matches the segment if it matches
   * ANY rule. Within each rule, conditions are AND'd.
   */
  readonly rules: readonly SegmentRule[];
}

export interface SegmentRule {
  readonly conditions: readonly Condition[];
}

// ---------------------------------------------------------------------------
// Evaluation context — what the SDK user provides
// ---------------------------------------------------------------------------

/**
 * The context object passed to flag evaluation.
 * Must include a `key` field as a stable identifier for the subject
 * (user ID, device ID, org ID, etc.).
 */
export interface EvaluationContext {
  /** Stable identifier for this evaluation subject. Required. */
  readonly key: string;

  /**
   * Additional attributes used for targeting.
   * Keys are attribute names, values are attribute values.
   * Undefined values are treated as "attribute not present".
   */
  readonly [attribute: string]: string | number | boolean | readonly string[] | undefined;
}

// ---------------------------------------------------------------------------
// Evaluation result — what the SDK returns
// ---------------------------------------------------------------------------

/**
 * Reason codes explaining why a flag resolved to a particular value.
 */
export type EvaluationReason =
  | "OFF"
  | "PREREQUISITE_FAILED"
  | "INDIVIDUAL_TARGET"
  | "RULE_MATCH"
  | "FALLTHROUGH"
  | "DEFAULT"
  | "ERROR";

export interface EvaluationDetail<T = unknown> {
  /** The resolved flag value. */
  readonly value: T;

  /** The variation key that was selected, if any. */
  readonly variationKey: string | undefined;

  /** Why this particular value was selected. */
  readonly reason: EvaluationReason;

  /** The ID of the matched targeting rule, if reason is "RULE_MATCH". */
  readonly ruleId: string | undefined;

  /** Error message, if reason is "ERROR". */
  readonly errorMessage: string | undefined;
}
