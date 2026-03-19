/**
 * @module obfuscate
 *
 * Server → client config compilation (obfuscation) and client-format helpers.
 *
 * Obfuscation strategy:
 *   Flag keys, audience IDs, attribute names, equality values → MD5 hash
 *   Variation IDs/values, pattern values, comparison values → base64
 *   Operator names → MD5 hash
 */

import { base64Decode, base64Encode, md5 } from "./hash";
import type {
  Assignment,
  AssignmentVariation,
  Audience,
  Condition,
  ConfigBlob,
  Flag,
  FlagVariation,
  Operator,
  RuleGroup,
  SubjectAttributes,
} from "./types";
import { LIST_OPERATORS, NULL_OPERATORS, OPERATORS } from "./types";

// ---------------------------------------------------------------------------
// Operator lookup (MD5 hash → operator name)
// ---------------------------------------------------------------------------

const HASHED_OPERATOR_LOOKUP: ReadonlyMap<string, Operator> = new Map(OPERATORS.map((op) => [md5(op), op]));

/** Resolve an operator from plain text (server format) or MD5 hash (client format). */
export function resolveOperator(operatorIdOrHash: string): Operator | undefined {
  if ((OPERATORS as readonly string[]).includes(operatorIdOrHash)) {
    return operatorIdOrHash as Operator;
  }
  return HASHED_OPERATOR_LOOKUP.get(operatorIdOrHash);
}

// ---------------------------------------------------------------------------
// Client-format attribute hashing
// ---------------------------------------------------------------------------

export function buildHashedAttributeLookup(
  attributes: SubjectAttributes,
): ReadonlyMap<string, string | number | boolean | string[]> {
  const lookup = new Map<string, string | number | boolean | string[]>();
  for (const key of Object.keys(attributes)) {
    lookup.set(md5(key), attributes[key]);
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Value decoding
// ---------------------------------------------------------------------------

export function decodeVariationValue(encodedValue: unknown): unknown {
  if (typeof encodedValue !== "string") return encodedValue;
  try {
    return JSON.parse(base64Decode(encodedValue)) as unknown;
  } catch {
    return encodedValue;
  }
}

export function decodeConditionValue(encodedValue: string): string {
  try {
    return base64Decode(encodedValue);
  } catch {
    return encodedValue;
  }
}

// ---------------------------------------------------------------------------
// Server → Client compilation
// ---------------------------------------------------------------------------

export function compileClientConfig(serverConfig: ConfigBlob): ConfigBlob {
  if (serverConfig.format !== "server") {
    throw new Error("Cannot compile a config that is already in client format");
  }

  const audiences: Record<string, Audience> = {};
  for (const [audienceId, audience] of Object.entries(serverConfig.audiences)) {
    audiences[md5(audienceId)] = obfuscateAudience(audience);
  }

  const flags: Record<string, Flag> = {};
  for (const [flagKey, flag] of Object.entries(serverConfig.flags)) {
    flags[md5(flagKey)] = obfuscateFlag(flag);
  }

  return {
    formatVersion: serverConfig.formatVersion,
    format: "client",
    environment: serverConfig.environment,
    version: serverConfig.version,
    generatedAt: serverConfig.generatedAt,
    totalShards: serverConfig.totalShards,
    audiences,
    flags,
  };
}

// ---------------------------------------------------------------------------
// Obfuscation helpers
// ---------------------------------------------------------------------------

function obfuscateAudience(audience: Audience): Audience {
  return { rules: audience.rules.map(obfuscateRuleGroup) };
}

function obfuscateRuleGroup(group: RuleGroup): RuleGroup {
  return { conditions: group.conditions.map(obfuscateCondition) };
}

function obfuscateCondition(condition: Condition): Condition {
  const operator = resolveOperator(condition.operator);
  const hashedOperator = md5(condition.operator);
  const hashedAttribute = md5(condition.attribute);

  if (!operator) {
    return {
      attribute: hashedAttribute,
      operator: hashedOperator,
      value: condition.value === null ? null : base64Encode(String(condition.value)),
    };
  }

  let obfuscatedValue: string | readonly string[] | null;

  if (NULL_OPERATORS.has(operator)) {
    obfuscatedValue = null;
  } else if (LIST_OPERATORS.has(operator)) {
    const values = Array.isArray(condition.value) ? condition.value : [];
    obfuscatedValue = values.flatMap((v) => (typeof v === "string" ? [md5(v)] : []));
  } else {
    // Scalar operators (GT, GTE, LT, LTE, MATCHES) — base64 encode
    obfuscatedValue = base64Encode(String(condition.value));
  }

  return { attribute: hashedAttribute, operator: hashedOperator, value: obfuscatedValue };
}

function obfuscateFlag(flag: Flag): Flag {
  const variations: Record<string, FlagVariation> = {};
  for (const [variationId, variation] of Object.entries(flag.variations)) {
    variations[base64Encode(variationId)] = {
      value: base64Encode(JSON.stringify(variation.value)),
    };
  }

  return {
    type: base64Encode(flag.type),
    enabled: flag.enabled,
    variations,
    offVariationId: base64Encode(flag.offVariationId),
    defaultVariationId: base64Encode(flag.defaultVariationId),
    assignments: flag.assignments.map(obfuscateAssignment),
  };
}

function obfuscateAssignment(assignment: Assignment): Assignment {
  return {
    id: assignment.id, // Salt stays plain for deterministic hashing
    audienceId: assignment.audienceId ? md5(assignment.audienceId) : undefined,
    rules: assignment.rules.map(obfuscateRuleGroup),
    variations: assignment.variations.map(obfuscateAssignmentVariation),
  };
}

function obfuscateAssignmentVariation(av: AssignmentVariation): AssignmentVariation {
  return {
    variationId: base64Encode(av.variationId),
    shardRanges: av.shardRanges,
  };
}
