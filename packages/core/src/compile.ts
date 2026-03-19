/**
 * @module compile
 *
 * Compiles InstantDB entities into a ConfigBlob (server format).
 *
 * The compiler is a pure function: entities in, blob out. It doesn't
 * interact with InstantDB or $storage — the caller handles I/O.
 *
 * Key responsibilities:
 *   - Aggregate all flags + variations + flagConfigs + assignments for one environment
 *   - Inline audience rules into the blob
 *   - Convert trafficExposure + variationSplits → pre-computed shard ranges
 *   - Produce a minimal, self-contained blob ready for SDK consumption
 */

import { CURRENT_FORMAT_VERSION } from "./types";
import type {
  AssignmentVariation,
  Assignment as BlobAssignment,
  Audience as BlobAudience,
  Flag as BlobFlag,
  RuleGroup as BlobRuleGroup,
  ConfigBlob,
  FlagVariation,
  ShardRange,
} from "./types";

// ---------------------------------------------------------------------------
// Input types (matching InstantDB entity shapes)
// ---------------------------------------------------------------------------

export interface CompileInput {
  envId: string;
  flags: EntityFlag[];
  variations: EntityVariation[];
  flagConfigs: EntityFlagConfig[];
  assignments: EntityAssignment[];
  audiences: EntityAudience[];
  /** Defaults to 10_000. */
  totalShards?: number;
  /** Monotonically increasing version. Caller manages this. */
  version?: number;
}

export interface EntityFlag {
  id: string;
  key: string;
  type: string;
  archivedAt?: number | null;
}

export interface EntityVariation {
  id: string;
  name: string;
  value: unknown;
  position: number;
  flagId: string;
}

export interface EntityFlagConfig {
  id: string;
  enabled: boolean;
  offVariationId: string;
  defaultVariationId: string;
  flagId: string;
  envId: string;
}

export interface EntityAssignment {
  id: string;
  name: string;
  position: number;
  rules: unknown; // RuleGroup[]
  trafficExposure: number;
  variationSplits: unknown; // { variationId: string, weight: number }[]
  flagConfigId: string;
  audienceId?: string | null;
}

export interface EntityAudience {
  id: string;
  rules: unknown; // RuleGroup[]
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

export function compileConfigBlob(input: CompileInput): ConfigBlob {
  const totalShards = input.totalShards ?? 10_000;

  // Index entities
  const variationsByFlag = groupBy(input.variations, (v) => v.flagId);
  const configsByFlag = groupBy(
    input.flagConfigs.filter((c) => c.envId === input.envId),
    (c) => c.flagId,
  );
  const assignmentsByConfig = groupBy(input.assignments, (a) => a.flagConfigId);

  // Compile audiences
  const audiences: Record<string, BlobAudience> = {};
  for (const audience of input.audiences) {
    audiences[audience.id] = { rules: (audience.rules ?? []) as BlobRuleGroup[] };
  }

  // Compile flags
  const flags: Record<string, BlobFlag> = {};

  for (const flag of input.flags) {
    // Skip archived flags
    if (flag.archivedAt) continue;

    const config = configsByFlag.get(flag.id)?.at(0);
    if (!config) continue;

    // Build variation map (ID → value)
    const flagVariations = variationsByFlag.get(flag.id) ?? [];
    const variations: Record<string, FlagVariation> = {};
    for (const v of flagVariations) {
      variations[v.id] = { value: v.value };
    }

    // Build assignments (sorted by position, shard ranges pre-computed)
    const rawAssignments = assignmentsByConfig.get(config.id) ?? [];
    const sortedAssignments = [...rawAssignments].sort((a, b) => a.position - b.position);

    const assignments: BlobAssignment[] = sortedAssignments.map((a) => compileAssignment(a, totalShards));

    flags[flag.key] = {
      type: flag.type,
      enabled: config.enabled,
      variations,
      offVariationId: config.offVariationId,
      defaultVariationId: config.defaultVariationId,
      assignments,
    };
  }

  return {
    formatVersion: CURRENT_FORMAT_VERSION,
    format: "server",
    environment: input.envId,
    version: input.version ?? 1,
    generatedAt: Date.now(),
    totalShards,
    audiences,
    flags,
  };
}

// ---------------------------------------------------------------------------
// Assignment compilation (trafficExposure + splits → shard ranges)
// ---------------------------------------------------------------------------

interface VariationSplit {
  variationId: string;
  weight: number;
}

function compileAssignment(entity: EntityAssignment, totalShards: number): BlobAssignment {
  const splits = (entity.variationSplits ?? []) as VariationSplit[];
  const rules = (entity.rules ?? []) as BlobRuleGroup[];

  return {
    id: entity.id,
    audienceId: entity.audienceId ?? undefined,
    rules,
    variations: computeShardRanges(splits, entity.trafficExposure, totalShards),
  };
}

/**
 * Convert trafficExposure (basis points) + variationSplits (weights)
 * into concrete shard ranges.
 *
 * Example: trafficExposure=5000 (50%), splits=[{A, 6000}, {B, 4000}]
 *   totalWeight = 10000
 *   A range: [0, 3000)    (6000/10000 * 5000)
 *   B range: [3000, 5000) (4000/10000 * 5000)
 *   Buckets 5000-9999 fall through (not in traffic)
 */
function computeShardRanges(
  splits: VariationSplit[],
  trafficExposure: number,
  totalShards: number,
): AssignmentVariation[] {
  const clampedExposure = Math.min(trafficExposure, totalShards);
  const totalWeight = splits.reduce((sum, s) => sum + s.weight, 0);

  if (totalWeight === 0 || clampedExposure === 0) {
    return splits.map((s) => ({ variationId: s.variationId, shardRanges: [] }));
  }

  // Use floor for all splits except the last, which eats the remainder.
  // This prevents rounding drift where 3x33.33% = 9999 instead of 10000.
  let cursor = 0;
  return splits.map((split, index) => {
    const isLast = index === splits.length - 1;
    const rangeSize = isLast ? clampedExposure - cursor : Math.floor((split.weight / totalWeight) * clampedExposure);
    const start = cursor;
    const end = Math.min(cursor + rangeSize, totalShards);
    cursor = end;

    const shardRanges: ShardRange[] = start < end ? [{ start, end }] : [];
    return { variationId: split.variationId, shardRanges };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = map.get(key);
    if (group) {
      group.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}
