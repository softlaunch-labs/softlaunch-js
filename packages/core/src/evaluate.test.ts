import { describe, expect, it } from "vitest";
import { compileConfigBlob } from "./compile";
import { evaluateFlag } from "./evaluate";
import { compileClientConfig } from "./obfuscate";
import type { Assignment, ConfigBlob, Flag } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(flags: Record<string, Flag>, audiences?: ConfigBlob["audiences"]): ConfigBlob {
  return {
    formatVersion: 1,
    format: "server",
    environment: "test",
    version: 1,
    generatedAt: Date.now(),
    totalShards: 10_000,
    audiences: audiences ?? {},
    flags,
  };
}

function boolFlag(overrides: Partial<Flag> = {}): Flag {
  return {
    type: "boolean",
    enabled: true,
    variations: { v1: { value: true }, v2: { value: false } },
    offVariationId: "v2",
    defaultVariationId: "v2",
    assignments: [],
    ...overrides,
  };
}

function fixedAssignment(id: string, variationId: string, overrides: Partial<Assignment> = {}): Assignment {
  return {
    id,
    audienceId: undefined,
    rules: [],
    variations: [{ variationId, shardRanges: [{ start: 0, end: 10000 }] }],
    ...overrides,
  };
}

const subjectKey = "user-123";
const attrs = { email: "alice@langchain.dev", plan: "enterprise", age: 30 };

// ===========================================================================
// Flag lookup
// ===========================================================================

describe("flag lookup", () => {
  it("returns default when flag not found", () => {
    const r = evaluateFlag(makeConfig({}), "nope", subjectKey, attrs, "fallback");
    expect(r.value).toBe("fallback");
    expect(r.reason).toBe("FLAG_NOT_FOUND");
    expect(r.variationId).toBeUndefined();
    expect(r.assignmentId).toBeUndefined();
  });

  it("evaluates multiple flags independently", () => {
    const config = makeConfig({
      "flag-a": boolFlag({ assignments: [fixedAssignment("a1", "v1")] }),
      "flag-b": boolFlag({ enabled: false }),
    });
    expect(evaluateFlag(config, "flag-a", subjectKey, attrs, false).value).toBe(true);
    expect(evaluateFlag(config, "flag-b", subjectKey, attrs, true).value).toBe(false);
    expect(evaluateFlag(config, "flag-c", subjectKey, attrs, "default").value).toBe("default");
  });
});

// ===========================================================================
// Flag disabled
// ===========================================================================

describe("flag disabled", () => {
  it("returns offVariationId", () => {
    const r = evaluateFlag(makeConfig({ f: boolFlag({ enabled: false }) }), "f", subjectKey, attrs, true);
    expect(r.value).toBe(false);
    expect(r.variationId).toBe("v2");
    expect(r.reason).toBe("OFF");
  });

  it("ignores assignments when disabled", () => {
    const config = makeConfig({
      f: boolFlag({
        enabled: false,
        assignments: [fixedAssignment("a1", "v1")],
      }),
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, true).value).toBe(false);
  });
});

// ===========================================================================
// Operators
// ===========================================================================

describe("operators — ONE_OF / NOT_ONE_OF", () => {
  it("ONE_OF matches single value", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "plan", operator: "ONE_OF", value: ["enterprise"] }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).value).toBe(true);
  });

  it("ONE_OF matches one of multiple values", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "plan", operator: "ONE_OF", value: ["free", "enterprise", "pro"] }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).value).toBe(true);
  });

  it("ONE_OF fails when no match", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "plan", operator: "ONE_OF", value: ["free", "pro"] }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).reason).toBe("DEFAULT");
  });

  it("NOT_ONE_OF matches when value not in list", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "plan", operator: "NOT_ONE_OF", value: ["free", "pro"] }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).value).toBe(true);
  });

  it("NOT_ONE_OF fails when value is in list", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "plan", operator: "NOT_ONE_OF", value: ["enterprise"] }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).reason).toBe("DEFAULT");
  });
});

describe("operators — MATCHES (regex)", () => {
  it("matches regex pattern", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "email", operator: "MATCHES", value: "@langchain\\.dev$" }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).value).toBe(true);
    expect(evaluateFlag(config, "f", "u2", { email: "x@gmail.com" }, false).reason).toBe("DEFAULT");
  });

  it("invalid regex fails silently (no match)", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "email", operator: "MATCHES", value: "[invalid" }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).reason).toBe("DEFAULT");
  });
});

describe("operators — GT/GTE/LT/LTE", () => {
  it("GT with numeric context value", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "age", operator: "GT", value: "18" }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", "u1", { age: 30 }, false).value).toBe(true);
    expect(evaluateFlag(config, "f", "u2", { age: 18 }, false).reason).toBe("DEFAULT");
    expect(evaluateFlag(config, "f", "u3", { age: 10 }, false).reason).toBe("DEFAULT");
  });

  it("GTE includes equal", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "age", operator: "GTE", value: "18" }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", "u1", { age: 18 }, false).value).toBe(true);
  });

  it("LT and LTE", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "age", operator: "LT", value: "21" }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", "u1", { age: 20 }, false).value).toBe(true);
    expect(evaluateFlag(config, "f", "u2", { age: 21 }, false).reason).toBe("DEFAULT");
  });

  it("LTE — boundary value matches", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "age", operator: "LTE", value: "21" }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", "u1", { age: 21 }, false).value).toBe(true);
    expect(evaluateFlag(config, "f", "u2", { age: 22 }, false).reason).toBe("DEFAULT");
  });
});

describe("operators — IS_NULL / IS_NOT_NULL", () => {
  it("IS_NULL matches missing attribute", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "nonexistent", operator: "IS_NULL", value: null }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).value).toBe(true);
  });

  it("IS_NULL fails on present attribute", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "email", operator: "IS_NULL", value: null }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).reason).toBe("DEFAULT");
  });

  it("IS_NOT_NULL matches present attribute", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "email", operator: "IS_NOT_NULL", value: null }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).value).toBe(true);
  });

  it("IS_NOT_NULL fails on missing attribute", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "nonexistent", operator: "IS_NOT_NULL", value: null }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).reason).toBe("DEFAULT");
  });
});

// ===========================================================================
// Rule logic (AND / OR)
// ===========================================================================

describe("rule logic", () => {
  it("AND: all conditions must match within a group", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [
              {
                conditions: [
                  { attribute: "plan", operator: "ONE_OF", value: ["enterprise"] },
                  { attribute: "email", operator: "MATCHES", value: "@langchain\\.dev$" },
                ],
              },
            ],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).value).toBe(true);
    expect(evaluateFlag(config, "f", "u2", { plan: "enterprise", email: "x@other.com" }, false).reason).toBe("DEFAULT");
  });

  it("OR: any group can match", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [
              { conditions: [{ attribute: "plan", operator: "ONE_OF", value: ["enterprise"] }] },
              { conditions: [{ attribute: "email", operator: "MATCHES", value: "@langchain\\.dev$" }] },
            ],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", "u1", { plan: "enterprise" }, false).value).toBe(true);
    expect(evaluateFlag(config, "f", "u2", { email: "bob@langchain.dev" }, false).value).toBe(true);
    expect(evaluateFlag(config, "f", "u3", { plan: "free", email: "x@other.com" }, false).reason).toBe("DEFAULT");
  });

  it("empty rules = match all (catch-all)", () => {
    const config = makeConfig({
      f: boolFlag({ assignments: [fixedAssignment("a1", "v1")] }),
    });
    expect(evaluateFlag(config, "f", "anyone", {}, false).value).toBe(true);
  });

  it("missing attribute fails condition (non-null operators)", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "nonexistent", operator: "ONE_OF", value: ["x"] }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).reason).toBe("DEFAULT");
  });
});

// ===========================================================================
// Assignment ordering + traffic exposure
// ===========================================================================

describe("assignment ordering + traffic", () => {
  it("first matching assignment wins", () => {
    const config = makeConfig({
      f: {
        type: "string",
        enabled: true,
        variations: { a: { value: "first" }, b: { value: "second" }, c: { value: "default" } },
        offVariationId: "c",
        defaultVariationId: "c",
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "plan", operator: "ONE_OF", value: ["enterprise"] }] }],
            variations: [{ variationId: "a", shardRanges: [{ start: 0, end: 10000 }] }],
          },
          {
            id: "a2",
            audienceId: undefined,
            rules: [],
            variations: [{ variationId: "b", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      },
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, "default").value).toBe("first");
  });

  it("bucket outside traffic exposure falls through to next assignment", () => {
    const config = makeConfig({
      f: {
        type: "string",
        enabled: true,
        variations: { a: { value: "first" }, b: { value: "second" }, c: { value: "default" } },
        offVariationId: "c",
        defaultVariationId: "c",
        assignments: [
          // 0.01% traffic — almost nobody matches
          {
            id: "a1",
            audienceId: undefined,
            rules: [],
            variations: [{ variationId: "a", shardRanges: [{ start: 0, end: 1 }] }],
          },
          // Catch-all
          {
            id: "a2",
            audienceId: undefined,
            rules: [],
            variations: [{ variationId: "b", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      },
    });

    // Most users should get "second" (from a2), not "first" (from a1)
    let secondCount = 0;
    for (let i = 0; i < 100; i++) {
      if (evaluateFlag(config, "f", `u-${i}`, {}, "default").value === "second") secondCount++;
    }
    expect(secondCount).toBeGreaterThan(95);
  });

  it("deterministic: same context always gets same result", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [],
            variations: [
              { variationId: "v1", shardRanges: [{ start: 0, end: 5000 }] },
              { variationId: "v2", shardRanges: [{ start: 5000, end: 10000 }] },
            ],
          },
        ],
      }),
    });
    const results = Array.from({ length: 10 }, () => evaluateFlag(config, "f", subjectKey, attrs, false));
    expect(results.every((r) => r.value === results.at(0)?.value)).toBe(true);
  });
});

// ===========================================================================
// Audiences
// ===========================================================================

describe("audiences", () => {
  it("uses audience rules when audienceId is set", () => {
    const config = makeConfig(
      {
        f: boolFlag({
          assignments: [
            {
              id: "a1",
              audienceId: "aud-1",
              rules: [],
              variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
            },
          ],
        }),
      },
      {
        "aud-1": { rules: [{ conditions: [{ attribute: "email", operator: "MATCHES", value: "@langchain\\.dev$" }] }] },
      },
    );
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).value).toBe(true);
    expect(evaluateFlag(config, "f", "u2", { email: "x@gmail.com" }, false).reason).toBe("DEFAULT");
  });

  it("missing audience → fail closed (no match), not match all", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: "nonexistent",
            rules: [],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    // Missing audience must NOT match — fail closed to prevent accidental exposure
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).reason).toBe("DEFAULT");
    expect(evaluateFlag(config, "f", subjectKey, attrs, false).value).toBe(false);
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe("edge cases", () => {
  it("variation ID referenced but missing → returns defaultValue with undefined variationId", () => {
    const config = makeConfig({
      f: boolFlag({ offVariationId: "nonexistent", enabled: false }),
    });
    const r = evaluateFlag(config, "f", subjectKey, attrs, "fallback");
    expect(r.value).toBe("fallback");
    expect(r.reason).toBe("OFF");
    expect(r.variationId).toBeUndefined();
  });

  it("empty variations map → returns defaultValue with undefined variationId", () => {
    const config = makeConfig({
      f: {
        type: "boolean",
        enabled: true,
        variations: {},
        offVariationId: "v1",
        defaultVariationId: "v1",
        assignments: [],
      },
    });
    const r = evaluateFlag(config, "f", subjectKey, attrs, false);
    expect(r.value).toBe(false);
    expect(r.reason).toBe("DEFAULT");
    expect(r.variationId).toBeUndefined();
  });

  it("context value is a boolean", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "admin", operator: "ONE_OF", value: ["true"] }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", "u1", { admin: true }, false).value).toBe(true);
    expect(evaluateFlag(config, "f", "u2", { admin: false }, false).reason).toBe("DEFAULT");
  });

  it("context value is a number (coerced to string for ONE_OF)", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "age", operator: "ONE_OF", value: ["30"] }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", "u1", { age: 30 }, false).value).toBe(true);
  });
});

// ===========================================================================
// Flag types
// ===========================================================================

describe("flag types", () => {
  it("string flag", () => {
    const config = makeConfig({
      f: {
        type: "string",
        enabled: true,
        variations: { ctrl: { value: "control" }, treat: { value: "treatment" } },
        offVariationId: "ctrl",
        defaultVariationId: "ctrl",
        assignments: [fixedAssignment("a1", "treat")],
      },
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, "control").value).toBe("treatment");
  });

  it("integer flag", () => {
    const config = makeConfig({
      f: {
        type: "integer",
        enabled: true,
        variations: { low: { value: 100 }, high: { value: 2000 } },
        offVariationId: "low",
        defaultVariationId: "low",
        assignments: [fixedAssignment("a1", "high")],
      },
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, 100).value).toBe(2000);
  });

  it("numeric flag", () => {
    const config = makeConfig({
      f: {
        type: "numeric",
        enabled: true,
        variations: { a: { value: 0.5 }, b: { value: 3.14 } },
        offVariationId: "a",
        defaultVariationId: "a",
        assignments: [fixedAssignment("a1", "b")],
      },
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, 0.5).value).toBe(3.14);
  });

  it("json flag", () => {
    const config = makeConfig({
      f: {
        type: "json",
        enabled: true,
        variations: {
          default: { value: { theme: "light" } },
          dark: { value: { theme: "dark", sidebar: false } },
        },
        offVariationId: "default",
        defaultVariationId: "default",
        assignments: [fixedAssignment("a1", "dark")],
      },
    });
    expect(evaluateFlag(config, "f", subjectKey, attrs, {}).value).toEqual({ theme: "dark", sidebar: false });
  });
});

// ===========================================================================
// Compiler
// ===========================================================================

describe("compiler", () => {
  it("compiles entities into evaluable blob", () => {
    const blob = compileConfigBlob({
      envId: "env-1",
      flags: [{ id: "f1", key: "my-flag", type: "boolean" }],
      variations: [
        { id: "v1", name: "True", value: true, position: 0, flagId: "f1" },
        { id: "v2", name: "False", value: false, position: 1, flagId: "f1" },
      ],
      flagConfigs: [
        { id: "fc1", enabled: true, offVariationId: "v2", defaultVariationId: "v2", flagId: "f1", envId: "env-1" },
      ],
      assignments: [
        {
          id: "a1",
          name: "All",
          position: 0,
          rules: [],
          trafficExposure: 10000,
          variationSplits: [{ variationId: "v1", weight: 10000 }],
          flagConfigId: "fc1",
        },
      ],
      audiences: [],
    });
    expect(blob.formatVersion).toBe(1);
    expect(evaluateFlag(blob, "my-flag", "anyone", {}, false).value).toBe(true);
  });

  it("skips archived flags", () => {
    const blob = compileConfigBlob({
      envId: "env-1",
      flags: [{ id: "f1", key: "archived", type: "boolean", archivedAt: Date.now() }],
      variations: [{ id: "v1", name: "T", value: true, position: 0, flagId: "f1" }],
      flagConfigs: [
        { id: "fc1", enabled: true, offVariationId: "v1", defaultVariationId: "v1", flagId: "f1", envId: "env-1" },
      ],
      assignments: [],
      audiences: [],
    });
    expect(blob.flags["archived"]).toBeUndefined();
  });

  it("skips flags without config for this environment", () => {
    const blob = compileConfigBlob({
      envId: "env-1",
      flags: [{ id: "f1", key: "no-config", type: "boolean" }],
      variations: [{ id: "v1", name: "T", value: true, position: 0, flagId: "f1" }],
      flagConfigs: [
        { id: "fc1", enabled: true, offVariationId: "v1", defaultVariationId: "v1", flagId: "f1", envId: "env-OTHER" },
      ],
      assignments: [],
      audiences: [],
    });
    expect(blob.flags["no-config"]).toBeUndefined();
  });

  it("compiles multiple flags", () => {
    const blob = compileConfigBlob({
      envId: "e1",
      flags: [
        { id: "f1", key: "flag-a", type: "boolean" },
        { id: "f2", key: "flag-b", type: "string" },
      ],
      variations: [
        { id: "v1", name: "T", value: true, position: 0, flagId: "f1" },
        { id: "v2", name: "F", value: false, position: 1, flagId: "f1" },
        { id: "v3", name: "Ctrl", value: "ctrl", position: 0, flagId: "f2" },
        { id: "v4", name: "Treat", value: "treat", position: 1, flagId: "f2" },
      ],
      flagConfigs: [
        { id: "fc1", enabled: true, offVariationId: "v2", defaultVariationId: "v2", flagId: "f1", envId: "e1" },
        { id: "fc2", enabled: true, offVariationId: "v3", defaultVariationId: "v3", flagId: "f2", envId: "e1" },
      ],
      assignments: [
        {
          id: "a1",
          name: "All",
          position: 0,
          rules: [],
          trafficExposure: 10000,
          variationSplits: [{ variationId: "v1", weight: 10000 }],
          flagConfigId: "fc1",
        },
        {
          id: "a2",
          name: "All",
          position: 0,
          rules: [],
          trafficExposure: 10000,
          variationSplits: [{ variationId: "v4", weight: 10000 }],
          flagConfigId: "fc2",
        },
      ],
      audiences: [],
    });
    expect(evaluateFlag(blob, "flag-a", subjectKey, attrs, false).value).toBe(true);
    expect(evaluateFlag(blob, "flag-b", subjectKey, attrs, "ctrl").value).toBe("treat");
  });

  it("includes audience in blob when referenced by assignment", () => {
    const blob = compileConfigBlob({
      envId: "e1",
      flags: [{ id: "f1", key: "f", type: "boolean" }],
      variations: [
        { id: "v1", name: "T", value: true, position: 0, flagId: "f1" },
        { id: "v2", name: "F", value: false, position: 1, flagId: "f1" },
      ],
      flagConfigs: [
        { id: "fc1", enabled: true, offVariationId: "v2", defaultVariationId: "v2", flagId: "f1", envId: "e1" },
      ],
      assignments: [
        {
          id: "a1",
          name: "Internal",
          position: 0,
          rules: [],
          trafficExposure: 10000,
          variationSplits: [{ variationId: "v1", weight: 10000 }],
          flagConfigId: "fc1",
          audienceId: "aud-1",
        },
      ],
      audiences: [
        {
          id: "aud-1",
          rules: [{ conditions: [{ attribute: "email", operator: "MATCHES", value: "@langchain\\.dev$" }] }],
        },
      ],
    });
    expect(blob.audiences["aud-1"]).toBeDefined();
    expect(evaluateFlag(blob, "f", subjectKey, attrs, false).value).toBe(true);
    expect(evaluateFlag(blob, "f", "u2", { email: "x@gmail.com" }, false).reason).toBe("DEFAULT");
  });

  it("sorts assignments by position", () => {
    const blob = compileConfigBlob({
      envId: "e1",
      flags: [{ id: "f1", key: "f", type: "string" }],
      variations: [
        { id: "va", name: "A", value: "a", position: 0, flagId: "f1" },
        { id: "vb", name: "B", value: "b", position: 1, flagId: "f1" },
        { id: "vc", name: "C", value: "c", position: 2, flagId: "f1" },
      ],
      flagConfigs: [
        { id: "fc1", enabled: true, offVariationId: "vc", defaultVariationId: "vc", flagId: "f1", envId: "e1" },
      ],
      assignments: [
        // Inserted out of order
        {
          id: "a2",
          name: "Second",
          position: 1,
          rules: [],
          trafficExposure: 10000,
          variationSplits: [{ variationId: "vb", weight: 10000 }],
          flagConfigId: "fc1",
        },
        {
          id: "a1",
          name: "First",
          position: 0,
          rules: [],
          trafficExposure: 10000,
          variationSplits: [{ variationId: "va", weight: 10000 }],
          flagConfigId: "fc1",
        },
      ],
      audiences: [],
    });
    // First assignment (position 0) should win
    expect(evaluateFlag(blob, "f", subjectKey, attrs, "c").value).toBe("a");
  });

  it("computes shard ranges correctly", () => {
    const blob = compileConfigBlob({
      envId: "e1",
      flags: [{ id: "f1", key: "f", type: "boolean" }],
      variations: [
        { id: "v1", name: "A", value: true, position: 0, flagId: "f1" },
        { id: "v2", name: "B", value: false, position: 1, flagId: "f1" },
      ],
      flagConfigs: [
        { id: "fc1", enabled: true, offVariationId: "v2", defaultVariationId: "v2", flagId: "f1", envId: "e1" },
      ],
      assignments: [
        {
          id: "a1",
          name: "50/50 at 50%",
          position: 0,
          rules: [],
          trafficExposure: 5000,
          variationSplits: [
            { variationId: "v1", weight: 5000 },
            { variationId: "v2", weight: 5000 },
          ],
          flagConfigId: "fc1",
        },
      ],
      audiences: [],
    });
    const a = blob.flags["f"]?.assignments.at(0);
    expect(a?.variations.at(0)?.shardRanges).toEqual([{ start: 0, end: 2500 }]);
    expect(a?.variations.at(1)?.shardRanges).toEqual([{ start: 2500, end: 5000 }]);
  });

  it("zero traffic exposure = empty shard ranges", () => {
    const blob = compileConfigBlob({
      envId: "e1",
      flags: [{ id: "f1", key: "f", type: "boolean" }],
      variations: [{ id: "v1", name: "T", value: true, position: 0, flagId: "f1" }],
      flagConfigs: [
        { id: "fc1", enabled: true, offVariationId: "v1", defaultVariationId: "v1", flagId: "f1", envId: "e1" },
      ],
      assignments: [
        {
          id: "a1",
          name: "Zero",
          position: 0,
          rules: [],
          trafficExposure: 0,
          variationSplits: [{ variationId: "v1", weight: 10000 }],
          flagConfigId: "fc1",
        },
      ],
      audiences: [],
    });
    const a = blob.flags["f"]?.assignments.at(0);
    expect(a?.variations.at(0)?.shardRanges).toEqual([]);
  });

  it("handles null rules/variationSplits from DB gracefully", () => {
    const blob = compileConfigBlob({
      envId: "e1",
      flags: [{ id: "f1", key: "f", type: "boolean" }],
      variations: [
        { id: "v1", name: "T", value: true, position: 0, flagId: "f1" },
        { id: "v2", name: "F", value: false, position: 1, flagId: "f1" },
      ],
      flagConfigs: [
        { id: "fc1", enabled: true, offVariationId: "v2", defaultVariationId: "v2", flagId: "f1", envId: "e1" },
      ],
      assignments: [
        {
          id: "a1",
          name: "Null fields",
          position: 0,
          rules: null as unknown as [],
          trafficExposure: 10000,
          variationSplits: null as unknown as [],
          flagConfigId: "fc1",
        },
      ],
      audiences: [],
    });
    // Should not throw, assignment should have empty rules and no shard ranges
    const assignment = blob.flags["f"]?.assignments.at(0);
    expect(assignment?.rules).toEqual([]);
    expect(assignment?.variations).toEqual([]);
  });

  it("3-way split with rounding — last split eats remainder", () => {
    const blob = compileConfigBlob({
      envId: "e1",
      flags: [{ id: "f1", key: "f", type: "string" }],
      variations: [
        { id: "a", name: "A", value: "a", position: 0, flagId: "f1" },
        { id: "b", name: "B", value: "b", position: 1, flagId: "f1" },
        { id: "c", name: "C", value: "c", position: 2, flagId: "f1" },
      ],
      flagConfigs: [
        { id: "fc1", enabled: true, offVariationId: "a", defaultVariationId: "a", flagId: "f1", envId: "e1" },
      ],
      assignments: [
        {
          id: "a1",
          name: "Three way",
          position: 0,
          rules: [],
          trafficExposure: 10000,
          variationSplits: [
            { variationId: "a", weight: 3333 },
            { variationId: "b", weight: 3333 },
            { variationId: "c", weight: 3334 },
          ],
          flagConfigId: "fc1",
        },
      ],
      audiences: [],
    });
    // All 10000 shards should be covered with no gaps
    const ranges = blob.flags["f"]?.assignments.at(0)?.variations;
    const totalCovered = ranges?.reduce((sum, v) => sum + v.shardRanges.reduce((s, r) => s + (r.end - r.start), 0), 0);
    expect(totalCovered).toBe(10000);

    // Last range should end at exactly 10000
    const lastRange = ranges?.at(-1)?.shardRanges.at(0);
    expect(lastRange?.end).toBe(10000);
  });

  it("flag with no variations produces empty variation map", () => {
    const blob = compileConfigBlob({
      envId: "e1",
      flags: [{ id: "f1", key: "f", type: "boolean" }],
      variations: [], // No variations for this flag
      flagConfigs: [
        { id: "fc1", enabled: true, offVariationId: "v1", defaultVariationId: "v1", flagId: "f1", envId: "e1" },
      ],
      assignments: [],
      audiences: [],
    });
    expect(blob.flags["f"]?.variations).toEqual({});
  });

  it("includes referenced audiences in blob", () => {
    const blob = compileConfigBlob({
      envId: "e1",
      flags: [{ id: "f1", key: "f", type: "boolean" }],
      variations: [{ id: "v1", name: "T", value: true, position: 0, flagId: "f1" }],
      flagConfigs: [
        { id: "fc1", enabled: true, offVariationId: "v1", defaultVariationId: "v1", flagId: "f1", envId: "e1" },
      ],
      assignments: [
        {
          id: "a1",
          name: "Beta",
          position: 0,
          rules: [],
          trafficExposure: 10000,
          variationSplits: [{ variationId: "v1", weight: 10000 }],
          flagConfigId: "fc1",
          audienceId: "aud-1",
        },
      ],
      audiences: [
        { id: "aud-1", rules: [{ conditions: [{ attribute: "email", operator: "MATCHES", value: "@beta\\.com$" }] }] },
      ],
    });
    expect(blob.audiences["aud-1"]).toBeDefined();
    expect(blob.audiences["aud-1"]?.rules).toHaveLength(1);
  });
});

// ===========================================================================
// Client format (obfuscation parity)
// ===========================================================================

describe("client format parity", () => {
  const serverConfig = makeConfig(
    {
      dashboard: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: "aud-1",
            rules: [],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
          {
            id: "a2",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "plan", operator: "ONE_OF", value: ["enterprise"] }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
          {
            id: "a3",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "age", operator: "GT", value: "21" }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
          {
            id: "a4",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "verified", operator: "IS_NOT_NULL", value: null }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    },
    { "aud-1": { rules: [{ conditions: [{ attribute: "email", operator: "MATCHES", value: "@langchain\\.dev$" }] }] } },
  );

  const clientConfig = compileClientConfig(serverConfig);

  it("compiles to client format", () => {
    expect(clientConfig.format).toBe("client");
    expect(Object.keys(clientConfig.flags).at(0)).toMatch(/^[0-9a-f]{32}$/);
  });

  const contexts: Array<{ subjectKey: string; subjectAttributes: Record<string, string | number | boolean> }> = [
    { subjectKey: "u1", subjectAttributes: { email: "alice@langchain.dev" } },
    { subjectKey: "u2", subjectAttributes: { plan: "enterprise", email: "x@gmail.com" } },
    { subjectKey: "u3", subjectAttributes: { plan: "free", email: "x@gmail.com" } },
    { subjectKey: "u4", subjectAttributes: { age: 25 } },
    { subjectKey: "u5", subjectAttributes: { verified: true } },
    { subjectKey: "u6", subjectAttributes: {} },
  ];

  for (const c of contexts) {
    it(`same result for context key=${c.subjectKey}`, () => {
      const s = evaluateFlag(serverConfig, "dashboard", c.subjectKey, c.subjectAttributes, false);
      const cl = evaluateFlag(clientConfig, "dashboard", c.subjectKey, c.subjectAttributes, false);
      expect(cl.value).toBe(s.value);
      expect(cl.reason).toBe(s.reason);
    });
  }
});

// ===========================================================================
// Format version
// ===========================================================================

describe("format version", () => {
  it("rejects config with unsupported format version", () => {
    const config: ConfigBlob = {
      ...makeConfig({ f: boolFlag() }),
      formatVersion: 999,
    };
    const r = evaluateFlag(config, "f", subjectKey, attrs, false);
    expect(r.value).toBe(false);
    expect(r.reason).toBe("ERROR");
    expect(r.errorMessage).toContain("999");
    expect(r.variationId).toBeUndefined();
  });

  it("accepts config with current format version", () => {
    const config = makeConfig({ f: boolFlag({ assignments: [fixedAssignment("a1", "v1")] }) });
    const r = evaluateFlag(config, "f", subjectKey, attrs, false);
    expect(r.reason).toBe("ASSIGNMENT_MATCH");
  });

  it("accepts config with older format version", () => {
    const config: ConfigBlob = {
      ...makeConfig({ f: boolFlag({ assignments: [fixedAssignment("a1", "v1")] }) }),
      formatVersion: 0,
    };
    const r = evaluateFlag(config, "f", subjectKey, attrs, false);
    expect(r.reason).toBe("ASSIGNMENT_MATCH");
  });
});

// ===========================================================================
// Obfuscation edge cases
// ===========================================================================

describe("obfuscation", () => {
  it("compiles and evaluates IS_NULL condition", () => {
    const serverConfig = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "optional", operator: "IS_NULL", value: null }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });

    // Subject without the attribute → IS_NULL matches
    expect(evaluateFlag(serverConfig, "f", "u1", {}, false).value).toBe(true);
    // Subject with the attribute → IS_NULL does not match
    expect(evaluateFlag(serverConfig, "f", "u2", { optional: "present" }, false).reason).toBe("DEFAULT");

    // Same behavior in client format
    const clientConfig = compileClientConfig(serverConfig);
    expect(evaluateFlag(clientConfig, "f", "u1", {}, false).value).toBe(true);
    expect(evaluateFlag(clientConfig, "f", "u2", { optional: "present" }, false).reason).toBe("DEFAULT");
  });

  it("compiles and evaluates IS_NOT_NULL condition", () => {
    const serverConfig = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "optional", operator: "IS_NOT_NULL", value: null }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });

    expect(evaluateFlag(serverConfig, "f", "u1", { optional: "yes" }, false).value).toBe(true);
    expect(evaluateFlag(serverConfig, "f", "u2", {}, false).reason).toBe("DEFAULT");
  });

  it("unknown operator in condition → condition fails silently", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "x", operator: "FUTURE_OP", value: "y" }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", "u1", { x: "y" }, false).reason).toBe("DEFAULT");
  });

  it("list condition with non-array value → condition fails", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "x", operator: "ONE_OF", value: "not-an-array" }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", "u1", { x: "not-an-array" }, false).reason).toBe("DEFAULT");
  });

  it("audienceId takes priority over inline rules", () => {
    const config = makeConfig(
      {
        f: boolFlag({
          assignments: [
            {
              id: "a1",
              audienceId: "aud-1",
              rules: [{ conditions: [{ attribute: "x", operator: "ONE_OF", value: ["wrong"] }] }],
              variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
            },
          ],
        }),
      },
      { "aud-1": { rules: [{ conditions: [{ attribute: "x", operator: "ONE_OF", value: ["right"] }] }] } },
    );
    // Audience rules should be used, not inline rules
    expect(evaluateFlag(config, "f", "u1", { x: "right" }, false).value).toBe(true);
    expect(evaluateFlag(config, "f", "u2", { x: "wrong" }, false).reason).toBe("DEFAULT");
  });

  it("empty subjectKey hashes deterministically", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 5000 }] }],
          },
        ],
      }),
    });
    const r1 = evaluateFlag(config, "f", "", {}, false);
    const r2 = evaluateFlag(config, "f", "", {}, false);
    expect(r1.value).toBe(r2.value);
    expect(r1.reason).toBe(r2.reason);
  });

  it("string[] attribute works with ONE_OF", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "roles", operator: "ONE_OF", value: ["admin"] }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", "u1", { roles: ["admin", "user"] }, false).value).toBe(true);
    expect(evaluateFlag(config, "f", "u2", { roles: ["user"] }, false).reason).toBe("DEFAULT");
  });
});

// ===========================================================================
// Monotonic rollout expansion (critical invariant)
// ===========================================================================

describe("monotonic rollout expansion", () => {
  it("increasing traffic exposure keeps all existing users in", () => {
    // Users assigned at 10% must still be assigned at 50% and 100%
    const userIds = Array.from({ length: 200 }, (_, i) => `user-${i}`);

    function usersAssigned(trafficShards: number) {
      const config = makeConfig({
        f: boolFlag({
          assignments: [
            {
              id: "rollout",
              audienceId: undefined,
              rules: [],
              variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: trafficShards }] }],
            },
          ],
        }),
      });
      return new Set(userIds.filter((uid) => evaluateFlag(config, "f", uid, {}, false).reason === "ASSIGNMENT_MATCH"));
    }

    const at10pct = usersAssigned(1000);
    const at50pct = usersAssigned(5000);
    const at100pct = usersAssigned(10000);

    // Every user in the 10% set must also be in the 50% set
    for (const user of at10pct) {
      expect(at50pct.has(user)).toBe(true);
    }

    // Every user in the 50% set must also be in the 100% set
    for (const user of at50pct) {
      expect(at100pct.has(user)).toBe(true);
    }

    // 100% should include everyone
    expect(at100pct.size).toBe(userIds.length);
  });
});

// ===========================================================================
// Operator edge cases
// ===========================================================================

describe("operator edge cases", () => {
  it("non-numeric values with GT → no match (NaN)", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "x", operator: "GT", value: "10" }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", "u1", { x: "abc" }, false).reason).toBe("DEFAULT");
    expect(evaluateFlag(config, "f", "u2", { x: "20" }, false).value).toBe(true);
  });

  it("MATCHES with empty pattern matches everything", () => {
    const config = makeConfig({
      f: boolFlag({
        assignments: [
          {
            id: "a1",
            audienceId: undefined,
            rules: [{ conditions: [{ attribute: "x", operator: "MATCHES", value: "" }] }],
            variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 10000 }] }],
          },
        ],
      }),
    });
    expect(evaluateFlag(config, "f", "u1", { x: "anything" }, false).value).toBe(true);
  });
});

// ===========================================================================
// Edge cases: bucketing + compiler + obfuscation
// ===========================================================================

describe("bucketing edge cases", () => {
  it("totalShards = 0 → falls through to DEFAULT (no crash)", () => {
    const config: ConfigBlob = {
      ...makeConfig({
        f: boolFlag({
          assignments: [
            {
              id: "a1",
              audienceId: undefined,
              rules: [],
              variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 0 }] }],
            },
          ],
        }),
      }),
      totalShards: 0,
    };
    const r = evaluateFlag(config, "f", "user", {}, false);
    expect(r.reason).toBe("DEFAULT");
  });

  it("totalShards = 1 → bucket is always 0", () => {
    const config: ConfigBlob = {
      ...makeConfig({
        f: boolFlag({
          assignments: [
            {
              id: "a1",
              audienceId: undefined,
              rules: [],
              variations: [{ variationId: "v1", shardRanges: [{ start: 0, end: 1 }] }],
            },
          ],
        }),
      }),
      totalShards: 1,
    };
    // Every user should match the single shard
    for (let i = 0; i < 20; i++) {
      expect(evaluateFlag(config, "f", `user-${i}`, {}, false).value).toBe(true);
    }
  });
});

describe("compiler edge cases", () => {
  it("trafficExposure > totalShards → clamped", () => {
    const blob = compileConfigBlob({
      envId: "e1",
      flags: [{ id: "f1", key: "f", type: "boolean" }],
      variations: [
        { id: "v1", name: "T", value: true, position: 0, flagId: "f1" },
        { id: "v2", name: "F", value: false, position: 1, flagId: "f1" },
      ],
      flagConfigs: [
        { id: "fc1", enabled: true, offVariationId: "v2", defaultVariationId: "v2", flagId: "f1", envId: "e1" },
      ],
      assignments: [
        {
          id: "a1",
          name: "Over-exposed",
          position: 0,
          rules: [],
          trafficExposure: 20000, // > 10000 default totalShards
          variationSplits: [{ variationId: "v1", weight: 10000 }],
          flagConfigId: "fc1",
        },
      ],
      audiences: [],
    });
    // Should be clamped — shard range end should not exceed totalShards
    const range = blob.flags["f"]?.assignments.at(0)?.variations.at(0)?.shardRanges.at(0);
    expect(range?.end).toBeLessThanOrEqual(10000);
  });
});

describe("obfuscation edge cases", () => {
  it("compileClientConfig throws on already-client config", () => {
    const serverConfig = makeConfig({ f: boolFlag() });
    const clientConfig = compileClientConfig(serverConfig);
    expect(() => compileClientConfig(clientConfig)).toThrow("already in client format");
  });
});
