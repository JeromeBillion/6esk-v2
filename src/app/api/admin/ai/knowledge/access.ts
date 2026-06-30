import { isLeadAdmin } from "@/server/auth/roles";
import { getSessionUser, type SessionUser } from "@/server/auth/session";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { checkModuleEntitlement } from "@/server/tenant/module-guard";

export type KnowledgeAdminAccess = {
  user: SessionUser;
  tenantId: string;
};

function moduleDisabledResponse() {
  return Response.json(
    {
      error: "AI automation module is disabled for this tenant.",
      code: "module_disabled",
      module: "aiAutomation"
    },
    { status: 409 }
  );
}

export async function requireKnowledgeBaseAdminAccess(): Promise<
  | { ok: true; access: KnowledgeAdminAccess }
  | { ok: false; response: Response }
> {
  const user = await getSessionUser();
  if (!user || !isLeadAdmin(user)) {
    return { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const moduleEnabled = await checkModuleEntitlement("aiAutomation", tenantId);
  if (!moduleEnabled) {
    return { ok: false, response: moduleDisabledResponse() };
  }

  return {
    ok: true,
    access: { user, tenantId }
  };
}

export async function requireKnowledgeBaseTenantModule(tenantId: string | null | undefined) {
  const scopedTenantId = tenantId?.trim();
  if (!scopedTenantId) {
    return { ok: false as const, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const moduleEnabled = await checkModuleEntitlement("aiAutomation", scopedTenantId);
  if (!moduleEnabled) {
    return { ok: false as const, response: moduleDisabledResponse() };
  }

  return { ok: true as const, tenantId: scopedTenantId };
}
