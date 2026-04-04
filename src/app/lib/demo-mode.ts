"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEMO_MODE_COOKIE_NAME,
  DEMO_MODE_EVENT,
  DEMO_MODE_STORAGE_KEY,
  parseDemoModeValue,
  parseDemoQueryValue,
  serializeDemoModeValue
} from "@/app/lib/demo-mode-config";

function defaultDemoModeEnabled() {
  return process.env.NODE_ENV !== "production";
}

function readCookieDemoMode() {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${DEMO_MODE_COOKIE_NAME}=`));
  return parseDemoModeValue(match ? decodeURIComponent(match.split("=")[1] ?? "") : null);
}

function readQueryDemoMode() {
  if (typeof window === "undefined") return null;
  return parseDemoQueryValue(new URLSearchParams(window.location.search).get("demo"));
}

export function readStoredDemoMode() {
  if (typeof window === "undefined") return null;
  return parseDemoModeValue(window.localStorage.getItem(DEMO_MODE_STORAGE_KEY));
}

export function isDemoModeEnabled() {
  if (typeof window === "undefined") return false;
  return readQueryDemoMode() ?? readStoredDemoMode() ?? readCookieDemoMode() ?? defaultDemoModeEnabled();
}

export function setStoredDemoMode(enabled: boolean) {
  if (typeof window === "undefined") return;
  const value = serializeDemoModeValue(enabled);
  window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, value);
  document.cookie = `${DEMO_MODE_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  window.dispatchEvent(
    new CustomEvent<boolean>(DEMO_MODE_EVENT, {
      detail: enabled
    })
  );
}

export function useDemoMode() {
  const [demoModeEnabled, setDemoModeEnabledState] = useState(() => isDemoModeEnabled());

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
