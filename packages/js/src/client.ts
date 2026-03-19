import { init } from "@instantdb/core";
import { deserializeSdkKey, evaluateFlag, resolveFlagType, type ConfigBlob } from "@softlaunch/core";
import schema from "./schema";

/** Targeting attributes for flag evaluation. */
export type FlagAttributes = Record<string, string | number | boolean>;

export class SoftlaunchClient {
  private config: ConfigBlob | undefined;
  private db: ReturnType<typeof init>;
  private unsubscribe: (() => void) | undefined;

  private constructor(db: ReturnType<typeof init>) {
    this.db = db;
  }

  /**
   * Initialize the SDK. Fetches the config blob once and resolves.
   * Throws if the SDK key is invalid or the config can't be loaded.
   */
  static async init({ sdkKey }: { sdkKey: string }): Promise<SoftlaunchClient> {
    const parsed = deserializeSdkKey(sdkKey);
    if (!parsed) throw new Error("Invalid SDK key");

    const blobPath = configBlobPath(parsed.keyId, parsed.envId, parsed.type);
    const db = init({ appId: parsed.orgId, schema });
    const client = new SoftlaunchClient(db);

    const config = await new Promise<ConfigBlob>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Config load timed out")), 10_000);

      client.unsubscribe = db.subscribeQuery({ $files: { $: { where: { path: blobPath } } } }, (result) => {
        if (result.error) {
          clearTimeout(timeout);
          reject(new Error(`Failed to load config: ${result.error.message}`));
          return;
        }

        const file = result.data?.$files?.at(0);
        if (!file?.url) return;

        clearTimeout(timeout);
        fetch(file.url)
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          })
          .then((blob) => resolve(blob as ConfigBlob))
          .catch(reject);
      });
    });

    client.config = config;
    client.unsubscribe?.();
    client.unsubscribe = undefined;

    return client;
  }

  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.config = undefined;
  }

  getBooleanFlag(key: string, subjectKey: string, attributes: FlagAttributes, defaultValue: boolean): boolean {
    return this.evaluate(key, subjectKey, attributes, defaultValue, "boolean");
  }

  getStringFlag(key: string, subjectKey: string, attributes: FlagAttributes, defaultValue: string): string {
    return this.evaluate(key, subjectKey, attributes, defaultValue, "string");
  }

  getIntegerFlag(key: string, subjectKey: string, attributes: FlagAttributes, defaultValue: number): number {
    return this.evaluate(key, subjectKey, attributes, defaultValue, "integer");
  }

  getNumericFlag(key: string, subjectKey: string, attributes: FlagAttributes, defaultValue: number): number {
    return this.evaluate(key, subjectKey, attributes, defaultValue, "numeric");
  }

  getJsonFlag<T>(key: string, subjectKey: string, attributes: FlagAttributes, defaultValue: T): T {
    return this.evaluate(key, subjectKey, attributes, defaultValue, "json");
  }

  private evaluate<T>(
    key: string,
    subjectKey: string,
    attributes: FlagAttributes,
    defaultValue: T,
    expectedType: string,
  ): T {
    if (!this.config) return defaultValue;
    const flagType = resolveFlagType(this.config, key);
    if (flagType !== undefined && flagType !== expectedType) return defaultValue;
    return evaluateFlag(this.config, key, subjectKey, attributes, defaultValue).value as T;
  }
}

function configBlobPath(keyId: string, envId: string, type: "client" | "server") {
  return `configs/${keyId}/${envId}.${type}.json`;
}
