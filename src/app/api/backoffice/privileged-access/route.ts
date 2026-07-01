import { z } from "zod";
import {
  createPrivilegedAccessGrant,
  getPrivilegedAccessStats,
  listPrivilegedAccessGrants
} from "@/server/auth/privileged-access";
import { sendPrivilegedAccessAlert } from "@/server/auth/privileged-access-alerts";
import { requireBackofficeSensitiveAccess } from "@/server/backoffice/authz";
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

const tenantIdQuerySchema = z.string().uuid();

function readTenantId(request: Request) {
  return new URL(request.url).searchParams.get("tenantId")?.trim() ?? "";
}

function readLimit(request: Request) {
  const raw = new URL(request.url).searchParams.get("limit");
  const limit = Number(raw ?? 25);
  return Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 25;
}

export async function GET(request: Request) {
  const auth = await requireBackofficeSensitiveAccess(request.headers);
  if (!auth.ok) return auth.response;

  const tenantId = readTenantId(request);
  if (!tenantId) {
    return Response.json({ error: "tenantId is required" }, { status: 400 });
  }
  const parsedTenantId = tenantIdQuerySchema.safeParse(tenantId);
  if (!parsedTenantId.success) {
    return Response.json({ error: "Invalid tenantId", details: parsedTenantId.error.issues }, { status: 400 });
  }

  const scope = { tenantId: parsedTenantId.data, workspaceKey: DEFAULT_WORKSPACE_KEY };
  const [grants, stats] = await Promise.all([
    listPrivilegedAccessGrants(scope, readLimit(request)),
    getPrivilegedAccessStats(scope)
  ]);

  return Response.json({ grants, stats });
}

export async function POST(request: Request) {
  const auth = await requireBackofficeSensitiveAccess(request.headers);
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
