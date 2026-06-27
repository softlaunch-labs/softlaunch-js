import { evaluateFlag, resolveFlagType, type SubjectAttributes } from "@softlaunch/core";
import { useContext, useMemo, useRef } from "react";
import { SoftlaunchContext } from "./provider";

/**
 * Return type for all flag hooks.
 *   isLoading  — first load, no config yet, value is the default
 *   isFetching — re-fetching in background, value is from previous config (stale but usable)
 *   error      — fetch failed, value is the default (or previous if available)
 */
export interface FlagResult<T> {
  value: T;
  isLoading: boolean;
  isFetching: boolean;
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
  const { config, isLoading, isFetching, error } = useContext(SoftlaunchContext);

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

  return { value, isLoading, isFetching, error };
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => a[k] === b[k]);
}
