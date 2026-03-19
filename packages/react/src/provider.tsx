"use client";

import { init } from "@instantdb/react";
import { deserializeSdkKey, type ConfigBlob } from "@softlaunch/core";
import React, { createContext, useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Context — mutually exclusive states:
//   { isLoading: true,  error: undefined, config: undefined } — fetching
//   { isLoading: false, error: undefined, config: ConfigBlob } — ready
//   { isLoading: false, error: string,    config: undefined } — failed
// ---------------------------------------------------------------------------

export interface SoftlaunchContextValue {
  config: ConfigBlob | undefined;
  isLoading: boolean;
  error: string | undefined;
}

export const SoftlaunchContext = createContext<SoftlaunchContextValue>({
  config: undefined,
  isLoading: true,
  error: undefined,
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function SoftlaunchProvider({ sdkKey, children }: { sdkKey: string; children: React.ReactNode }) {
  const parsed = useMemo(() => deserializeSdkKey(sdkKey), [sdkKey]);

  if (!parsed) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[Softlaunch] Invalid SDK key provided to SoftlaunchProvider");
    }
    return (
      <SoftlaunchContext value={{ config: undefined, isLoading: false, error: "Invalid SDK key" }}>
        {children}
      </SoftlaunchContext>
    );
  }

  return (
    <SoftlaunchConnector key={sdkKey} type={parsed.type} keyId={parsed.keyId} envId={parsed.envId} orgId={parsed.orgId}>
      {children}
    </SoftlaunchConnector>
  );
}

// ---------------------------------------------------------------------------
// Connector — subscribes to $files, fetches blob, provides config via context
//
// State machine:
//   1. InstantDB query loading        → isLoading: true
//   2. Query resolved, no file found  → error: "Config blob not found"
//   3. Query resolved, file found     → fetch URL
//   4. Fetch in-flight                → isLoading: true
//   5. Fetch succeeded                → config set, isLoading: false
//   6. Fetch failed                   → error set, isLoading: false
//   7. URL changes (realtime update)  → re-fetch (back to step 4)
// ---------------------------------------------------------------------------

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; config: ConfigBlob }
  | { status: "error"; error: string };

function SoftlaunchConnector({
  type,
  keyId,
  envId,
  orgId,
  children,
}: {
  type: "client" | "server";
  keyId: string;
  envId: string;
  orgId: string;
  children: React.ReactNode;
}) {
  const blobPath = `configs/${keyId}/${envId}.${type}.json`;
  const db = useMemo(() => init({ appId: orgId }), [orgId]);

  // Subscribe to $files — re-renders when the blob file is added/updated
  const {
    data,
    isLoading: queryLoading,
    error: queryError,
  } = db.useQuery({
    $files: { $: { where: { path: blobPath } } },
  });

  const file = data?.$files?.at(0);
  const fileUrl = file && "url" in file && typeof file.url === "string" ? file.url : undefined;

  // Fetch the config blob from the URL
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  const lastUrlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!fileUrl) return;
    if (fileUrl === lastUrlRef.current && fetchState.status === "success") return;
    lastUrlRef.current = fileUrl;

    let cancelled = false;
    setFetchState({ status: "loading" });

    fetch(fileUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((blob) => {
        if (!cancelled) setFetchState({ status: "success", config: blob as ConfigBlob });
      })
      .catch((err) => {
        if (!cancelled) {
          setFetchState({ status: "error", error: err instanceof Error ? err.message : "Fetch failed" });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  // Derive context value from query + fetch states
  const contextValue = useMemo((): SoftlaunchContextValue => {
    // Query error
    if (queryError) {
      return { config: undefined, isLoading: false, error: queryError.message };
    }

    // Query still loading
    if (queryLoading) {
      return { config: undefined, isLoading: true, error: undefined };
    }

    // Query done but no file exists
    if (!fileUrl) {
      return { config: undefined, isLoading: false, error: "Config blob not found" };
    }

    // Fetch states
    switch (fetchState.status) {
      case "idle":
      case "loading":
        return { config: undefined, isLoading: true, error: undefined };
      case "success":
        return { config: fetchState.config, isLoading: false, error: undefined };
      case "error":
        return { config: undefined, isLoading: false, error: fetchState.error };
    }
  }, [queryLoading, queryError, fileUrl, fetchState]);

  return <SoftlaunchContext value={contextValue}>{children}</SoftlaunchContext>;
}
