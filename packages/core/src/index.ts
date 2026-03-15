/**
 * @softlaunch/sdk-core
 *
 * The Softlaunch feature flag evaluation engine.
 * Zero dependencies, runs in any JavaScript environment.
 *
 * Used by:
 * - @softlaunch/js (browser SDK)
 * - @softlaunch/react (React SDK)
 * - @softlaunch/node (server SDK)
 * - Softlaunch dashboard (config compilation + test mode)
 * - Softlaunch CLI (local flag evaluation)
 */

// Types — the config blob wire format
export type {
  AttributeCondition,
  Condition,
  ConfigBlob,
  ConfigFormat,
  EvaluationContext,
  EvaluationDetail,
  EvaluationReason,
  Flag,
  FlagType,
  FlagVariation,
  FixedServeConfig,
  IndividualTarget,
  Operator,
  Prerequisite,
  RolloutServeConfig,
  RolloutVariation,
  RuleCondition,
  Segment,
  SegmentCondition,
  SegmentRule,
  ServeConfig,
  ShardRange,
  TargetingRule,
} from "./types.js";

export {
  COMPARISON_OPERATORS,
  CURRENT_FORMAT_VERSION,
  EQUALITY_OPERATORS,
  LIST_OPERATORS,
  OPERATORS,
  PATTERN_OPERATORS,
} from "./types.js";

// Evaluation engine
export { evaluateAllFlags, evaluateFlag } from "./evaluate.js";

// Operator evaluation (exposed for testing and custom operator implementations)
export { evaluateOperator } from "./operators.js";

// Hashing utilities
export { base64Decode, base64Encode, computeBucket, md5 } from "./hash.js";

// Obfuscation (server → client config compilation)
export { compileClientConfig, resolveOperator } from "./obfuscate.js";

// SDK key serialization/deserialization
export { deserializeSdkKey, serializeSdkKey } from "./sdk-key.js";
