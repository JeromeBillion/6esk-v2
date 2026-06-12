import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { hasTenantAdminAccess } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { db } from "@/server/db";
import { normalizeCallPhone } from "@/server/calls/service";
import { DEFAULT_WORKSPACE_KEY } from "@/server/workspace-modules";

const providerNumberSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  provider: z.string().min(1).max(80).default("twilio"),
  phoneNumber: z.string().min(3).max(80),
  accountSid: z.string().max(160).optional().nullable(),
  status: z.enum(["active", "paused", "inactive"]).default("active"),
  metadata: z.record(z.unknown()).optional().nullable()
});

type ProviderNumberRow = {
  id: string;
  provider: string;
  phone_number: string;
  account_sid: string | null;
  status: "active" | "paused" | "inactive" | string;
  metadata: Record<string, unknown> | null;
  created_by_user_id: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

async function requireTenantAdmin() {
  const user = await getSessionUser();
  if (!user || !hasTenantAdminAccess(user) || !user.tenant_id) {
    return {
      ok: false as const,
      response: Response.json({ error: "Forbidden" }, { status: 403 })
    };
  }
  return {
    ok: true as const,
    user,
    scope: {
      tenantId: user.tenant_id,
      workspaceKey: DEFAULT_WORKSPACE_KEY
    }
  };
}

function serializeProviderNumber(row: ProviderNumberRow) {
  return {
    id: row.id,
    provider: row.provider,
    phoneNumber: row.phone_number,
    accountSid: row.account_sid,
    status: row.status,
    metadata: row.metadata ?? {},
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function readProviderNumberId(request: Request) {
  return new URL(request.url).searchParams.get("id")?.trim() ?? "";
}

export async function GET() {
  const auth = await requireTenantAdmin();
  if (!auth.ok) return auth.response;

  const result = await db.query<ProviderNumberRow>(
    `SELECT id, provider, phone_number, account_sid, status, metadata,
            created_by_user_id, created_at, updated_at
     FROM call_provider_numbers
     WHERE tenant_id = $1
       AND workspace_key = $2
     ORDER BY status = 'active' DESC, provider ASC, phone_number ASC, created_at DESC`,
    [auth.scope.tenantId, auth.scope.workspaceKey]
  );

  return Response.json({ numbers: result.rows.map(serializeProviderNumber) });
}

export async function POST(request: Request) {
  const auth = await requireTenantAdmin();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = providerNumberSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const provider = data.provider.trim().toLowerCase();
  const phoneNumber = normalizeCallPhone(data.phoneNumber);
  if (!phoneNumber) {
    return Response.json(
      { error: "Invalid phone number", code: "invalid_phone_number" },
      { status: 400 }
    );
  }
  const accountSid = data.accountSid?.trim() || null;
  const metadata = data.metadata ?? {};

  try {
    if (data.id) {
      const result = await db.query<ProviderNumberRow>(
        `UPDATE call_provider_numbers
         SET provider = $1,
             phone_number = $2,
             account_sid = $3,
             status = $4,
             metadata = $5::jsonb,
             updated_at = now()
         WHERE id = $6
           AND tenant_id = $7
           AND workspace_key = $8
         RETURNING id, provider, phone_number, account_sid, status, metadata,
                   created_by_user_id, created_at, updated_at`,
        [
          provider,
          phoneNumber,
          accountSid,
          data.status,
          JSON.stringify(metadata),
          data.id,
          auth.scope.tenantId,
          auth.scope.workspaceKey
        ]
      );
      const row = result.rows[0];
      if (!row) {
        return Response.json({ error: "Provider number not found" }, { status: 404 });
      }

      await recordAuditLog({
        tenantId: auth.scope.tenantId,
        actorUserId: auth.user.id,
        action: "call_provider_number_updated",
        entityType: "call_provider_number",
        entityId: row.id,
        data: {
          provider,
          phoneNumber,
          accountSid,
          status: data.status
        }
      });

      return Response.json({ status: "updated", number: serializeProviderNumber(row) });
    }

    const result = await db.query<ProviderNumberRow>(
      `INSERT INTO call_provider_numbers (
         tenant_id, workspace_key, provider, phone_number, account_sid, status, metadata,
         created_by_user_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING id, provider, phone_number, account_sid, status, metadata,
                 created_by_user_id, created_at, updated_at`,
      [
        auth.scope.tenantId,
        auth.scope.workspaceKey,
        provider,
        phoneNumber,
        accountSid,
        data.status,
        JSON.stringify(metadata),
        auth.user.id
      ]
    );
    const row = result.rows[0];

    await recordAuditLog({
      tenantId: auth.scope.tenantId,
      actorUserId: auth.user.id,
      action: "call_provider_number_created",
      entityType: "call_provider_number",
      entityId: row.id,
      data: {
        provider,
        phoneNumber,
        accountSid,
        status: data.status
      }
    });

    return Response.json({ status: "created", number: serializeProviderNumber(row) }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return Response.json(
        {
          error: "An active provider number with this provider and phone already exists.",
          code: "provider_number_conflict"
        },
        { status: 409 }
      );
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  const auth = await requireTenantAdmin();
  if (!auth.ok) return auth.response;

  const id = readProviderNumberId(request);
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const result = await db.query<ProviderNumberRow>(
    `UPDATE call_provider_numbers
     SET status = 'inactive',
         updated_at = now()
     WHERE id = $1
       AND tenant_id = $2
       AND workspace_key = $3
     RETURNING id, provider, phone_number, account_sid, status, metadata,
               created_by_user_id, created_at, updated_at`,
    [id, auth.scope.tenantId, auth.scope.workspaceKey]
  );
  const row = result.rows[0];
  if (!row) {
    return Response.json({ error: "Provider number not found" }, { status: 404 });
  }

  await recordAuditLog({
    tenantId: auth.scope.tenantId,
    actorUserId: auth.user.id,
    action: "call_provider_number_deactivated",
    entityType: "call_provider_number",
    entityId: row.id,
    data: {
      provider: row.provider,
      phoneNumber: row.phone_number,
      accountSid: row.account_sid
    }
  });

  return Response.json({ status: "deactivated", number: serializeProviderNumber(row) });
}
