/**
 * @softlaunch/js
 *
 * Vanilla JavaScript SDK for Softlaunch feature flags.
 * Fetch-once: init() loads config, get*Flag() evaluates locally.
 *
 *   const client = await SoftlaunchClient.init({ sdkKey: "slc_..." })
 *   const show = client.getBooleanFlag("show-dashboard", "user-123", { plan: "pro" }, false)
 *   client.destroy()
 */

export { SoftlaunchClient } from "./client";
export type { FlagAttributes } from "./client";
