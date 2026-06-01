import { z } from "zod";
import { recordAuditLog } from "@/server/audit";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import { tenantScopeFromUser } from "@/server/tenant-context";
import { normalizePublicIngressOriginKey } from "@/server/tenant-public-ingress";

const originSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  origin: z.string().min(3).max(300),
  status: z.enum(["active", "paused", "inactive"]).default("active"),
  verificationStatus: z.enum(["pending", "verified", "failed"]).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable()
});

function readOriginId(request: Request) {
  return new URL(request.url).searchParams.get("id")?.trim() ?? "";
}

function serializeOrigin(row: {
  id: string;
  origin: string;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}) {
  const metadata = row.metadata ?? {};
  return {
    id: row.id,
    origin: row.origin,
    status: row.status,
    verificationStatus:
      typeof metadata.verificationStatus === "string" ? metadata.verificationStatus : "pending",
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function buildMetadata(input: z.infer<typeof originSchema>) {
  return {
    ...(input.metadata ?? {}),
    verificationStatus: input.verificationStatus ?? input.metadata?.verificationStatus ?? "pending"
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const scope = tenantScopeFromUser(user);
  const result = await db.query(
    `SELECT id, origin, status, metadata, created_at, updated_at
     FROM tenant_public_ingress_origins
     WHERE tenant_key = $1
       AND workspace_key = $2
     ORDER BY status = 'active' DESC, origin ASC, created_at DESC`,
    [scope.tenantKey, scope.workspaceKey]
  );

  return Response.json({ origins: result.rows.map(serializeOrigin) });
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

  const parsed = originSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const normalizedOrigin = normalizePublicIngressOriginKey(data.origin);
  if (!normalizedOrigin) {
    return Response.json(
      { error: "Invalid public ingress origin", code: "invalid_public_ingress_origin" },
      { status: 400 }
    );
  }
  const scope = tenantScopeFromUser(user);
  const metadata = buildMetadata(data);

  try {
    if (data.id) {
      const result = await db.query(
        `UPDATE tenant_public_ingress_origins
         SET origin = $1,
             status = $2,
             metadata = $3::jsonb,
             updated_at = now()
         WHERE id = $4
           AND tenant_key = $5
           AND workspace_key = $6
         RETURNING id, origin, status, metadata, created_at, updated_at`,
        [
          normalizedOrigin,
          data.status,
          JSON.stringify(metadata),
          data.id,
          scope.tenantKey,
          scope.workspaceKey
        ]
      );
      const row = result.rows[0];
      if (!row) {
        return Response.json({ error: "Public ingress origin not found" }, { status: 404 });
      }

      await recordAuditLog({
        actorUserId: user?.id ?? null,
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
        action: "tenant_public_ingress_origin_updated",
        entityType: "tenant_public_ingress_origin",
        entityId: row.id,
        data: {
          origin: normalizedOrigin,
          status: data.status,
          verificationStatus: metadata.verificationStatus
        }
      });

      return Response.json({ status: "updated", origin: serializeOrigin(row) });
    }

    const result = await db.query(
      `INSERT INTO tenant_public_ingress_origins (
         tenant_key, workspace_key, origin, status, metadata
       )
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, origin, status, metadata, created_at, updated_at`,
      [scope.tenantKey, scope.workspaceKey, normalizedOrigin, data.status, JSON.stringify(metadata)]
    );
    const row = result.rows[0];

    await recordAuditLog({
      actorUserId: user?.id ?? null,
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      action: "tenant_public_ingress_origin_created",
      entityType: "tenant_public_ingress_origin",
      entityId: row.id,
      data: {
        origin: normalizedOrigin,
        status: data.status,
        verificationStatus: metadata.verificationStatus
      }
    });

    return Response.json({ status: "created", origin: serializeOrigin(row) }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return Response.json(
        {
          error: "An active public ingress origin already belongs to a tenant workspace.",
          code: "public_ingress_origin_conflict"
        },
        { status: 409 }
      );
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = readOriginId(request);
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const scope = tenantScopeFromUser(user);
  const result = await db.query(
    `UPDATE tenant_public_ingress_origins
     SET status = 'inactive',
         updated_at = now()
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3
     RETURNING id, origin, status, metadata, created_at, updated_at`,
    [id, scope.tenantKey, scope.workspaceKey]
  );
  const row = result.rows[0];
  if (!row) {
    return Response.json({ error: "Public ingress origin not found" }, { status: 404 });
  }

  await recordAuditLog({
    actorUserId: user?.id ?? null,
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    action: "tenant_public_ingress_origin_deactivated",
    entityType: "tenant_public_ingress_origin",
    entityId: row.id,
    data: {
      origin: row.origin
    }
  });

  return Response.json({ status: "deactivated", origin: serializeOrigin(row) });
}
