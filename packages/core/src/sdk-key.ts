/**
 * @module sdk-key
 *
 * SDK key serialization/deserialization. Part of the wire format — every SDK
 * must be able to deserialize these keys to extract routing info.
 *
 * Format: slc_<base64 JSON> (client) or sls_<base64 JSON> (server)
 *
 * SDKs deserialize the key to determine:
 *   - orgId → which Instant app to connect to
 *   - envId → which config blob to fetch (configs/{envId}.client.json)
 *   - keyId → for rotation/revocation tracking
 */

import { base64Decode, base64Encode } from "./hash";

interface DeserializedSdkKey {
  type: "client" | "server";
  keyId: string;
  envId: string;
  orgId: string;
}

function typeToPrefix(type: "client" | "server") {
  switch (type) {
    case "client":
      return "slc";
    case "server":
      return "sls";
  }
}

function prefixToType(prefix: string) {
  switch (prefix) {
    case "slc":
      return "client" as const;
    case "sls":
      return "server" as const;
    default:
      return undefined;
  }
}

function isValidPayload(json: unknown): json is { keyId: string; envId: string; orgId: string } {
  return (
    typeof json === "object" &&
    json !== null &&
    "keyId" in json &&
    typeof json.keyId === "string" &&
    "envId" in json &&
    typeof json.envId === "string" &&
    "orgId" in json &&
    typeof json.orgId === "string"
  );
}

export function serializeSdkKey({ type, keyId, envId, orgId }: DeserializedSdkKey) {
  return `${typeToPrefix(type)}_${base64Encode(JSON.stringify({ keyId, envId, orgId }))}`;
}

export function deserializeSdkKey(key: string): DeserializedSdkKey | undefined {
  const separatorIndex = key.indexOf("_");
  if (separatorIndex === -1) return undefined;

  const type = prefixToType(key.slice(0, separatorIndex));
  if (!type) return undefined;

  try {
    const json = JSON.parse(base64Decode(key.slice(separatorIndex + 1)));
    if (!isValidPayload(json)) return undefined;
    return { type, keyId: json.keyId, envId: json.envId, orgId: json.orgId };
  } catch {
    return undefined;
  }
}
