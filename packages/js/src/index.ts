/**
 * @softlaunch/js
 *
 * Vanilla JavaScript SDK for Softlaunch feature flags. Real-time: the client
 * stays subscribed and updates its config when flags change.
 *
 *   import { init } from "@softlaunch/js";
 *
 *   const client = init({ sdkKey: "slc_..." });
 *   await client.waitUntilReady();
 *
 *   const showCheckout = client.getBooleanFlag("checkout-redesign", "user-123", { plan: "pro" }, false);
 *
 *   // React to flag changes in real time
 *   const unsubscribe = client.subscribe(() => {
 *     render(client.getBooleanFlag("checkout-redesign", "user-123", { plan: "pro" }, false));
 *   });
 *
 *   client.close();
 */

export { init } from "./client";
export type { SoftlaunchClient, SoftlaunchConfig, SoftlaunchStatus } from "./client";
export type { SubjectAttributes } from "@softlaunch/core";
