import { describe, expect, it } from "vitest";
import { evaluateAllFlags, evaluateFlag } from "./evaluate";
import { compileClientConfig } from "./obfuscate";
import type { ConfigBlob, EvaluationContext, Flag, Segment } from "./types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeServerConfig(flags: Record<string, Flag>, segments?: Record<string, Segment>): ConfigBlob {
  return {
    formatVersion: 1,
    format: "server",
    environment: "production",
    version: 1,
    generatedAt: Date.now(),
    totalShards: 10_000,
    segments: segments ?? {},
    flags,
  };
}

const defaultContext: EvaluationContext = {
  key: "user-123",
  email: "alice@langchain.dev",
  plan: "enterprise",
  country: "US",
};

// ---------------------------------------------------------------------------
// Flag not found
// ---------------------------------------------------------------------------

describe("evaluateFlag — flag not found", () => {
  it("returns default value with DEFAULT reason", () => {
    const config = makeServerConfig({});
    const result = evaluateFlag(config, "nonexistent", defaultContext, false);

    expect(result.value).toBe(false);
    expect(result.reason).toBe("DEFAULT");
    expect(result.variationKey).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Flag disabled
// ---------------------------------------------------------------------------

describe("evaluateFlag — flag disabled", () => {
  it("returns offVariation with OFF reason", () => {
    const config = makeServerConfig({
      "my-flag": {
        type: "boolean",
        enabled: false,
        variations: {
          on: { value: true },
          off: { value: false },
        },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [],
        rules: [],
        fallthrough: { type: "fixed", variationKey: "on" },
      },
    });

    const result = evaluateFlag(config, "my-flag", defaultContext, true);

    expect(result.value).toBe(false);
    expect(result.variationKey).toBe("off");
    expect(result.reason).toBe("OFF");
  });
});

// ---------------------------------------------------------------------------
// Individual targets
// ---------------------------------------------------------------------------

describe("evaluateFlag — individual targets", () => {
  it("matches a targeted context key", () => {
    const config = makeServerConfig({
      "my-flag": {
        type: "boolean",
        enabled: true,
        variations: {
          on: { value: true },
          off: { value: false },
        },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [{ variationKey: "on", contextKeys: ["user-123", "user-456"] }],
        rules: [],
        fallthrough: { type: "fixed", variationKey: "off" },
      },
    });

    const result = evaluateFlag(config, "my-flag", defaultContext, false);
    expect(result.value).toBe(true);
    expect(result.reason).toBe("INDIVIDUAL_TARGET");
  });

  it("does not match non-targeted context key", () => {
    const config = makeServerConfig({
      "my-flag": {
        type: "boolean",
        enabled: true,
        variations: {
          on: { value: true },
          off: { value: false },
        },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [{ variationKey: "on", contextKeys: ["user-999"] }],
        rules: [],
        fallthrough: { type: "fixed", variationKey: "off" },
      },
    });

    const result = evaluateFlag(config, "my-flag", defaultContext, false);
    expect(result.value).toBe(false);
    expect(result.reason).toBe("FALLTHROUGH");
  });
});

// ---------------------------------------------------------------------------
// Targeting rules — attribute conditions
// ---------------------------------------------------------------------------

describe("evaluateFlag — attribute targeting rules", () => {
  it("matches IS operator", () => {
    const config = makeServerConfig({
      "my-flag": {
        type: "string",
        enabled: true,
        variations: {
          enterprise: { value: "enterprise-features" },
          standard: { value: "standard-features" },
        },
        offVariation: "standard",
        prerequisites: [],
        individualTargets: [],
        rules: [
          {
            id: "rule-1",
            conditions: [
              {
                type: "attribute",
                condition: { attribute: "plan", operator: "IS", value: "enterprise" },
              },
            ],
            serve: { type: "fixed", variationKey: "enterprise" },
          },
        ],
        fallthrough: { type: "fixed", variationKey: "standard" },
      },
    });

    const result = evaluateFlag(config, "my-flag", defaultContext, "standard-features");
    expect(result.value).toBe("enterprise-features");
    expect(result.reason).toBe("RULE_MATCH");
    expect(result.ruleId).toBe("rule-1");
  });

  it("matches ONE_OF operator", () => {
    const config = makeServerConfig({
      "my-flag": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [],
        rules: [
          {
            id: "rule-1",
            conditions: [
              {
                type: "attribute",
                condition: {
                  attribute: "country",
                  operator: "ONE_OF",
                  value: ["US", "CA", "GB"],
                },
              },
            ],
            serve: { type: "fixed", variationKey: "on" },
          },
        ],
        fallthrough: { type: "fixed", variationKey: "off" },
      },
    });

    const result = evaluateFlag(config, "my-flag", defaultContext, false);
    expect(result.value).toBe(true);
    expect(result.reason).toBe("RULE_MATCH");
  });

  it("matches ENDS_WITH operator (email domain targeting)", () => {
    const config = makeServerConfig({
      "my-flag": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [],
        rules: [
          {
            id: "beta-rule",
            conditions: [
              {
                type: "attribute",
                condition: {
                  attribute: "email",
                  operator: "ENDS_WITH",
                  value: "@langchain.dev",
                },
              },
            ],
            serve: { type: "fixed", variationKey: "on" },
          },
        ],
        fallthrough: { type: "fixed", variationKey: "off" },
      },
    });

    const result = evaluateFlag(config, "my-flag", defaultContext, false);
    expect(result.value).toBe(true);

    const otherUser: EvaluationContext = { key: "user-789", email: "bob@gmail.com" };
    const otherResult = evaluateFlag(config, "my-flag", otherUser, false);
    expect(otherResult.value).toBe(false);
    expect(otherResult.reason).toBe("FALLTHROUGH");
  });

  it("matches MATCHES operator (regex)", () => {
    const config = makeServerConfig({
      "my-flag": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [],
        rules: [
          {
            id: "regex-rule",
            conditions: [
              {
                type: "attribute",
                condition: {
                  attribute: "email",
                  operator: "MATCHES",
                  value: "^(alice|bob).*@langchain\\.dev$",
                },
              },
            ],
            serve: { type: "fixed", variationKey: "on" },
          },
        ],
        fallthrough: { type: "fixed", variationKey: "off" },
      },
    });

    const result = evaluateFlag(config, "my-flag", defaultContext, false);
    expect(result.value).toBe(true);
  });

  it("first matching rule wins", () => {
    const config = makeServerConfig({
      "my-flag": {
        type: "string",
        enabled: true,
        variations: {
          vip: { value: "vip" },
          beta: { value: "beta" },
          standard: { value: "standard" },
        },
        offVariation: "standard",
        prerequisites: [],
        individualTargets: [],
        rules: [
          {
            id: "rule-vip",
            conditions: [
              {
                type: "attribute",
                condition: { attribute: "plan", operator: "IS", value: "enterprise" },
              },
            ],
            serve: { type: "fixed", variationKey: "vip" },
          },
          {
            id: "rule-beta",
            conditions: [
              {
                type: "attribute",
                condition: {
                  attribute: "email",
                  operator: "ENDS_WITH",
                  value: "@langchain.dev",
                },
              },
            ],
            serve: { type: "fixed", variationKey: "beta" },
          },
        ],
        fallthrough: { type: "fixed", variationKey: "standard" },
      },
    });

    // Matches both rules, but first one wins
    const result = evaluateFlag(config, "my-flag", defaultContext, "standard");
    expect(result.value).toBe("vip");
    expect(result.ruleId).toBe("rule-vip");
  });

  it("AND logic within a rule (all conditions must match)", () => {
    const config = makeServerConfig({
      "my-flag": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [],
        rules: [
          {
            id: "rule-1",
            conditions: [
              {
                type: "attribute",
                condition: { attribute: "plan", operator: "IS", value: "enterprise" },
              },
              {
                type: "attribute",
                condition: { attribute: "country", operator: "IS", value: "US" },
              },
            ],
            serve: { type: "fixed", variationKey: "on" },
          },
        ],
        fallthrough: { type: "fixed", variationKey: "off" },
      },
    });

    // Matches both conditions
    const result = evaluateFlag(config, "my-flag", defaultContext, false);
    expect(result.value).toBe(true);

    // Only matches one condition
    const ukUser: EvaluationContext = { key: "uk-user", plan: "enterprise", country: "GB" };
    const ukResult = evaluateFlag(config, "my-flag", ukUser, false);
    expect(ukResult.value).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Segment targeting
// ---------------------------------------------------------------------------

describe("evaluateFlag — segment targeting", () => {
  it("matches a segment condition", () => {
    const config = makeServerConfig(
      {
        "my-flag": {
          type: "boolean",
          enabled: true,
          variations: { on: { value: true }, off: { value: false } },
          offVariation: "off",
          prerequisites: [],
          individualTargets: [],
          rules: [
            {
              id: "segment-rule",
              conditions: [{ type: "segment", segmentKey: "beta-users" }],
              serve: { type: "fixed", variationKey: "on" },
            },
          ],
          fallthrough: { type: "fixed", variationKey: "off" },
        },
      },
      {
        "beta-users": {
          rules: [
            {
              conditions: [{ attribute: "email", operator: "ENDS_WITH", value: "@langchain.dev" }],
            },
          ],
        },
      },
    );

    const result = evaluateFlag(config, "my-flag", defaultContext, false);
    expect(result.value).toBe(true);
    expect(result.reason).toBe("RULE_MATCH");
  });

  it("segment rules are OR'd (any rule match = segment match)", () => {
    const config = makeServerConfig(
      {
        "my-flag": {
          type: "boolean",
          enabled: true,
          variations: { on: { value: true }, off: { value: false } },
          offVariation: "off",
          prerequisites: [],
          individualTargets: [],
          rules: [
            {
              id: "rule-1",
              conditions: [{ type: "segment", segmentKey: "early-access" }],
              serve: { type: "fixed", variationKey: "on" },
            },
          ],
          fallthrough: { type: "fixed", variationKey: "off" },
        },
      },
      {
        "early-access": {
          rules: [
            // Rule 1: enterprise plan
            { conditions: [{ attribute: "plan", operator: "IS", value: "enterprise" }] },
            // Rule 2: langchain email
            {
              conditions: [{ attribute: "email", operator: "ENDS_WITH", value: "@langchain.dev" }],
            },
          ],
        },
      },
    );

    // Matches via plan rule
    const enterpriseUser: EvaluationContext = {
      key: "user-1",
      plan: "enterprise",
      email: "bob@other.com",
    };
    expect(evaluateFlag(config, "my-flag", enterpriseUser, false).value).toBe(true);

    // Matches via email rule
    const langchainUser: EvaluationContext = {
      key: "user-2",
      plan: "free",
      email: "alice@langchain.dev",
    };
    expect(evaluateFlag(config, "my-flag", langchainUser, false).value).toBe(true);

    // Matches neither
    const freeUser: EvaluationContext = {
      key: "user-3",
      plan: "free",
      email: "charlie@gmail.com",
    };
    expect(evaluateFlag(config, "my-flag", freeUser, false).value).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Percentage rollouts
// ---------------------------------------------------------------------------

describe("evaluateFlag — percentage rollouts", () => {
  it("assigns variation based on deterministic bucketing", () => {
    const config = makeServerConfig({
      "my-flag": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [],
        rules: [],
        fallthrough: {
          type: "rollout",
          bucketBy: "key",
          salt: "my-flag-fallthrough",
          variations: [
            { variationKey: "on", shardRanges: [{ start: 0, end: 5000 }] },
            { variationKey: "off", shardRanges: [{ start: 5000, end: 10000 }] },
          ],
        },
      },
    });

    // Verify determinism: same user always gets same result
    const result1 = evaluateFlag(config, "my-flag", defaultContext, false);
    const result2 = evaluateFlag(config, "my-flag", defaultContext, false);
    expect(result1.value).toBe(result2.value);
    expect(result1.reason).toBe("FALLTHROUGH");
  });

  it("distributes roughly according to weights", () => {
    const config = makeServerConfig({
      "my-flag": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [],
        rules: [],
        fallthrough: {
          type: "rollout",
          bucketBy: "key",
          salt: "distribution-test",
          variations: [
            { variationKey: "on", shardRanges: [{ start: 0, end: 5000 }] },
            { variationKey: "off", shardRanges: [{ start: 5000, end: 10000 }] },
          ],
        },
      },
    });

    let onCount = 0;
    const total = 1000;
    for (let i = 0; i < total; i++) {
      const ctx: EvaluationContext = { key: `user-${i}` };
      const result = evaluateFlag(config, "my-flag", ctx, false);
      if (result.value === true) onCount++;
    }

    // 50% rollout should give roughly 50% on. Allow wide margin for small sample.
    expect(onCount).toBeGreaterThan(total * 0.35);
    expect(onCount).toBeLessThan(total * 0.65);
  });
});

// ---------------------------------------------------------------------------
// Prerequisites
// ---------------------------------------------------------------------------

describe("evaluateFlag — prerequisites", () => {
  it("serves offVariation when prerequisite fails", () => {
    const config = makeServerConfig({
      "platform-v2": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [],
        rules: [],
        fallthrough: { type: "fixed", variationKey: "off" }, // v2 is off for everyone
      },
      "new-dashboard": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [{ flagKey: "platform-v2", variationKey: "on" }],
        individualTargets: [],
        rules: [],
        fallthrough: { type: "fixed", variationKey: "on" },
      },
    });

    // platform-v2 resolves to "off", so prerequisite fails
    const result = evaluateFlag(config, "new-dashboard", defaultContext, false);
    expect(result.value).toBe(false);
    expect(result.reason).toBe("PREREQUISITE_FAILED");
  });

  it("evaluates normally when prerequisite passes", () => {
    const config = makeServerConfig({
      "platform-v2": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [],
        rules: [],
        fallthrough: { type: "fixed", variationKey: "on" }, // v2 is on for everyone
      },
      "new-dashboard": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [{ flagKey: "platform-v2", variationKey: "on" }],
        individualTargets: [],
        rules: [],
        fallthrough: { type: "fixed", variationKey: "on" },
      },
    });

    const result = evaluateFlag(config, "new-dashboard", defaultContext, false);
    expect(result.value).toBe(true);
    expect(result.reason).toBe("FALLTHROUGH");
  });
});

// ---------------------------------------------------------------------------
// Multivariate flags (string, number, JSON)
// ---------------------------------------------------------------------------

describe("evaluateFlag — multivariate flags", () => {
  it("evaluates string flags", () => {
    const config = makeServerConfig({
      "checkout-flow": {
        type: "string",
        enabled: true,
        variations: {
          control: { value: "one-page" },
          treatment: { value: "multi-step" },
        },
        offVariation: "control",
        prerequisites: [],
        individualTargets: [],
        rules: [],
        fallthrough: { type: "fixed", variationKey: "treatment" },
      },
    });

    const result = evaluateFlag(config, "checkout-flow", defaultContext, "one-page");
    expect(result.value).toBe("multi-step");
  });

  it("evaluates number flags", () => {
    const config = makeServerConfig({
      "rate-limit": {
        type: "number",
        enabled: true,
        variations: {
          low: { value: 100 },
          medium: { value: 500 },
          high: { value: 2000 },
        },
        offVariation: "low",
        prerequisites: [],
        individualTargets: [],
        rules: [
          {
            id: "enterprise-rule",
            conditions: [
              {
                type: "attribute",
                condition: { attribute: "plan", operator: "IS", value: "enterprise" },
              },
            ],
            serve: { type: "fixed", variationKey: "high" },
          },
        ],
        fallthrough: { type: "fixed", variationKey: "medium" },
      },
    });

    const result = evaluateFlag(config, "rate-limit", defaultContext, 100);
    expect(result.value).toBe(2000);
  });

  it("evaluates JSON flags", () => {
    const config = makeServerConfig({
      "ui-config": {
        type: "json",
        enabled: true,
        variations: {
          default: { value: { theme: "light", sidebar: true } },
          compact: { value: { theme: "dark", sidebar: false } },
        },
        offVariation: "default",
        prerequisites: [],
        individualTargets: [],
        rules: [],
        fallthrough: { type: "fixed", variationKey: "compact" },
      },
    });

    const result = evaluateFlag(config, "ui-config", defaultContext, { theme: "light" });
    expect(result.value).toEqual({ theme: "dark", sidebar: false });
  });
});

// ---------------------------------------------------------------------------
// evaluateAllFlags
// ---------------------------------------------------------------------------

describe("evaluateAllFlags", () => {
  it("evaluates all flags in the config", () => {
    const config = makeServerConfig({
      "flag-a": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [],
        rules: [],
        fallthrough: { type: "fixed", variationKey: "on" },
      },
      "flag-b": {
        type: "string",
        enabled: false,
        variations: { v1: { value: "old" }, v2: { value: "new" } },
        offVariation: "v1",
        prerequisites: [],
        individualTargets: [],
        rules: [],
        fallthrough: { type: "fixed", variationKey: "v2" },
      },
    });

    const results = evaluateAllFlags(config, defaultContext);
    expect(results.get("flag-a")).toBe(true);
    expect(results.get("flag-b")).toBe("old"); // disabled → offVariation
  });
});

// ---------------------------------------------------------------------------
// Client format (obfuscated) evaluation
// ---------------------------------------------------------------------------

describe("evaluateFlag — client format", () => {
  const serverConfig = makeServerConfig(
    {
      "show-new-dashboard": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [{ variationKey: "on", contextKeys: ["user-ceo"] }],
        rules: [
          {
            id: "beta-rule",
            conditions: [{ type: "segment", segmentKey: "beta-users" }],
            serve: { type: "fixed", variationKey: "on" },
          },
          {
            id: "rollout-rule",
            conditions: [
              {
                type: "attribute",
                condition: {
                  attribute: "country",
                  operator: "ONE_OF",
                  value: ["US", "CA"],
                },
              },
            ],
            serve: {
              type: "rollout",
              bucketBy: "key",
              salt: "show-new-dashboard-rollout",
              variations: [
                { variationKey: "on", shardRanges: [{ start: 0, end: 3000 }] },
                { variationKey: "off", shardRanges: [{ start: 3000, end: 10000 }] },
              ],
            },
          },
        ],
        fallthrough: { type: "fixed", variationKey: "off" },
      },
    },
    {
      "beta-users": {
        rules: [
          {
            conditions: [{ attribute: "email", operator: "ENDS_WITH", value: "@langchain.dev" }],
          },
        ],
      },
    },
  );

  const clientConfig = compileClientConfig(serverConfig);

  it("compiles to client format", () => {
    expect(clientConfig.format).toBe("client");
    expect(Object.keys(clientConfig.flags)).toHaveLength(1);
    // Flag key should be MD5 hashed
    const flagKeys = Object.keys(clientConfig.flags);
    expect(flagKeys[0]).toMatch(/^[0-9a-f]{32}$/);
  });

  it("evaluates correctly in client format — individual target", () => {
    const ceoContext: EvaluationContext = { key: "user-ceo", email: "ceo@company.com" };
    const result = evaluateFlag(clientConfig, "show-new-dashboard", ceoContext, false);
    expect(result.value).toBe(true);
    expect(result.reason).toBe("INDIVIDUAL_TARGET");
  });

  it("evaluates correctly in client format — segment match", () => {
    const result = evaluateFlag(clientConfig, "show-new-dashboard", defaultContext, false);
    expect(result.value).toBe(true);
    expect(result.reason).toBe("RULE_MATCH");
  });

  it("evaluates correctly in client format — ONE_OF with rollout", () => {
    const usUser: EvaluationContext = { key: "user-555", country: "US", email: "x@gmail.com" };
    const result = evaluateFlag(clientConfig, "show-new-dashboard", usUser, false);
    // Should get a result (either on or off) via rollout
    expect(result.reason).toBe("RULE_MATCH");
    expect(typeof result.value).toBe("boolean");
  });

  it("evaluates correctly in client format — fallthrough", () => {
    const jpUser: EvaluationContext = { key: "user-jp", country: "JP", email: "taro@japan.com" };
    const result = evaluateFlag(clientConfig, "show-new-dashboard", jpUser, false);
    expect(result.value).toBe(false);
    expect(result.reason).toBe("FALLTHROUGH");
  });

  it("server and client format produce same results", () => {
    const contexts: EvaluationContext[] = [
      { key: "user-ceo", email: "ceo@company.com" },
      { key: "user-123", email: "alice@langchain.dev", country: "US" },
      { key: "user-jp", country: "JP", email: "taro@japan.com" },
      { key: "user-free", plan: "free", country: "US", email: "free@gmail.com" },
    ];

    for (const ctx of contexts) {
      const serverResult = evaluateFlag(serverConfig, "show-new-dashboard", ctx, false);
      const clientResult = evaluateFlag(clientConfig, "show-new-dashboard", ctx, false);

      expect(clientResult.value).toBe(serverResult.value);
      expect(clientResult.reason).toBe(serverResult.reason);
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("evaluateFlag — edge cases", () => {
  it("handles missing attribute gracefully (condition does not match)", () => {
    const config = makeServerConfig({
      "my-flag": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [],
        rules: [
          {
            id: "rule-1",
            conditions: [
              {
                type: "attribute",
                condition: {
                  attribute: "nonexistent-attribute",
                  operator: "IS",
                  value: "something",
                },
              },
            ],
            serve: { type: "fixed", variationKey: "on" },
          },
        ],
        fallthrough: { type: "fixed", variationKey: "off" },
      },
    });

    const result = evaluateFlag(config, "my-flag", defaultContext, false);
    expect(result.value).toBe(false);
    expect(result.reason).toBe("FALLTHROUGH");
  });

  it("handles empty rules array", () => {
    const config = makeServerConfig({
      "my-flag": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [],
        rules: [],
        fallthrough: { type: "fixed", variationKey: "on" },
      },
    });

    const result = evaluateFlag(config, "my-flag", defaultContext, false);
    expect(result.value).toBe(true);
    expect(result.reason).toBe("FALLTHROUGH");
  });

  it("handles NOT_ONE_OF operator", () => {
    const config = makeServerConfig({
      "my-flag": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [],
        rules: [
          {
            id: "rule-1",
            conditions: [
              {
                type: "attribute",
                condition: {
                  attribute: "country",
                  operator: "NOT_ONE_OF",
                  value: ["CN", "RU"],
                },
              },
            ],
            serve: { type: "fixed", variationKey: "on" },
          },
        ],
        fallthrough: { type: "fixed", variationKey: "off" },
      },
    });

    // US is NOT in [CN, RU], so rule matches
    const result = evaluateFlag(config, "my-flag", defaultContext, false);
    expect(result.value).toBe(true);
  });

  it("handles numeric comparison operators", () => {
    const config = makeServerConfig({
      "my-flag": {
        type: "boolean",
        enabled: true,
        variations: { on: { value: true }, off: { value: false } },
        offVariation: "off",
        prerequisites: [],
        individualTargets: [],
        rules: [
          {
            id: "rule-1",
            conditions: [
              {
                type: "attribute",
                condition: { attribute: "age", operator: "GTE", value: "18" },
              },
            ],
            serve: { type: "fixed", variationKey: "on" },
          },
        ],
        fallthrough: { type: "fixed", variationKey: "off" },
      },
    });

    const adultUser: EvaluationContext = { key: "user-1", age: 25 };
    expect(evaluateFlag(config, "my-flag", adultUser, false).value).toBe(true);

    const minorUser: EvaluationContext = { key: "user-2", age: 16 };
    expect(evaluateFlag(config, "my-flag", minorUser, false).value).toBe(false);
  });
});
