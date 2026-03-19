/**
 * @module operators
 *
 * Scalar operator evaluation. Each function takes two strings and returns a boolean.
 * List operators (ONE_OF, NOT_ONE_OF) and null operators (IS_NULL, IS_NOT_NULL)
 * are handled directly in the evaluator.
 */

import type { Operator } from "./types";

export function evaluateOperator(operator: Operator, attributeValue: string, conditionValue: string): boolean {
  switch (operator) {
    case "MATCHES":
      return evaluateRegex(attributeValue, conditionValue);
    case "GT":
      return compareNumeric(attributeValue, conditionValue) > 0;
    case "GTE":
      return compareNumeric(attributeValue, conditionValue) >= 0;
    case "LT":
      return compareNumeric(attributeValue, conditionValue) < 0;
    case "LTE":
      return compareNumeric(attributeValue, conditionValue) <= 0;
    // List/null operators handled in evaluator — should not reach here
    case "ONE_OF":
    case "NOT_ONE_OF":
    case "IS_NULL":
    case "IS_NOT_NULL":
      return false;
  }
}

function evaluateRegex(attributeValue: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(attributeValue);
  } catch {
    return false;
  }
}

/** Returns NaN for non-numeric strings, making all comparisons return false. */
function compareNumeric(a: string, b: string): number {
  const numA = Number(a);
  const numB = Number(b);
  if (Number.isNaN(numA) || Number.isNaN(numB)) return NaN;
  return numA - numB;
}
