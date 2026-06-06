import { z } from "zod";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import {
  getWorkspaceModules,
  saveWorkspaceModules,
  type WorkspaceModuleFlags
} from "@/server/workspace-modules";

const modulesSchema = z.object({
  email: z.boolean(),
  whatsapp: z.boolean(),
  voice: z.boolean(),
  aiAutomation: z.boolean(),
  vanillaWebchat: z.boolean()
});

export async function GET() {
  const auth = await requireLeadAdminAccess();
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  const config = await getWorkspaceModules(scope.workspaceKey, scope.tenantKey);
  return Response.json({ config });
}

export async function POST(request: Request) {
  const auth = await requireLeadAdminAccess({ requireMfa: true });
  if (!auth.ok) return auth.response;
  const { user, scope } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = modulesSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const config = await saveWorkspaceModules(
    parsed.data as WorkspaceModuleFlags,
    scope.workspaceKey,
    scope.tenantKey
  );
  await recordAuditLog({
    actorUserId: user?.id ?? null,
    action: "workspace_modules_updated",
    entityType: "workspace_modules",
    entityId: config.workspaceKey,
    data: config.modules
  });

  return Response.json({ status: "updated", config });
}
