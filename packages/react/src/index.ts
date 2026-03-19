/**
 * @softlaunch/react
 *
 * React SDK for Softlaunch feature flags.
 * Real-time: config blob updates push through InstantDB subscriptions.
 *
 *   <SoftlaunchProvider sdkKey="slc_...">
 *     <App />
 *   </SoftlaunchProvider>
 *
 *   const { value, isLoading } = useBooleanFlag("show-dashboard", "user-123", { plan: "pro" }, false)
 */

export { SoftlaunchProvider } from "./provider";
export { useBooleanFlag, useIntegerFlag, useJsonFlag, useNumericFlag, useStringFlag } from "./hooks";
export type { FlagResult } from "./hooks";
export type { SubjectAttributes } from "@softlaunch/core";
