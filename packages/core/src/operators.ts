/**
 * @module operators
 *
 * Operator evaluation logic for targeting conditions.
 *
 * Each operator takes a context value (from the user) and a condition value
 * (from the config), both as strings, and returns a boolean.
 *
 * The evaluation engine coerces context values to strings before passing them
 * here. Numeric and date comparisons parse the string representations.
 */

import type { Operator } from "./types.js";

/**
 * Evaluate a single operator against a context value and condition value.
 *
 * @param operator       - The operator to evaluate
 * @param contextValue   - The value from the user's context (as string)
 * @param conditionValue - The value from the config condition (as string)
 * @returns Whether the condition is satisfied
 */
export function evaluateOperator(operator: Operator, contextValue: string, conditionValue: string): boolean {
  switch (operator) {
    case "IS":
      return contextValue === conditionValue;

    case "IS_NOT":
      return contextValue !== conditionValue;

    case "CONTAINS":
      return contextValue.includes(conditionValue);

    case "NOT_CONTAINS":
      return !contextValue.includes(conditionValue);

    case "STARTS_WITH":
      return contextValue.startsWith(conditionValue);

    case "ENDS_WITH":
      return contextValue.endsWith(conditionValue);

    case "MATCHES":
      return evaluateRegex(contextValue, conditionValue);

    case "GT":
      return compareNumeric(contextValue, conditionValue) > 0;

    case "GTE":
      return compareNumeric(contextValue, conditionValue) >= 0;

    case "LT":
      return compareNumeric(contextValue, conditionValue) < 0;

    case "LTE":
      return compareNumeric(contextValue, conditionValue) <= 0;

    case "SEMVER_EQ":
      return compareSemver(contextValue, conditionValue) === 0;

    case "SEMVER_GT":
      return compareSemver(contextValue, conditionValue) > 0;

    case "SEMVER_GTE":
      return compareSemver(contextValue, conditionValue) >= 0;

    case "SEMVER_LT":
      return compareSemver(contextValue, conditionValue) < 0;

    case "SEMVER_LTE":
      return compareSemver(contextValue, conditionValue) <= 0;

    case "BEFORE":
      return compareDate(contextValue, conditionValue) < 0;

    case "AFTER":
      return compareDate(contextValue, conditionValue) > 0;

    // ONE_OF and NOT_ONE_OF are handled separately in evaluate.ts
    // because they operate on arrays, not scalar values.
    case "ONE_OF":
    case "NOT_ONE_OF":
      return false;
  }
}

// ---------------------------------------------------------------------------
// Regex matching
// ---------------------------------------------------------------------------

function evaluateRegex(contextValue: string, pattern: string): boolean {
  try {
    const regex = new RegExp(pattern);
    return regex.test(contextValue);
  } catch {
    // Invalid regex patterns fail silently (no match)
    return false;
  }
}

// ---------------------------------------------------------------------------
// Numeric comparison
// ---------------------------------------------------------------------------

/**
 * Compare two values numerically.
 * Returns negative if a < b, positive if a > b, zero if equal.
 * If either value is not a valid number, returns NaN (which makes all comparisons false).
 */
function compareNumeric(a: string, b: string): number {
  const numA = Number(a);
  const numB = Number(b);

  if (Number.isNaN(numA) || Number.isNaN(numB)) {
    return NaN;
  }

  return numA - numB;
}

// ---------------------------------------------------------------------------
// Semantic version comparison
// ---------------------------------------------------------------------------

interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: string;
}

const SEMVER_REGEX = /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/;

function parseSemver(version: string): ParsedSemver | undefined {
  const match = SEMVER_REGEX.exec(version.trim());
  if (!match) return undefined;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? "",
  };
}

/**
 * Compare two semantic versions.
 * Returns negative if a < b, positive if a > b, zero if equal.
 * Prerelease versions are considered less than release versions.
 * If either version is not valid semver, returns NaN.
 */
function compareSemver(a: string, b: string): number {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);

  if (!parsedA || !parsedB) {
    return NaN;
  }

  if (parsedA.major !== parsedB.major) return parsedA.major - parsedB.major;
  if (parsedA.minor !== parsedB.minor) return parsedA.minor - parsedB.minor;
  if (parsedA.patch !== parsedB.patch) return parsedA.patch - parsedB.patch;

  // No prerelease on either = equal
  if (parsedA.prerelease === "" && parsedB.prerelease === "") return 0;
  // Prerelease < no prerelease
  if (parsedA.prerelease === "") return 1;
  if (parsedB.prerelease === "") return -1;
  // Compare prerelease lexicographically
  return parsedA.prerelease < parsedB.prerelease ? -1 : parsedA.prerelease > parsedB.prerelease ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Date comparison
// ---------------------------------------------------------------------------

/**
 * Compare two date values.
 * Accepts ISO 8601 strings or unix millisecond timestamps (as strings).
 * Returns negative if a < b, positive if a > b, zero if equal.
 * If either value is not a valid date, returns NaN.
 */
function compareDate(a: string, b: string): number {
  const dateA = parseDate(a);
  const dateB = parseDate(b);

  if (Number.isNaN(dateA) || Number.isNaN(dateB)) {
    return NaN;
  }

  return dateA - dateB;
}

function parseDate(value: string): number {
  // Try as unix ms timestamp first (pure digits)
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  // Try as ISO 8601
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? NaN : ms;
}
