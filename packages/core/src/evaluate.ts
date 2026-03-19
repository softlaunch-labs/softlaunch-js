/**
 * @module evaluate
 *
 * The core flag evaluation engine.
 *
 * Evaluation order:
 *   1. Format version check → ERROR if unsupported
 *   2. Flag exists? → FLAG_NOT_FOUND
 *   3. Flag enabled? → OFF (offVariationId)
 *   4. Walk assignments (ordered, first match wins):
 *      a. Resolve rules (audience ref or inline)
 *      b. Rules match? (OR between groups, AND within conditions)
 *      c. If match: bucket = hash(assignmentId, subjectKey) % totalShards
 *         → walk shard ranges → return variation
 *         → no range match (outside traffic) → next assignment
 *   5. Return defaultVariationId
 *
 * Format-aware: handles both "server" (plain text) and "client" (obfuscated).
 */

import { base64Decode, computeBucket, md5 } from "./hash";
import { buildHashedAttributeLookup, decodeConditionValue, decodeVariationValue, resolveOperator } from "./obfuscate";
import { evaluateOperator } from "./operators";
import type {
  Assignment,
  Audience,
  Condition,
  ConfigBlob,
  EvaluationDetail,
  Flag,
  RuleGroup,
  SubjectAttributes,
} from "./types";
import { CURRENT_FORMAT_VERSION, LIST_OPERATORS, NULL_OPERATORS } from "./types";

type AttributeValue = string | number | boolean | string[];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function evaluateFlag<T>(
  config: ConfigBlob,
  flagKey: string,
  subjectKey: string,
  subjectAttributes: SubjectAttributes,
  defaultValue: T,
): EvaluationDetail<T> {
  // Reject configs from a newer format version this SDK doesn't understand
  if (config.formatVersion > CURRENT_FORMAT_VERSION) {
    return error(
      defaultValue,
      `Unsupported config format version ${config.formatVersion} (SDK supports up to ${CURRENT_FORMAT_VERSION})`,
    );
  }

  const isClient = config.format === "client";
  const lookupKey = isClient ? md5(flagKey) : flagKey;
  const flag = config.flags[lookupKey];

  if (!flag) {
    return ok(defaultValue, undefined, "FLAG_NOT_FOUND", undefined);
  }

  if (!flag.enabled) {
    const off = resolveVariation<T>(flag, flag.offVariationId, isClient, defaultValue);
    return ok(off.value, off.found ? flag.offVariationId : undefined, "OFF", undefined);
  }

  const hashedAttributes = isClient ? buildHashedAttributeLookup(subjectAttributes) : undefined;

  for (const assignment of flag.assignments) {
    const rules = resolveAssignmentRules(assignment, config.audiences);

    // undefined = missing audience → skip this assignment (fail closed)
    if (rules !== undefined && matchesRules(rules, subjectAttributes, isClient, hashedAttributes)) {
      const bucket = computeBucket(assignment.id, subjectKey, config.totalShards);

      for (const variation of assignment.variations) {
        for (const range of variation.shardRanges) {
          if (bucket >= range.start && bucket < range.end) {
            const matched = resolveVariation<T>(flag, variation.variationId, isClient, defaultValue);
            return ok(
              matched.value,
              matched.found ? variation.variationId : undefined,
              "ASSIGNMENT_MATCH",
              assignment.id,
            );
          }
        }
      }
      // Bucket outside traffic exposure → next assignment
    }
  }

  const fallthrough = resolveVariation<T>(flag, flag.defaultVariationId, isClient, defaultValue);
  return ok(fallthrough.value, fallthrough.found ? flag.defaultVariationId : undefined, "DEFAULT", undefined);
}

// ---------------------------------------------------------------------------
// Flag type resolution (for SDK-level type checks)
// ---------------------------------------------------------------------------

/**
 * Resolve the type of a flag, handling both server (plain) and client (base64-encoded) formats.
 * Returns undefined if the flag doesn't exist. SDKs use this to return the default value
 * when the caller expects a different type than the flag's actual type.
 */
export function resolveFlagType(config: ConfigBlob, flagKey: string): string | undefined {
  const isClient = config.format === "client";
  const lookupKey = isClient ? md5(flagKey) : flagKey;
  const flag = config.flags[lookupKey];
  if (!flag) return undefined;
  return isClient ? base64Decode(flag.type) : flag.type;
}

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

/**
 * Resolve targeting rules for an assignment.
 * Returns undefined if the referenced audience is missing (fail closed).
 */
function resolveAssignmentRules(
  assignment: Assignment,
  audiences: Readonly<Record<string, Audience>>,
): readonly RuleGroup[] | undefined {
  if (assignment.audienceId) {
    const audience = audiences[assignment.audienceId];
    // Missing audience → fail closed (skip this assignment)
    if (!audience) return undefined;
    return audience.rules;
  }
  return assignment.rules;
}

/** OR between groups. Empty rules = match all. undefined = no match. */
function matchesRules(
  rules: readonly RuleGroup[],
  attributes: SubjectAttributes,
  isClient: boolean,
  hashedAttributes: ReadonlyMap<string, AttributeValue> | undefined,
): boolean {
  if (rules.length === 0) return true;
  return rules.some((group) => matchesRuleGroup(group, attributes, isClient, hashedAttributes));
}

/** AND within a group. */
function matchesRuleGroup(
  group: RuleGroup,
  attributes: SubjectAttributes,
  isClient: boolean,
  hashedAttributes: ReadonlyMap<string, AttributeValue> | undefined,
): boolean {
  return group.conditions.every((c) => matchesCondition(c, attributes, isClient, hashedAttributes));
}

function matchesCondition(
  condition: Condition,
  attributes: SubjectAttributes,
  isClient: boolean,
  hashedAttributes: ReadonlyMap<string, AttributeValue> | undefined,
): boolean {
  const operator = resolveOperator(condition.operator);
  // Unknown operator → condition fails (safe degradation for forward compat)
  if (!operator) return false;

  // IS_NULL / IS_NOT_NULL — check attribute presence
  if (NULL_OPERATORS.has(operator)) {
    const val = isClient ? hashedAttributes?.get(condition.attribute) : attributes[condition.attribute];
    const isNull = val === undefined || val === null;
    return operator === "IS_NULL" ? isNull : !isNull;
  }

  const attributeValue = isClient ? hashedAttributes?.get(condition.attribute) : attributes[condition.attribute];
  if (attributeValue === undefined || attributeValue === null) return false;

  // List operators
  if (LIST_OPERATORS.has(operator)) {
    return evaluateListOperator(operator, attributeValue, condition.value, isClient);
  }

  // Scalar operators
  const attributeStr = String(attributeValue);
  const conditionStr = isClient ? decodeConditionValue(String(condition.value)) : String(condition.value);
  return evaluateOperator(operator, attributeStr, conditionStr);
}

/**
 * Compare attribute value(s) against a list of condition values.
 * All values are coerced to strings before comparison (e.g. true → "true", 42 → "42").
 * Array attributes are checked for any overlap with the condition list.
 */
function evaluateListOperator(
  operator: string,
  attributeValue: AttributeValue,
  conditionValue: string | readonly string[] | null,
  isClient: boolean,
): boolean {
  if (!Array.isArray(conditionValue)) return false;
  const attributeValues = Array.isArray(attributeValue) ? attributeValue.map(String) : [String(attributeValue)];
  const comparable = isClient ? attributeValues.map((v) => md5(v)) : attributeValues;
  const hasMatch = comparable.some((av) => conditionValue.includes(av));
  return operator === "ONE_OF" ? hasMatch : !hasMatch;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up a variation value. Returns { value, found } so callers can
 * report the correct variationId (undefined if not found).
 *
 * The `as T` cast is intentional — variation.value is `unknown` on the wire
 * format. Type safety is enforced upstream: typed SDK hooks check flag.type
 * before calling evaluateFlag, so T matches the actual value at runtime.
 */
function resolveVariation<T>(
  flag: Flag,
  variationId: string,
  isClient: boolean,
  defaultValue: T,
): { value: T; found: boolean } {
  const variation = flag.variations[variationId];
  if (!variation) return { value: defaultValue, found: false };
  const resolved = isClient ? decodeVariationValue(variation.value) : variation.value;
  return { value: resolved as T, found: true };
}

function ok<T>(
  value: T,
  variationId: string | undefined,
  reason: "OFF" | "ASSIGNMENT_MATCH" | "DEFAULT" | "FLAG_NOT_FOUND",
  assignmentId: string | undefined,
): EvaluationDetail<T> {
  return { value, variationId, reason, assignmentId, errorMessage: undefined };
}

function error<T>(defaultValue: T, message: string): EvaluationDetail<T> {
  return {
    value: defaultValue,
    variationId: undefined,
    reason: "ERROR",
    assignmentId: undefined,
    errorMessage: message,
  };
}
