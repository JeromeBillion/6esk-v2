"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import {
  getWorkspaceModules,
  type WorkspaceModuleFlags,
  type WorkspaceModulesConfig
} from "@/app/lib/api/admin";
import { useDemoMode } from "@/app/lib/demo-mode";

export type CustomerReplyChannel = "email" | "whatsapp" | "voice";

export const CUSTOMER_REPLY_CHANNELS = ["email", "whatsapp", "voice"] as const;

const FULL_SUITE_MODULES: WorkspaceModuleFlags = {
  email: true,
  whatsapp: true,
  voice: true,
  aiAutomation: true,
  dexterOrchestration: true,
  vanillaWebchat: true
};

const FULL_SUITE_CONFIG: WorkspaceModulesConfig = {
  workspaceKey: "primary",
  updatedAt: null,
  modules: FULL_SUITE_MODULES
};

export type WorkspaceModuleVisibility = WorkspaceModuleFlags & {
  loaded: boolean;
  demoFullSuite: boolean;
};

type WorkspaceModulesContextValue = {
  config: WorkspaceModulesConfig | null;
  visibility: WorkspaceModuleVisibility;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

const DISABLED_VISIBILITY: WorkspaceModuleVisibility = {
  email: false,
  whatsapp: false,
  voice: false,
  aiAutomation: false,
  dexterOrchestration: false,
  vanillaWebchat: false,
  loaded: false,
  demoFullSuite: false
};

function buildVisibility(
  config: WorkspaceModulesConfig | null,
  demoModeEnabled: boolean
): WorkspaceModuleVisibility {
  if (demoModeEnabled) {
    return {
      ...FULL_SUITE_MODULES,
      loaded: true,
      demoFullSuite: true
    };
  }

  if (!config) {
    return DISABLED_VISIBILITY;
  }

  return {
    ...config.modules,
    loaded: true,
    demoFullSuite: false
  };
}

const WorkspaceModulesContext = createContext<WorkspaceModulesContextValue | null>(null);

export function WorkspaceModulesProvider({ children }: { children: ReactNode }) {
  const { demoModeEnabled } = useDemoMode();
  const [config, setConfig] = useState<WorkspaceModulesConfig | null>(
    demoModeEnabled ? FULL_SUITE_CONFIG : null
  );
  const [loading, setLoading] = useState(!demoModeEnabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (demoModeEnabled) {
      setConfig(FULL_SUITE_CONFIG);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const payload = await getWorkspaceModules();
      setConfig(payload.config);
    } catch (loadError) {
      setConfig(null);
      setError(loadError instanceof Error ? loadError.message : "Workspace modules could not load.");
    } finally {
      setLoading(false);
    }
  }, [demoModeEnabled]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (demoModeEnabled) {
        if (!cancelled) {
          setConfig(FULL_SUITE_CONFIG);
          setLoading(false);
          setError(null);
        }
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const payload = await getWorkspaceModules();
        if (!cancelled) {
          setConfig(payload.config);
        }
      } catch (loadError) {
        if (!cancelled) {
          setConfig(null);
          setError(loadError instanceof Error ? loadError.message : "Workspace modules could not load.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [demoModeEnabled]);

  const visibility = useMemo(
    () => buildVisibility(config, demoModeEnabled),
    [config, demoModeEnabled]
  );

  const value = useMemo(
    () => ({
      config,
      visibility,
      loading,
      error,
      refresh
    }),
    [config, error, loading, refresh, visibility]
  );

  return (
    <WorkspaceModulesContext.Provider value={value}>
      {children}
    </WorkspaceModulesContext.Provider>
  );
}

export function useWorkspaceModules() {
  const context = useContext(WorkspaceModulesContext);
  if (!context) {
    return {
      config: null,
      visibility: DISABLED_VISIBILITY,
      loading: false,
      error: "Workspace module provider is missing.",
      refresh: async () => {}
    } satisfies WorkspaceModulesContextValue;
  }
  return context;
}

export function getEnabledCustomerReplyChannels(visibility: WorkspaceModuleVisibility) {
  return CUSTOMER_REPLY_CHANNELS.filter((channel) => visibility[channel]);
}

export function isCustomerReplyChannel(value: string): value is CustomerReplyChannel {
  return CUSTOMER_REPLY_CHANNELS.includes(value as CustomerReplyChannel);
}
