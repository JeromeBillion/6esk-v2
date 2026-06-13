import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isInternalStaff } from "@/server/auth/roles";
import {
  createPrivilegedAccessGrant,
  getPrivilegedAccessStats,
  hasPrivilegedMfaSession,
  listPrivilegedAccessGrants
} from "@/server/auth/privileged-access";
import { sendPrivilegedAccessAlert } from "@/server/auth/privileged-access-alerts";
import { recordAuditLog } from "@/server/audit";
import { DEFAULT_WORKSPACE_KEY } from "@/server/workspace-modules";

const createGrantSchema = z.object({
  tenantId: z.string().uuid(),
  accessType: z.enum(["support", "break_glass"]).optional().default("support"),
  subjectUserId: z.string().uuid().optional().nullable(),
  subjectEmail: z.string().email().optional(),
  subjectName: z.string().min(1).max(120).optional().nullable(),
  reason: z.string().trim().min(12).max(1000),
  reference: z.string().trim().min(3).max(240).optional().nullable(),
  requestedDurationMinutes: z.number().int().min(5).max(480).optional().default(60),
  metadata: z.record(z.string(), z.unknown()).optional()
});

function readTenantId(request: Request) {
  return new URL(request.url).searchParams.get("tenantId")?.trim() ?? "";
}

function readLimit(request: Request) {
  const raw = new URL(request.url).searchParams.get("limit");
  const limit = Number(raw ?? 25);
  return Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 25;
}

async function requirePrivilegedStaff() {
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return {
      ok: false as const,
      response: Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 })
    };
  }
  if (!hasPrivilegedMfaSession(user)) {
    return {
      ok: false as const,
      response: Response.json({ error: "MFA is required for privileged access." }, { status: 403 })
    };
  }
  return { ok: true as const, user: user! };
}

export async function GET(request: Request) {
  const auth = await requirePrivilegedStaff();
  if (!auth.ok) return auth.response;

  const tenantId = readTenantId(request);
  if (!tenantId) {
    return Response.json({ error: "tenantId is required" }, { status: 400 });
  }

  const scope = { tenantId, workspaceKey: DEFAULT_WORKSPACE_KEY };
  const [grants, stats] = await Promise.all([
    listPrivilegedAccessGrants(scope, readLimit(request)),
    getPrivilegedAccessStats(scope)
  ]);

  return Response.json({ grants, stats });
}

export async function POST(request: Request) {
  const auth = await requirePrivilegedStaff();
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createGrantSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const subjectEmail = parsed.data.subjectEmail ?? auth.user.email;
    const isSelfRequest = subjectEmail.trim().toLowerCase() === auth.user.email.trim().toLowerCase();
    const grant = await createPrivilegedAccessGrant(
      { tenantId: parsed.data.tenantId, workspaceKey: DEFAULT_WORKSPACE_KEY },
      auth.user.id,
      {
        accessType: parsed.data.accessType,
        subjectUserId: parsed.data.subjectUserId ?? (isSelfRequest ? auth.user.id : null),
        subjectEmail,
        subjectName: parsed.data.subjectName ?? (isSelfRequest ? auth.user.display_name : null),
        reason: parsed.data.reason,
        reference: parsed.data.reference,
        requestedDurationMinutes: parsed.data.requestedDurationMinutes,
        metadata: parsed.data.metadata
      }
    );

    await recordAuditLog({
      tenantId: parsed.data.tenantId,
      actorUserId: auth.user.id,
      action: "privileged_access_grant_requested",
      entityType: "privileged_access_grant",
      entityId: grant.id,
      data: {
        accessType: grant.access_type,
        subjectEmail: grant.subject_email,
        requestedDurationMinutes: grant.requested_duration_minutes,
        reference: grant.reference
      }
    });
    await sendPrivilegedAccessAlert({
      scope: { tenantId: parsed.data.tenantId, workspaceKey: DEFAULT_WORKSPACE_KEY },
      grant,
      event: "requested",
      actorUserId: auth.user.id
    });

    return Response.json({ grant }, { status: 201 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
