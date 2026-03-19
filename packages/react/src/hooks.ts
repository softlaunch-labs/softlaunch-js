import { evaluateFlag, resolveFlagType, type SubjectAttributes } from "@softlaunch/core";
import { use, useMemo, useRef } from "react";
import { SoftlaunchContext } from "./provider";

/**
 * Return type for all flag hooks. States are mutually exclusive:
 *   { isLoading: true,  error: undefined } — config is being fetched
 *   { isLoading: false, error: undefined } — config loaded, value is evaluated
 *   { isLoading: false, error: string    } — config failed to load, value is default
 */
export interface FlagResult<T> {
  value: T;
  isLoading: boolean;
  error: string | undefined;
}

// ---------------------------------------------------------------------------
// Typed flag hooks
// ---------------------------------------------------------------------------

export function useBooleanFlag(
  key: string,
  subjectKey: string,
  attributes: SubjectAttributes,
  defaultValue: boolean,
): FlagResult<boolean> {
  return useTypedFlag(key, subjectKey, attributes, defaultValue, "boolean");
}

export function useStringFlag(
  key: string,
  subjectKey: string,
  attributes: SubjectAttributes,
  defaultValue: string,
): FlagResult<string> {
  return useTypedFlag(key, subjectKey, attributes, defaultValue, "string");
}

export function useIntegerFlag(
  key: string,
  subjectKey: string,
  attributes: SubjectAttributes,
  defaultValue: number,
): FlagResult<number> {
  return useTypedFlag(key, subjectKey, attributes, defaultValue, "integer");
}

export function useNumericFlag(
  key: string,
  subjectKey: string,
  attributes: SubjectAttributes,
  defaultValue: number,
): FlagResult<number> {
  return useTypedFlag(key, subjectKey, attributes, defaultValue, "numeric");
}

export function useJsonFlag<T>(
  key: string,
  subjectKey: string,
  attributes: SubjectAttributes,
  defaultValue: T,
): FlagResult<T> {
  return useTypedFlag(key, subjectKey, attributes, defaultValue, "json");
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function useTypedFlag<T>(
  key: string,
  subjectKey: string,
  attributes: SubjectAttributes,
  defaultValue: T,
  expectedType: string,
): FlagResult<T> {
  const { config, isLoading, error } = use(SoftlaunchContext);

  // Stable attributes reference — shallow compare to avoid unnecessary re-evaluations
  const attributesRef = useRef(attributes);
  if (!shallowEqual(attributesRef.current, attributes)) {
    attributesRef.current = attributes;
  }
  const stableAttributes = attributesRef.current;

  const value = useMemo(() => {
    if (!config) return defaultValue;
    const flagType = resolveFlagType(config, key);
    if (flagType !== undefined && flagType !== expectedType) return defaultValue;
    return evaluateFlag(config, key, subjectKey, stableAttributes, defaultValue).value;
  }, [config, key, subjectKey, stableAttributes, defaultValue, expectedType]);

  return { value, isLoading, error };
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => a[k] === b[k]);
}
