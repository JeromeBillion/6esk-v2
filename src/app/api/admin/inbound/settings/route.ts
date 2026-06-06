import { z } from "zod";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import {
  getInboundAlertConfig,
  saveInboundAlertConfig
} from "@/server/email/inbound-alert-config";

const settingsSchema = z.object({
  webhookUrl: z.union([z.string().url(), z.literal("")]),
  threshold: z.number().int().min(1).max(1000),
  windowMinutes: z.number().int().min(1).max(24 * 60),
  cooldownMinutes: z.number().int().min(1).max(24 * 7 * 60)
});

export async function GET() {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const { scope } = access;
  const config = await getInboundAlertConfig(scope);
  return Response.json({ config });
}

export async function POST(request: Request) {
  const access = await requireLeadAdminAccess({ requireMfa: true });
  if (!access.ok) return access.response;
  const { user, scope } = access;

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const config = await saveInboundAlertConfig(parsed.data, scope);
  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "inbound_alert_config_updated",
    entityType: "inbound_alert_config",
    data: {
      webhookConfigured: Boolean(config.webhookUrl),
      threshold: config.threshold,
      windowMinutes: config.windowMinutes,
      cooldownMinutes: config.cooldownMinutes
    }
  });

  return Response.json({ status: "updated", config });
}
