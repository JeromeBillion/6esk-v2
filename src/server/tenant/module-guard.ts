import { NextResponse } from "next/server";
import { isWorkspaceModuleEnabled, type WorkspaceModuleKey } from "@/server/workspace-modules";
import { getTenantContext } from "@/server/tenant/context";
import { DEFAULT_TENANT_ID } from "@/server/tenant/types";
import { logger } from "@/server/logger";

/**
 * Checks if the given module is enabled for the current tenant context.
 * Useful for inline checks within route handlers.
 */
export async function checkModuleEntitlement(
  moduleKey: WorkspaceModuleKey,
  tenantId?: string | null
): Promise<boolean> {
  let effectiveTenantId = tenantId ?? DEFAULT_TENANT_ID;
  if (!tenantId) {
    try {
      const ctx = await getTenantContext();
      if (ctx?.tenantId) {
        effectiveTenantId = ctx.tenantId;
      }
    } catch (error) {
      // If we're not in a request context (e.g., background worker), fallback to default
      logger.warn("Tenant context unavailable, using default", { error, moduleKey });
    }
  }
  return isWorkspaceModuleEnabled(moduleKey, "primary", effectiveTenantId);
}

/**
 * Higher-Order function to wrap Next.js API route handlers with module entitlement checks.
 * Rejects the request with a 403 Forbidden if the required module is disabled.
 */
export function withModuleEntitlement(
  moduleKey: WorkspaceModuleKey | WorkspaceModuleKey[],
  handler: (req: Request, context: any) => Promise<Response> | Response
) {
  return async (req: Request, context: any) => {
    const keys = Array.isArray(moduleKey) ? moduleKey : [moduleKey];
    for (const key of keys) {
      const isEnabled = await checkModuleEntitlement(key);
      if (!isEnabled) {
        return NextResponse.json(
          { error: `Forbidden: module '${key}' is disabled.` },
          { status: 403 }
        );
      }
    }
    return handler(req, context);
  };
}
