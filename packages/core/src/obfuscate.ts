/**
 * @module obfuscate
 *
 * Handles compilation of server configs into obfuscated client configs,
 * and provides resolution helpers for evaluating obfuscated configs.
 *
 * Obfuscation strategy (mirrors Eppo's approach):
 *
 * | Field                 | Server format    | Client format         |
 * |-----------------------|------------------|-----------------------|
 * | Flag keys             | plain text       | MD5 hash              |
 * | Flag type             | plain text       | base64                |
 * | Variation keys        | plain text       | base64                |
 * | Variation values      | raw              | base64(JSON.stringify) |
 * | Segment keys          | plain text       | MD5 hash              |
 * | Operator names        | plain text       | MD5 hash              |
 * | Attribute names       | plain text       | MD5 hash              |
 * | Equality values       | plain text       | MD5 hash              |
 * | Pattern values        | plain text       | base64                |
 * | Comparison values     | plain text       | base64                |
 * | Individual target keys| plain text       | MD5 hash              |
 * | Rule IDs              | plain text       | base64                |
 * | Rollout salt          | plain text       | plain text (needed)   |
 * | Rollout bucketBy      | plain text       | MD5 hash              |
 *
 * The client SDK hashes its inputs using the same MD5 function to match
 * against the obfuscated config. This prevents casual inspection of
 * flag names, targeting rules, and user segments via DevTools.
 */

import { base64Decode, base64Encode, md5 } from "./hash";
import { COMPARISON_OPERATORS, EQUALITY_OPERATORS, LIST_OPERATORS, OPERATORS, PATTERN_OPERATORS } from "./types";
import type {
  AttributeCondition,
  Condition,
  ConfigBlob,
  EvaluationContext,
  Flag,
  FlagType,
  FlagVariation,
  IndividualTarget,
  Operator,
  Prerequisite,
  RolloutServeConfig,
  RuleCondition,
  Segment,
  SegmentCondition,
  SegmentRule,
  ServeConfig,
  TargetingRule,
} from "./types";

// ---------------------------------------------------------------------------
// Operator hash lookup — built once, used for all evaluations
// ---------------------------------------------------------------------------

/** Map from MD5(operatorName) → Operator. Built at module load time. */
const HASHED_OPERATOR_LOOKUP: ReadonlyMap<string, Operator> = buildOperatorLookup();

function buildOperatorLookup(): Map<string, Operator> {
  const lookup = new Map<string, Operator>();
  for (const operator of OPERATORS) {
    lookup.set(md5(operator), operator);
  }
  return lookup;
}

/**
 * Resolve an operator from its plain text or MD5-hashed representation.
 * Returns undefined if the operator is not recognized.
 */
export function resolveOperator(operatorIdOrHash: string): Operator | undefined {
  // Check if it's already a known operator (server format)
  if ((OPERATORS as readonly string[]).includes(operatorIdOrHash)) {
    return operatorIdOrHash as Operator;
  }

  // Try MD5 lookup (client format)
  return HASHED_OPERATOR_LOOKUP.get(operatorIdOrHash);
}

// ---------------------------------------------------------------------------
// Client-format context hashing
// ---------------------------------------------------------------------------

/**
 * Build a lookup map from MD5(attributeName) → attributeValue for a context.
 * Used when evaluating client-format configs where attribute names are hashed.
 */
export function buildHashedContextLookup(
  context: EvaluationContext,
): ReadonlyMap<string, string | number | boolean | readonly string[] | undefined> {
  const lookup = new Map<string, string | number | boolean | readonly string[] | undefined>();
  for (const key of Object.keys(context)) {
    lookup.set(md5(key), context[key]);
  }
  return lookup;
}

/**
 * Hash a context value for equality comparison against an obfuscated config.
 */
export function hashContextValue(value: string): string {
  return md5(value);
}

// ---------------------------------------------------------------------------
// Value decoding for client-format configs
// ---------------------------------------------------------------------------

/**
 * Decode a variation value from client format.
 * In client format, values are stored as base64(JSON.stringify(value)).
 */
export function decodeVariationValue(encodedValue: unknown): unknown {
  if (typeof encodedValue !== "string") return encodedValue;
  try {
    return JSON.parse(base64Decode(encodedValue)) as unknown;
  } catch {
    return encodedValue;
  }
}

/**
 * Decode a flag type from client format (base64-encoded).
 */
export function decodeFlagType(encodedType: string): FlagType {
  const decoded = base64Decode(encodedType);
  if (decoded === "boolean" || decoded === "string" || decoded === "number" || decoded === "json") {
    return decoded;
  }
  // If not recognized, return as-is (may be plain text in server format)
  if (encodedType === "boolean" || encodedType === "string" || encodedType === "number" || encodedType === "json") {
    return encodedType;
  }
  return "string";
}

/**
 * Decode a base64-encoded condition value (for pattern/comparison operators).
 */
export function decodeConditionValue(encodedValue: string): string {
  try {
    return base64Decode(encodedValue);
  } catch {
    return encodedValue;
  }
}

// ---------------------------------------------------------------------------
// Server → Client config compilation
// ---------------------------------------------------------------------------

/**
 * Compile a server-format config blob into an obfuscated client-format blob.
 * This is called on the server (dashboard/API) when generating the config
 * that browser/mobile SDKs will consume.
 */
export function compileClientConfig(serverConfig: ConfigBlob): ConfigBlob {
  if (serverConfig.format !== "server") {
    throw new Error("Cannot compile a config that is already in client format");
  }

  const obfuscatedSegments: Record<string, Segment> = {};
  for (const [segmentKey, segment] of Object.entries(serverConfig.segments)) {
    obfuscatedSegments[md5(segmentKey)] = obfuscateSegment(segment);
  }

  const obfuscatedFlags: Record<string, Flag> = {};
  for (const [flagKey, flag] of Object.entries(serverConfig.flags)) {
    obfuscatedFlags[md5(flagKey)] = obfuscateFlag(flag);
  }

  return {
    formatVersion: serverConfig.formatVersion,
    format: "client",
    environment: serverConfig.environment,
    version: serverConfig.version,
    generatedAt: serverConfig.generatedAt,
    totalShards: serverConfig.totalShards,
    segments: obfuscatedSegments,
    flags: obfuscatedFlags,
  };
}

// ---------------------------------------------------------------------------
// Internal obfuscation helpers
// ---------------------------------------------------------------------------

function obfuscateSegment(segment: Segment): Segment {
  return {
    rules: segment.rules.map(obfuscateSegmentRule),
  };
}

function obfuscateSegmentRule(rule: SegmentRule): SegmentRule {
  return {
    conditions: rule.conditions.map(obfuscateCondition),
  };
}

function obfuscateCondition(condition: Condition): Condition {
  const operator = resolveOperator(condition.operator);
  const obfuscatedOperator = md5(condition.operator);
  const obfuscatedAttribute = md5(condition.attribute);

  if (!operator) {
    // Unknown operator — hash everything conservatively
    return {
      attribute: obfuscatedAttribute,
      operator: obfuscatedOperator,
      value: typeof condition.value === "string" ? base64Encode(condition.value) : condition.value.map((v) => md5(v)),
    };
  }

  let obfuscatedValue: string | readonly string[];

  if (LIST_OPERATORS.has(operator)) {
    // Hash each value in the list
    const values = Array.isArray(condition.value) ? condition.value : [condition.value];
    obfuscatedValue = (values as readonly string[]).map((v) => md5(v));
  } else if (EQUALITY_OPERATORS.has(operator)) {
    // Hash the scalar value
    obfuscatedValue = md5(String(condition.value));
  } else if (PATTERN_OPERATORS.has(operator) || COMPARISON_OPERATORS.has(operator)) {
    // Base64 encode (SDK needs the raw value to evaluate)
    obfuscatedValue = base64Encode(String(condition.value));
  } else {
    obfuscatedValue = base64Encode(String(condition.value));
  }

  return {
    attribute: obfuscatedAttribute,
    operator: obfuscatedOperator,
    value: obfuscatedValue,
  };
}

function obfuscateFlag(flag: Flag): Flag {
  const obfuscatedVariations: Record<string, FlagVariation> = {};
  for (const [variationKey, variation] of Object.entries(flag.variations)) {
    obfuscatedVariations[base64Encode(variationKey)] = {
      value: base64Encode(JSON.stringify(variation.value)),
    };
  }

  return {
    type: base64Encode(flag.type),
    enabled: flag.enabled,
    variations: obfuscatedVariations,
    offVariation: base64Encode(flag.offVariation),
    prerequisites: flag.prerequisites.map(obfuscatePrerequisite),
    individualTargets: flag.individualTargets.map(obfuscateIndividualTarget),
    rules: flag.rules.map(obfuscateTargetingRule),
    fallthrough: obfuscateServeConfig(flag.fallthrough),
  };
}

function obfuscatePrerequisite(prerequisite: Prerequisite): Prerequisite {
  return {
    flagKey: md5(prerequisite.flagKey),
    variationKey: base64Encode(prerequisite.variationKey),
  };
}

function obfuscateIndividualTarget(target: IndividualTarget): IndividualTarget {
  return {
    variationKey: base64Encode(target.variationKey),
    contextKeys: target.contextKeys.map((key) => md5(key)),
  };
}

function obfuscateTargetingRule(rule: TargetingRule): TargetingRule {
  return {
    id: base64Encode(rule.id),
    conditions: rule.conditions.map(obfuscateRuleCondition),
    serve: obfuscateServeConfig(rule.serve),
  };
}

function obfuscateRuleCondition(condition: RuleCondition): RuleCondition {
  if (condition.type === "segment") {
    const segmentCondition: SegmentCondition = {
      type: "segment",
      segmentKey: md5(condition.segmentKey),
    };
    return segmentCondition;
  }

  const attributeCondition: AttributeCondition = {
    type: "attribute",
    condition: obfuscateCondition(condition.condition),
  };
  return attributeCondition;
}

function obfuscateServeConfig(serve: ServeConfig): ServeConfig {
  if (serve.type === "fixed") {
    return { type: "fixed", variationKey: base64Encode(serve.variationKey) };
  }

  const rollout: RolloutServeConfig = {
    type: "rollout",
    bucketBy: md5(serve.bucketBy),
    salt: serve.salt, // Salt stays plain — needed for deterministic hashing
    variations: serve.variations.map((v) => ({
      variationKey: base64Encode(v.variationKey),
      shardRanges: v.shardRanges,
    })),
  };
  return rollout;
}
