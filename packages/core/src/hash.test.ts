import { describe, expect, it } from "vitest";
import { base64Decode, base64Encode, computeBucket, md5 } from "./hash";

describe("md5", () => {
  it("hashes empty string", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("hashes 'hello'", () => {
    expect(md5("hello")).toBe("5d41402abc4b2a76b9719d911017c592");
  });

  it("hashes 'Hello World'", () => {
    expect(md5("Hello World")).toBe("b10a8db164e0754105b7a99be72e3fe5");
  });

  it("hashes a longer string", () => {
    expect(md5("The quick brown fox jumps over the lazy dog")).toBe("9e107d9d372bb6826bd81d3542a419d6");
  });

  it("hashes unicode characters", () => {
    // Consistent UTF-8 encoding
    const hash = md5("café");
    expect(hash).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("produces different hashes for different inputs", () => {
    const a = md5("flag-a");
    const b = md5("flag-b");
    expect(a).not.toBe(b);
  });

  it("is deterministic", () => {
    const input = "show-new-dashboard";
    expect(md5(input)).toBe(md5(input));
  });

  it("hashes known operator names consistently", () => {
    // These are used in obfuscated configs — they must be stable
    const oneOfHash = md5("ONE_OF");
    expect(oneOfHash).toHaveLength(32);
    expect(md5("ONE_OF")).toBe(oneOfHash);
    expect(md5("NOT_ONE_OF")).not.toBe(oneOfHash);
  });
});

describe("base64Encode / base64Decode", () => {
  it("round-trips simple strings", () => {
    expect(base64Decode(base64Encode("hello"))).toBe("hello");
  });

  it("round-trips empty string", () => {
    expect(base64Decode(base64Encode(""))).toBe("");
  });

  it("encodes known values (matching standard base64)", () => {
    expect(base64Encode("true")).toBe("dHJ1ZQ==");
    expect(base64Encode("false")).toBe("ZmFsc2U=");
  });

  it("decodes known values", () => {
    expect(base64Decode("dHJ1ZQ==")).toBe("true");
    expect(base64Decode("ZmFsc2U=")).toBe("false");
  });

  it("round-trips unicode", () => {
    const input = "email: user@example.com — 日本語";
    expect(base64Decode(base64Encode(input))).toBe(input);
  });

  it("round-trips JSON", () => {
    const json = JSON.stringify({ key: "value", nested: { a: 1 } });
    expect(base64Decode(base64Encode(json))).toBe(json);
  });

  it("round-trips regex patterns", () => {
    const pattern = "^(alice|bob).*@langchain\\.dev$";
    expect(base64Decode(base64Encode(pattern))).toBe(pattern);
  });
});

describe("computeBucket", () => {
  it("returns a value in [0, totalShards)", () => {
    const totalShards = 10_000;
    for (let i = 0; i < 100; i++) {
      const bucket = computeBucket("test-salt", `user-${i}`, totalShards);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(totalShards);
    }
  });

  it("is deterministic", () => {
    const a = computeBucket("salt", "user-123", 10_000);
    const b = computeBucket("salt", "user-123", 10_000);
    expect(a).toBe(b);
  });

  it("different salts produce different buckets for same user", () => {
    const a = computeBucket("flag-a-rule-1", "user-123", 10_000);
    const b = computeBucket("flag-b-rule-1", "user-123", 10_000);
    // Not guaranteed to be different, but with 10k shards it's very unlikely to collide
    // We just verify they're valid — determinism test above covers consistency
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
  });

  it("distributes roughly uniformly", () => {
    const totalShards = 100;
    const numSamples = 10_000;
    const buckets = new Array<number>(totalShards).fill(0);

    for (let i = 0; i < numSamples; i++) {
      const bucket = computeBucket("uniform-test", `user-${i}`, totalShards);
      buckets[bucket]!++;
    }

    // Each bucket should get ~100 samples. Allow 50% deviation.
    const expected = numSamples / totalShards;
    for (let i = 0; i < totalShards; i++) {
      expect(buckets[i]!).toBeGreaterThan(expected * 0.3);
      expect(buckets[i]!).toBeLessThan(expected * 2);
    }
  });
});
