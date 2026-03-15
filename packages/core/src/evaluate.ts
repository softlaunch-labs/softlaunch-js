/**
 * @module evaluate
 *
 * The core flag evaluation engine. This is the heart of Softlaunch.
 *
 * Given a config blob, a flag key, and an evaluation context, this module
 * determines which variation value to return and why.
 *
 * Evaluation order (matches LaunchDarkly/Eppo industry standard):
 *   1. Flag existence check
 *   2. Flag enabled check → offVariation if disabled
 *   3. Prerequisites → offVariation if any prerequisite fails
 *   4. Individual targets → matched variation
 *   5. Targeting rules (first match wins) → matched variation or rollout
 *   6. Fallthrough → default rollout/variation
 *   7. Provided default (if flag not found)
 *
 * The engine is format-aware: it handles both "server" (plain text) and
 * "client" (obfuscated) config blobs transparently. The caller does not
 * need to know which format is in use.
 */

import { base64Decode, computeBucket, md5 } from "./hash.js";
import { buildHashedContextLookup, decodeConditionValue, decodeVariationValue, resolveOperator } from "./obfuscate.js";
import { evaluateOperator } from "./operators.js";
import type {
  Condition,
  ConfigBlob,
  EvaluationContext,
  EvaluationDetail,
  Flag,
  Operator,
  RolloutServeConfig,
  RuleCondition,
  Segment,
  SegmentRule,
  ServeConfig,
  TargetingRule,
} from "./types.js";
import { COMPARISON_OPERATORS, EQUALITY_OPERATORS, LIST_OPERATORS, PATTERN_OPERATORS } from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a feature flag and return the resolved value with metadata.
 *
 * @param config       - The config blob (server or client format)
 * @param flagKey      - The flag key to evaluate (plain text — the engine hashes if needed)
 * @param context      - The evaluation context (user attributes)
 * @param defaultValue - Value to return if the flag is not found
 * @returns Evaluation result with value, variation key, and reason
 */
export function evaluateFlag<T>(
  config: ConfigBlob,
  flagKey: string,
  context: EvaluationContext,
  defaultValue: T,
): EvaluationDetail<T> {
  const isClientFormat = config.format === "client";

  // Look up the flag (hash the key in client format)
  const lookupKey = isClientFormat ? md5(flagKey) : flagKey;
  const flag = config.flags[lookupKey];

  if (!flag) {
    return makeResult(defaultValue, undefined, "DEFAULT", undefined, undefined);
  }

  // Check if flag is enabled
  if (!flag.enabled) {
    const offValue = resolveVariationValue<T>(flag, flag.offVariation, isClientFormat);
    const offVariationKey = isClientFormat ? decodeVariationKey(flag.offVariation) : flag.offVariation;
    return makeResult(offValue, offVariationKey, "OFF", undefined, undefined);
  }

  // Check prerequisites
  for (const prerequisite of flag.prerequisites) {
    const prereqFlagKey = isClientFormat ? findPlainFlagKeyForHash(prerequisite.flagKey) : prerequisite.flagKey;

    if (prereqFlagKey === undefined) {
      // Prerequisite flag not found — fail the prerequisite
      const offValue = resolveVariationValue<T>(flag, flag.offVariation, isClientFormat);
      const offVariationKey = isClientFormat ? decodeVariationKey(flag.offVariation) : flag.offVariation;
      return makeResult(offValue, offVariationKey, "PREREQUISITE_FAILED", undefined, undefined);
    }

    // Recursively evaluate the prerequisite flag
    const prereqResult = evaluateFlag(config, prereqFlagKey, context, undefined);
    const requiredVariationKey = isClientFormat
      ? decodeVariationKey(prerequisite.variationKey)
      : prerequisite.variationKey;

    if (prereqResult.variationKey !== requiredVariationKey) {
      const offValue = resolveVariationValue<T>(flag, flag.offVariation, isClientFormat);
      const offVariationKey = isClientFormat ? decodeVariationKey(flag.offVariation) : flag.offVariation;
      return makeResult(offValue, offVariationKey, "PREREQUISITE_FAILED", undefined, undefined);
    }
  }

  // Check individual targets
  const contextKeyHash = isClientFormat ? md5(context.key) : context.key;
  for (const target of flag.individualTargets) {
    if (target.contextKeys.includes(contextKeyHash)) {
      const value = resolveVariationValue<T>(flag, target.variationKey, isClientFormat);
      const variationKey = isClientFormat ? decodeVariationKey(target.variationKey) : target.variationKey;
      return makeResult(value, variationKey, "INDIVIDUAL_TARGET", undefined, undefined);
    }
  }

  // Evaluate targeting rules
  const evaluationState = isClientFormat
    ? { isClientFormat: true as const, hashedContextLookup: buildHashedContextLookup(context) }
    : { isClientFormat: false as const, hashedContextLookup: undefined };

  for (const rule of flag.rules) {
    const ruleMatches = matchesRule(rule, context, config.segments, evaluationState);

    if (ruleMatches) {
      const serveResult = resolveServeConfig(rule.serve, context, config.totalShards, isClientFormat);

      if (serveResult) {
        const value = resolveVariationValue<T>(flag, serveResult, isClientFormat);
        const variationKey = isClientFormat ? decodeVariationKey(serveResult) : serveResult;
        const ruleId = isClientFormat ? base64SafeDecode(rule.id) : rule.id;
        return makeResult(value, variationKey, "RULE_MATCH", ruleId, undefined);
      }
    }
  }

  // Fallthrough
  const fallthroughResult = resolveServeConfig(flag.fallthrough, context, config.totalShards, isClientFormat);

  if (fallthroughResult) {
    const value = resolveVariationValue<T>(flag, fallthroughResult, isClientFormat);
    const variationKey = isClientFormat ? decodeVariationKey(fallthroughResult) : fallthroughResult;
    return makeResult(value, variationKey, "FALLTHROUGH", undefined, undefined);
  }

  // Should not happen if config is valid, but return default as safety net
  return makeResult(defaultValue, undefined, "DEFAULT", undefined, undefined);
}

/**
 * Evaluate all flags in a config and return a map of flag key → value.
 * Only usable with server-format configs (requires plain-text flag keys).
 *
 * @param config       - The config blob (server format)
 * @param context      - The evaluation context
 * @returns Map of flag key → evaluated value
 */
export function evaluateAllFlags(config: ConfigBlob, context: EvaluationContext): ReadonlyMap<string, unknown> {
  if (config.format !== "server") {
    throw new Error("evaluateAllFlags is only supported with server-format configs");
  }

  const results = new Map<string, unknown>();
  for (const flagKey of Object.keys(config.flags)) {
    const result = evaluateFlag(config, flagKey, context, undefined);
    results.set(flagKey, result.value);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

interface ServerEvaluationState {
  readonly isClientFormat: false;
  readonly hashedContextLookup: undefined;
}

interface ClientEvaluationState {
  readonly isClientFormat: true;
  readonly hashedContextLookup: ReadonlyMap<string, string | number | boolean | readonly string[] | undefined>;
}

type FormatState = ServerEvaluationState | ClientEvaluationState;

function matchesRule(
  rule: TargetingRule,
  context: EvaluationContext,
  segments: Readonly<Record<string, Segment>>,
  state: FormatState,
): boolean {
  // All conditions must match (AND logic)
  return rule.conditions.every((condition) => matchesRuleCondition(condition, context, segments, state));
}

function matchesRuleCondition(
  condition: RuleCondition,
  context: EvaluationContext,
  segments: Readonly<Record<string, Segment>>,
  state: FormatState,
): boolean {
  if (condition.type === "segment") {
    const segment = segments[condition.segmentKey];
    if (!segment) return false;
    return matchesSegment(segment, context, state);
  }

  return matchesCondition(condition.condition, context, state);
}

function matchesSegment(segment: Segment, context: EvaluationContext, state: FormatState): boolean {
  // Segment rules are OR'd: match if ANY rule matches
  return segment.rules.some((rule) => matchesSegmentRule(rule, context, state));
}

function matchesSegmentRule(rule: SegmentRule, context: EvaluationContext, state: FormatState): boolean {
  // Within a segment rule, conditions are AND'd
  return rule.conditions.every((condition) => matchesCondition(condition, context, state));
}

// ---------------------------------------------------------------------------
// Condition matching
// ---------------------------------------------------------------------------

function matchesCondition(condition: Condition, context: EvaluationContext, state: FormatState): boolean {
  // Resolve the operator
  const operator = resolveOperator(condition.operator);
  if (!operator) return false;

  // Get the context value for this attribute
  const contextValue = getContextValueForAttribute(condition.attribute, context, state);
  if (contextValue === undefined) {
    // Attribute not present in context — condition does not match
    return false;
  }

  // Handle list operators (ONE_OF, NOT_ONE_OF)
  if (LIST_OPERATORS.has(operator)) {
    return evaluateListOperator(operator, contextValue, condition.value, state);
  }

  // For scalar operators, coerce to string and evaluate
  const contextValueString = String(contextValue);
  const conditionValueString = resolveScalarConditionValue(condition.value, operator, state.isClientFormat);

  return evaluateOperator(operator, contextValueString, conditionValueString);
}

/**
 * Get the context value for a given attribute name (or hash).
 */
function getContextValueForAttribute(
  attribute: string,
  context: EvaluationContext,
  state: FormatState,
): string | number | boolean | readonly string[] | undefined {
  if (state.isClientFormat) {
    // In client format, attribute is an MD5 hash.
    // Look it up in the pre-computed hashed context.
    return state.hashedContextLookup.get(attribute);
  }

  // In server format, attribute is the plain name.
  return context[attribute];
}

/**
 * Evaluate ONE_OF or NOT_ONE_OF operators.
 */
function evaluateListOperator(
  operator: "ONE_OF" | "NOT_ONE_OF" | Operator,
  contextValue: string | number | boolean | readonly string[],
  conditionValue: string | readonly string[],
  state: FormatState,
): boolean {
  const conditionValues = Array.isArray(conditionValue) ? conditionValue : [conditionValue];

  // Context value could be a single value or an array
  const contextValues = Array.isArray(contextValue) ? contextValue.map(String) : [String(contextValue)];

  // In client format, hash context values for comparison
  const comparableContextValues = state.isClientFormat ? contextValues.map((v) => md5(v)) : contextValues;

  const conditionStrings = conditionValues as readonly string[];

  // ONE_OF: true if ANY context value is in the condition values
  // NOT_ONE_OF: true if NO context value is in the condition values
  const hasMatch = comparableContextValues.some((cv) => conditionStrings.includes(cv));

  if (operator === "ONE_OF") return hasMatch;
  if (operator === "NOT_ONE_OF") return !hasMatch;
  return false;
}

/**
 * Resolve a scalar condition value, decoding from base64 if in client format.
 */
function resolveScalarConditionValue(
  value: string | readonly string[],
  operator: Operator,
  isClientFormat: boolean,
): string {
  const raw = Array.isArray(value) ? String(value[0] ?? "") : String(value);

  if (!isClientFormat) return raw;

  // In client format, equality operators use MD5 hashes (handled separately).
  // Pattern and comparison operators use base64 encoding.
  if (EQUALITY_OPERATORS.has(operator)) {
    // This should not be reached for equality operators (handled by list path)
    return raw;
  }

  if (PATTERN_OPERATORS.has(operator) || COMPARISON_OPERATORS.has(operator)) {
    return decodeConditionValue(raw);
  }

  return raw;
}

// ---------------------------------------------------------------------------
// Serve config resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a serve config to a variation key.
 * For fixed serves, returns the variation key directly.
 * For rollouts, computes the bucket and finds the matching variation.
 *
 * @returns The variation key (in the config's format — may be base64 in client format),
 *          or undefined if no variation matches (gap in shard coverage).
 */
function resolveServeConfig(
  serve: ServeConfig,
  context: EvaluationContext,
  totalShards: number,
  isClientFormat: boolean,
): string | undefined {
  if (serve.type === "fixed") {
    return serve.variationKey;
  }

  return resolveRollout(serve, context, totalShards, isClientFormat);
}

function resolveRollout(
  rollout: RolloutServeConfig,
  context: EvaluationContext,
  totalShards: number,
  isClientFormat: boolean,
): string | undefined {
  const bucketByAttribute = rollout.bucketBy;
  const bucketValue = getBucketValue(bucketByAttribute, context, isClientFormat);

  if (bucketValue === undefined) {
    // If the bucket-by attribute is missing, use the context key
    const fallbackBucketValue = context.key;
    const bucket = computeBucket(rollout.salt, fallbackBucketValue, totalShards);
    return findVariationForBucket(rollout, bucket);
  }

  const bucket = computeBucket(rollout.salt, bucketValue, totalShards);
  return findVariationForBucket(rollout, bucket);
}

function getBucketValue(
  bucketByAttribute: string,
  context: EvaluationContext,
  isClientFormat: boolean,
): string | undefined {
  if (isClientFormat) {
    // bucketBy is MD5-hashed in client format.
    // We need to find which context attribute matches.
    // Hash each context key and check.
    for (const key of Object.keys(context)) {
      if (md5(key) === bucketByAttribute) {
        const value = context[key];
        return value !== undefined ? String(value) : undefined;
      }
    }
    return undefined;
  }

  const value = context[bucketByAttribute];
  return value !== undefined ? String(value) : undefined;
}

function findVariationForBucket(rollout: RolloutServeConfig, bucket: number): string | undefined {
  for (const variation of rollout.variations) {
    for (const range of variation.shardRanges) {
      if (bucket >= range.start && bucket < range.end) {
        return variation.variationKey;
      }
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Variation value resolution
// ---------------------------------------------------------------------------

/**
 * Look up a variation value from the flag's variations map.
 * In client format, the variation key is base64-encoded and the value is base64(JSON.stringify).
 */
function resolveVariationValue<T>(flag: Flag, variationKey: string, isClientFormat: boolean): T {
  const variation = flag.variations[variationKey];

  if (!variation) {
    return undefined as T;
  }

  if (isClientFormat) {
    return decodeVariationValue(variation.value) as T;
  }

  return variation.value as T;
}

/**
 * Decode a base64-encoded variation key back to plain text.
 */
function decodeVariationKey(encodedKey: string): string {
  return base64SafeDecode(encodedKey);
}

function base64SafeDecode(value: string): string {
  try {
    return base64Decode(value);
  } catch {
    return value;
  }
}

/**
 * For prerequisite evaluation in client format, we need to find the
 * plain-text flag key corresponding to an MD5 hash. Since client configs
 * don't contain plain-text keys, we can't do this directly.
 *
 * For prerequisites in client format, the prerequisite flagKey is an MD5 hash.
 * We pass this hash directly to the recursive evaluateFlag call, which will
 * hash the plain-text key and look it up. So we need the PLAIN TEXT key.
 *
 * In practice, prerequisites are rare in client SDKs. The typical pattern is:
 * server SDK evaluates prerequisites, client SDK gets resolved values.
 *
 * For now, we return undefined (prerequisite fails) if we can't resolve.
 * This is safe: the flag falls back to offVariation.
 */
function findPlainFlagKeyForHash(_hash: string): string | undefined {
  // Prerequisites in client-format configs require the plain-text flag key
  // to recursively evaluate. Since this information is not available in
  // the obfuscated config, prerequisites are not supported in client format.
  //
  // This is consistent with LaunchDarkly's approach: client-side SDKs
  // receive pre-evaluated results and don't evaluate prerequisites locally.
  //
  // Server SDKs (which use server-format configs) fully support prerequisites.
  return undefined;
}

// ---------------------------------------------------------------------------
// Result construction
// ---------------------------------------------------------------------------

function makeResult<T>(
  value: T,
  variationKey: string | undefined,
  reason: EvaluationDetail["reason"],
  ruleId: string | undefined,
  errorMessage: string | undefined,
): EvaluationDetail<T> {
  return { value, variationKey, reason, ruleId, errorMessage };
}
