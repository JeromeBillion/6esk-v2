import { z } from "zod";
import {
  requireBackofficeSensitiveAccess,
  requireBackofficeStaff
} from "@/server/backoffice/authz";
import {
  getTenantBackofficeProfile,
  upsertTenantBackofficeProfile
} from "@/server/backoffice/workflows";
import {
  TENANT_IMPLEMENTATION_STAGES,
  TENANT_RISK_TIERS,
  TENANT_SECURITY_STATUSES
} from "@6esk/types/backoffice";

const profileSchema = z.object({
  accountOwnerUserId: z.string().uuid().optional().nullable(),
  implementationStage: z.enum(TENANT_IMPLEMENTATION_STAGES).optional(),
  riskTier: z.enum(TENANT_RISK_TIERS).optional(),
  securityStatus: z.enum(TENANT_SECURITY_STATUSES).optional(),
  renewalDate: z.string().date().optional().nullable(),
  internalNotes: z.string().max(4000).optional().nullable(),
  metadata: z.record(z.unknown()).optional()
});

const paramsSchema = z.object({
  tenantId: z.string().uuid()
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const auth = await requireBackofficeStaff();
  if (!auth.ok) return auth.response;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ error: "Invalid route parameters", details: parsedParams.error.issues }, { status: 400 });
  }
  const { tenantId } = parsedParams.data;
  const profile = await getTenantBackofficeProfile(tenantId);
  if (!profile) {
    return Response.json({ error: "Backoffice profile not found" }, { status: 404 });
  }
  return Response.json({ profile });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const auth = await requireBackofficeSensitiveAccess();
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = profileSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ error: "Invalid route parameters", details: parsedParams.error.issues }, { status: 400 });
  }
  const { tenantId } = parsedParams.data;
  const profile = await upsertTenantBackofficeProfile({
    tenantId,
    ...parsed.data,
    actorUserId: auth.user.id
  });
  return Response.json({ profile });
}
