"use client";

import { useCallback, useEffect, useState } from "react";

export const DEMO_MODE_STORAGE_KEY = "sixesk:data-mode";
export const DEMO_MODE_EVENT = "sixesk:demo-mode-change";

function defaultDemoModeEnabled() {
  return process.env.NODE_ENV !== "production";
}

function parseStoredValue(value: string | null) {
  if (value === "sample") return true;
  if (value === "live") return false;
  return null;
}

export function readStoredDemoMode() {
  if (typeof window === "undefined") return null;
  return parseStoredValue(window.localStorage.getItem(DEMO_MODE_STORAGE_KEY));
}

export function isDemoModeEnabled() {
  if (typeof window === "undefined") return false;
  return readStoredDemoMode() ?? defaultDemoModeEnabled();
}

export function setStoredDemoMode(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, enabled ? "sample" : "live");
  window.dispatchEvent(
    new CustomEvent<boolean>(DEMO_MODE_EVENT, {
      detail: enabled
    })
  );
}

export function useDemoMode() {
  const [demoModeEnabled, setDemoModeEnabledState] = useState(false);

  useEffect(() => {
    setDemoModeEnabledState(isDemoModeEnabled());
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== DEMO_MODE_STORAGE_KEY) return;
      setDemoModeEnabledState(isDemoModeEnabled());
    };

    const handleCustomEvent = (event: Event) => {
      const detail = (event as CustomEvent<boolean>).detail;
      if (typeof detail === "boolean") {
        setDemoModeEnabledState(detail);
        return;
      }
      setDemoModeEnabledState(isDemoModeEnabled());
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(DEMO_MODE_EVENT, handleCustomEvent);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(DEMO_MODE_EVENT, handleCustomEvent);
    };
  }, []);

  const setDemoModeEnabled = useCallback((enabled: boolean) => {
    setDemoModeEnabledState(enabled);
    setStoredDemoMode(enabled);
  }, []);

  return {
    demoModeEnabled,
    setDemoModeEnabled
  };
}
