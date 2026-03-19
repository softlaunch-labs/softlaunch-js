/**
 * @softlaunch/core
 *
 * Feature flag evaluation engine + config blob compiler.
 * Zero dependencies, runs in any JavaScript environment.
 */

// Types — config blob wire format
export type {
  Assignment,
  AssignmentVariation,
  Audience,
  Condition,
  ConfigBlob,
  ConfigFormat,
  SubjectAttributes,
  EvaluationDetail,
  EvaluationReason,
  Flag,
  FlagType,
  FlagVariation,
  Operator,
  RuleGroup,
  ShardRange,
} from "./types";

export { CURRENT_FORMAT_VERSION, LIST_OPERATORS, NULL_OPERATORS, OPERATORS } from "./types";

// Evaluation engine
export { evaluateFlag } from "./evaluate";

// Operator evaluation
export { evaluateOperator } from "./operators";

// Config blob compilation (entities → server blob)
export { compileConfigBlob } from "./compile";
export type {
  CompileInput,
  EntityAssignment,
  EntityAudience,
  EntityFlag,
  EntityFlagConfig,
  EntityVariation,
} from "./compile";

// Obfuscation (server blob → client blob)
export { compileClientConfig, resolveOperator } from "./obfuscate";

// Hashing utilities
export { base64Decode, base64Encode, computeBucket, md5 } from "./hash";

// SDK key serialization/deserialization
export { deserializeSdkKey, serializeSdkKey } from "./sdk-key";
