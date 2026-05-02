import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
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
  dexterOrchestration: z.boolean(),
  vanillaWebchat: z.boolean()
});

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = await getWorkspaceModules();
  return Response.json({ config });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

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

  const config = await saveWorkspaceModules(parsed.data as WorkspaceModuleFlags);
  await recordAuditLog({
    actorUserId: user?.id ?? null,
    action: "workspace_modules_updated",
    entityType: "workspace_modules",
    entityId: config.workspaceKey,
    data: config.modules
  });

  return Response.json({ status: "updated", config });
}
