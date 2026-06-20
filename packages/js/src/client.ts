import { init as initInstant } from "@instantdb/core";
import {
  deserializeSdkKey,
  evaluateFlag,
  resolveFlagType,
  type ConfigBlob,
  type FlagType,
  type SubjectAttributes,
} from "@softlaunch/core";
import schema from "./schema";

/** Options for creating a Softlaunch client. */
export interface SoftlaunchConfig {
  sdkKey: string;
}

/** Load status of the client's flag config. */
export type SoftlaunchStatus = { state: "initializing" } | { state: "ready" } | { state: "error"; error: string };

/**
 * Create a Softlaunch client and begin loading the flag config in the background.
 *
 * Flag reads work immediately, returning the supplied default until the config
 * is ready. The client stays subscribed and updates in real time when flags
 * change — call `subscribe` to react to updates. Throws if the SDK key is malformed.
 */
export function init(config: SoftlaunchConfig): SoftlaunchClient {
  return new SoftlaunchClient(config.sdkKey);
}

export class SoftlaunchClient {
  private config: ConfigBlob | undefined;
  private status: SoftlaunchStatus = { state: "initializing" };
  private readonly unsubscribeDb: () => void;
  private readonly listeners = new Set<() => void>();
  private readyResolvers: Array<() => void> = [];
  private lastUrl: string | undefined;
  private fetchToken = 0;

  constructor(sdkKey: string) {
    const parsed = deserializeSdkKey(sdkKey);
    if (!parsed) throw new Error("Invalid Softlaunch SDK key");

    const blobPath = `configs/${parsed.keyId}/${parsed.envId}.${parsed.type}.json`;
    const db = initInstant({ appId: parsed.orgId, schema });

    // Subscribe to the config blob's $files metadata. InstantDB pushes a new
    // signed URL whenever the blob is recompiled, which we then re-fetch.
    this.unsubscribeDb = db.subscribeQuery({ $files: { $: { where: { path: blobPath } } } }, (result) => {
      if (result.error) {
        this.fail(result.error.message);
        return;
      }
      const url = result.data?.$files?.at(0)?.url;
      if (!url) {
        this.fail("Config blob not found");
        return;
      }
      if (url === this.lastUrl) return;
      this.lastUrl = url;
      void this.fetchConfig(url);
    });
  }

  // ---------------------------------------------------------------------------
  // Flag evaluation — synchronous. Returns the default until the config loads,
  // or when the flag's actual type doesn't match the requested type.
  // ---------------------------------------------------------------------------

  getBooleanFlag(flagKey: string, subjectKey: string, attributes: SubjectAttributes, defaultValue: boolean): boolean {
    return this.evaluate(flagKey, subjectKey, attributes, defaultValue, "boolean");
  }

  getStringFlag(flagKey: string, subjectKey: string, attributes: SubjectAttributes, defaultValue: string): string {
    return this.evaluate(flagKey, subjectKey, attributes, defaultValue, "string");
  }

  getIntegerFlag(flagKey: string, subjectKey: string, attributes: SubjectAttributes, defaultValue: number): number {
    return this.evaluate(flagKey, subjectKey, attributes, defaultValue, "integer");
  }

  getNumericFlag(flagKey: string, subjectKey: string, attributes: SubjectAttributes, defaultValue: number): number {
    return this.evaluate(flagKey, subjectKey, attributes, defaultValue, "numeric");
  }

  getJsonFlag<T>(flagKey: string, subjectKey: string, attributes: SubjectAttributes, defaultValue: T): T {
    return this.evaluate(flagKey, subjectKey, attributes, defaultValue, "json");
  }

  // ---------------------------------------------------------------------------
  // Lifecycle + real-time updates
  // ---------------------------------------------------------------------------

  /** The current config load status. */
  getStatus(): SoftlaunchStatus {
    return this.status;
  }

  /** Resolves once the config has loaded. Resolves immediately if already ready. */
  waitUntilReady(): Promise<void> {
    if (this.status.state === "ready") return Promise.resolve();
    return new Promise((resolve) => {
      this.readyResolvers.push(resolve);
    });
  }

  /**
   * Subscribe to config changes. The listener fires whenever flag values may
   * have changed (config loaded, updated, or errored) — re-read with the
   * `get*Flag` methods. Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Tear down the real-time subscription and release resources. */
  close(): void {
    this.unsubscribeDb();
    this.listeners.clear();
    this.readyResolvers = [];
    this.config = undefined;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private evaluate<T>(
    flagKey: string,
    subjectKey: string,
    attributes: SubjectAttributes,
    defaultValue: T,
    expectedType: FlagType,
  ): T {
    if (!this.config) return defaultValue;
    const flagType = resolveFlagType(this.config, flagKey);
    if (flagType !== undefined && flagType !== expectedType) return defaultValue;
    return evaluateFlag(this.config, flagKey, subjectKey, attributes, defaultValue).value;
  }

  private async fetchConfig(url: string): Promise<void> {
    const token = ++this.fetchToken;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = (await response.json()) as ConfigBlob;
      if (token !== this.fetchToken) return; // a newer fetch superseded this one
      this.config = blob;
      this.setStatus({ state: "ready" });
      this.notify();
    } catch (error) {
      if (token !== this.fetchToken) return;
      this.fail(error instanceof Error ? error.message : "Failed to load config");
    }
  }

  /** Record a load failure. Keeps serving the previous config if one exists (stale but usable). */
  private fail(error: string): void {
    if (this.config) return; // already have a usable config — ignore transient errors
    this.setStatus({ state: "error", error });
    this.notify();
  }

  private setStatus(status: SoftlaunchStatus): void {
    this.status = status;
    if (status.state === "ready") {
      const resolvers = this.readyResolvers;
      this.readyResolvers = [];
      for (const resolve of resolvers) resolve();
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
