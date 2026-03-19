import { describe, expect, it } from "vitest";
import { base64Decode, base64Encode, computeBucket, md5 } from "./hash";

// ===========================================================================
// MD5 — RFC 1321 test vectors (authoritative reference)
// ===========================================================================

describe("md5 — RFC 1321 test vectors", () => {
  const vectors: [string, string][] = [
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    ["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", "d174ab98d277d9f5a5611c2c9f419d9f"],
    [
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      "57edf4a22be3c955ac49da2e2107b67a",
    ],
  ];

  for (const [input, expected] of vectors) {
    it(`md5(${JSON.stringify(input).slice(0, 40)}) = ${expected}`, () => {
      expect(md5(input)).toBe(expected);
    });
  }
});

// ===========================================================================
// MD5 — Padding boundary edge cases
//
// MD5 pads to 56 mod 64 bytes. Inputs near this boundary exercise different
// padding paths. Values verified against Node.js crypto.createHash('md5').
// ===========================================================================

describe("md5 — padding boundaries", () => {
  it("55 bytes (fills block exactly before length field)", () => {
    expect(md5("a".repeat(55))).toBe("ef1772b6dff9a122358552954ad0df65");
  });

  it("56 bytes (triggers extra padding block)", () => {
    expect(md5("a".repeat(56))).toBe("3b0c8ac703f828b04c6c197006d17218");
  });

  it("64 bytes (exact single block)", () => {
    expect(md5("a".repeat(64))).toBe("014842d480b571495a4a0363793f7367");
  });

  it("128 bytes (exact two blocks)", () => {
    expect(md5("a".repeat(128))).toBe("e510683b3f5ffe4093d021808bc6ff70");
  });
});

// ===========================================================================
// MD5 — UTF-8 encoding (cross-language compatibility)
//
// These values are verified against Node.js crypto.createHash('md5').
// Any SDK in another language must produce identical results for these inputs.
// ===========================================================================

describe("md5 — UTF-8 multi-byte", () => {
  it("2-byte UTF-8 (Latin extended)", () => {
    expect(md5("café")).toBe("07117fe4a1ebd544965dc19573183da2");
  });

  it("2-byte UTF-8 (diacritics)", () => {
    expect(md5("naïve")).toBe("63899c6b555841978b89319d701f9b5a");
  });

  it("3-byte UTF-8 (CJK)", () => {
    expect(md5("日本語")).toBe("00110af8b4393ef3f72c50be5b332bec");
  });

  it("4-byte UTF-8 (single emoji — surrogate pair)", () => {
    expect(md5("🎉")).toBe("5b4042e548183ef230051ab6861fb02e");
  });

  it("4-byte UTF-8 (multiple emoji)", () => {
    expect(md5("🎉🚀💡")).toBe("e024fc1063127608dce11a707eab74ef");
  });

  it("mixed ASCII + multi-byte + emoji", () => {
    expect(md5("hello 世界 🌍")).toBe("8a2e4584aa9c8168cb34fe90bf4ab6fb");
  });
});

// ===========================================================================
// MD5 — Properties
// ===========================================================================

describe("md5 — properties", () => {
  it("is deterministic", () => {
    expect(md5("show-new-dashboard")).toBe(md5("show-new-dashboard"));
  });

  it("produces different hashes for different inputs", () => {
    expect(md5("flag-a")).not.toBe(md5("flag-b"));
  });

  it("all operator names hash to unique 32-char hex", () => {
    const operators = ["ONE_OF", "NOT_ONE_OF", "GT", "GTE", "LT", "LTE", "MATCHES", "IS_NULL", "IS_NOT_NULL"];
    const hashes = new Set(operators.map(md5));
    expect(hashes.size).toBe(operators.length);
    for (const hash of hashes) {
      expect(hash).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});

// ===========================================================================
// Base64
// ===========================================================================

describe("base64Encode / base64Decode", () => {
  it("round-trips empty string", () => {
    expect(base64Decode(base64Encode(""))).toBe("");
  });

  it("encodes known values (matching standard base64)", () => {
    expect(base64Encode("true")).toBe("dHJ1ZQ==");
    expect(base64Encode("false")).toBe("ZmFsc2U=");
    expect(base64Encode("hello")).toBe("aGVsbG8=");
  });

  it("decodes known values", () => {
    expect(base64Decode("dHJ1ZQ==")).toBe("true");
    expect(base64Decode("ZmFsc2U=")).toBe("false");
    expect(base64Decode("aGVsbG8=")).toBe("hello");
  });

  it("round-trips unicode", () => {
    expect(base64Decode(base64Encode("café"))).toBe("café");
    expect(base64Decode(base64Encode("日本語"))).toBe("日本語");
  });

  it("round-trips emoji (4-byte UTF-8)", () => {
    expect(base64Decode(base64Encode("🎉"))).toBe("🎉");
    expect(base64Decode(base64Encode("🎉🚀💡"))).toBe("🎉🚀💡");
    expect(base64Decode(base64Encode("hello 🌍"))).toBe("hello 🌍");
  });

  it("round-trips JSON", () => {
    const json = JSON.stringify({ key: "value", nested: { a: 1 } });
    expect(base64Decode(base64Encode(json))).toBe(json);
  });

  it("round-trips regex patterns", () => {
    const pattern = "^(alice|bob).*@langchain\\.dev$";
    expect(base64Decode(base64Encode(pattern))).toBe(pattern);
  });

  it("handles padding correctly (1, 2, 3 byte inputs)", () => {
    expect(base64Decode(base64Encode("a"))).toBe("a");
    expect(base64Decode(base64Encode("ab"))).toBe("ab");
    expect(base64Decode(base64Encode("abc"))).toBe("abc");
  });
});

// ===========================================================================
// MurmurHash3 — Pinned reference values
//
// These values are verified against murmurhash3js (npm) which implements
// the canonical Austin Appleby MurmurHash3_x86_32 algorithm.
// computeBucket(salt, value, totalShards) = murmur3("salt.value", seed=0) >>> 0 % totalShards
// ===========================================================================

describe("computeBucket — pinned reference values (murmurhash3js)", () => {
  const vectors: [string, string, number, number][] = [
    // [salt, value, totalShards, expectedBucket]
    ["salt", "value", 10_000, 5241],
    ["flag-123", "user-456", 10_000, 1538],
    ["rollout-abc", "org-xyz", 10_000, 9301],
    ["", "", 10_000, 3443],
    ["a", "b", 10_000, 422],
  ];

  for (const [salt, value, shards, expected] of vectors) {
    it(`computeBucket("${salt}", "${value}", ${shards}) = ${expected}`, () => {
      expect(computeBucket(salt, value, shards)).toBe(expected);
    });
  }
});

// ===========================================================================
// MurmurHash3 — Properties
// ===========================================================================

describe("computeBucket — properties", () => {
  it("is deterministic", () => {
    expect(computeBucket("salt", "user-123", 10_000)).toBe(computeBucket("salt", "user-123", 10_000));
  });

  it("returns value in [0, totalShards) for various shard counts", () => {
    for (const shards of [1, 2, 10, 100, 10_000]) {
      for (let i = 0; i < 200; i++) {
        const bucket = computeBucket("test", `user-${i}`, shards);
        expect(bucket).toBeGreaterThanOrEqual(0);
        expect(bucket).toBeLessThan(shards);
      }
    }
  });

  it("totalShards=1 always returns 0", () => {
    for (let i = 0; i < 100; i++) {
      expect(computeBucket("salt", `user-${i}`, 1)).toBe(0);
    }
  });

  it("distributes roughly uniformly", () => {
    const totalShards = 100;
    const numSamples = 10_000;
    const buckets = new Array<number>(totalShards).fill(0);

    for (let i = 0; i < numSamples; i++) {
      const bucket = computeBucket("uniform-test", `user-${i}`, totalShards);
      buckets[bucket]!++;
    }

    const expected = numSamples / totalShards;
    for (let i = 0; i < totalShards; i++) {
      expect(buckets[i]!).toBeGreaterThan(expected * 0.3);
      expect(buckets[i]!).toBeLessThan(expected * 2);
    }
  });

  it("different salts produce different distributions", () => {
    const bucketsA = new Map<number, number>();
    const bucketsB = new Map<number, number>();
    for (let i = 0; i < 100; i++) {
      const a = computeBucket("flag-a", `user-${i}`, 10_000);
      const b = computeBucket("flag-b", `user-${i}`, 10_000);
      bucketsA.set(a, (bucketsA.get(a) ?? 0) + 1);
      bucketsB.set(b, (bucketsB.get(b) ?? 0) + 1);
    }
    // Distributions should differ (not identical mappings)
    let sameCount = 0;
    for (let i = 0; i < 100; i++) {
      if (computeBucket("flag-a", `user-${i}`, 10_000) === computeBucket("flag-b", `user-${i}`, 10_000)) {
        sameCount++;
      }
    }
    // With 10k shards, collision rate should be ~1%. Allow up to 10%.
    expect(sameCount).toBeLessThan(10);
  });

  it("handles empty salt and value", () => {
    const bucket = computeBucket("", "", 10_000);
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(10_000);
    // Deterministic
    expect(computeBucket("", "", 10_000)).toBe(bucket);
  });
});
