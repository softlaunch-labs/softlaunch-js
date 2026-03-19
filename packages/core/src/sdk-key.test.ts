import { describe, expect, it } from "vitest";
import { deserializeSdkKey, serializeSdkKey } from "./sdk-key";

describe("serializeSdkKey", () => {
  it("serializes a client key", () => {
    const key = serializeSdkKey({ type: "client", keyId: "k1", envId: "e1", orgId: "o1" });
    expect(key).toMatch(/^slc_/);
  });

  it("serializes a server key", () => {
    const key = serializeSdkKey({ type: "server", keyId: "k1", envId: "e1", orgId: "o1" });
    expect(key).toMatch(/^sls_/);
  });

  it("round-trips with deserialize", () => {
    const input = { type: "client" as const, keyId: "key-abc", envId: "env-123", orgId: "org-456" };
    const serialized = serializeSdkKey(input);
    const deserialized = deserializeSdkKey(serialized);
    expect(deserialized).toEqual(input);
  });

  it("different keys produce different serializations", () => {
    const a = serializeSdkKey({ type: "client", keyId: "k1", envId: "e1", orgId: "o1" });
    const b = serializeSdkKey({ type: "client", keyId: "k2", envId: "e1", orgId: "o1" });
    expect(a).not.toBe(b);
  });

  it("client and server keys for same IDs differ", () => {
    const client = serializeSdkKey({ type: "client", keyId: "k1", envId: "e1", orgId: "o1" });
    const server = serializeSdkKey({ type: "server", keyId: "k1", envId: "e1", orgId: "o1" });
    expect(client).not.toBe(server);
  });
});

describe("deserializeSdkKey", () => {
  it("deserializes a valid client key", () => {
    const key = serializeSdkKey({ type: "client", keyId: "k1", envId: "e1", orgId: "o1" });
    expect(deserializeSdkKey(key)).toEqual({ type: "client", keyId: "k1", envId: "e1", orgId: "o1" });
  });

  it("deserializes a valid server key", () => {
    const key = serializeSdkKey({ type: "server", keyId: "k1", envId: "e1", orgId: "o1" });
    expect(deserializeSdkKey(key)).toEqual({ type: "server", keyId: "k1", envId: "e1", orgId: "o1" });
  });

  it("returns undefined for empty string", () => {
    expect(deserializeSdkKey("")).toBeUndefined();
  });

  it("returns undefined for no separator", () => {
    expect(deserializeSdkKey("slcnotseparated")).toBeUndefined();
  });

  it("returns undefined for unknown prefix", () => {
    expect(deserializeSdkKey("xxx_abc")).toBeUndefined();
  });

  it("returns undefined for invalid base64", () => {
    expect(deserializeSdkKey("slc_!!!invalid!!!")).toBeUndefined();
  });

  it("returns undefined for valid base64 but invalid JSON", () => {
    expect(deserializeSdkKey("slc_bm90anNvbg==")).toBeUndefined(); // base64("notjson")
  });

  it("returns undefined for JSON missing required fields", () => {
    const payload = btoa(JSON.stringify({ keyId: "k1" })); // missing envId, orgId
    expect(deserializeSdkKey(`slc_${payload}`)).toBeUndefined();
  });

  it("returns undefined for JSON with non-string fields", () => {
    const payload = btoa(JSON.stringify({ keyId: 123, envId: "e1", orgId: "o1" }));
    expect(deserializeSdkKey(`slc_${payload}`)).toBeUndefined();
  });
});
