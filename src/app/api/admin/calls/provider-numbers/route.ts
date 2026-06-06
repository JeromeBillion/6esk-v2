import { z } from "zod";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { recordAuditLog } from "@/server/audit";
import { db } from "@/server/db";
import { normalizeCallPhone } from "@/server/calls/service";

const providerNumberSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  provider: z.string().min(1).default("twilio"),
  phoneNumber: z.string().min(3),
  accountSid: z.string().optional().nullable(),
  status: z.enum(["active", "paused", "inactive"]).default("active"),
  metadata: z.record(z.unknown()).optional().nullable()
});

function serializeProviderNumber(row: {
  id: string;
  provider: string;
  phone_number: string;
  account_sid: string | null;
  status: "active" | "paused" | "inactive" | string;
  metadata: Record<string, unknown> | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}) {
  return {
    id: row.id,
    provider: row.provider,
    phoneNumber: row.phone_number,
    accountSid: row.account_sid,
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function GET() {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;
  const { scope } = access;

  const result = await db.query(
    `SELECT id, provider, phone_number, account_sid, status, metadata, created_at, updated_at
     FROM call_provider_numbers
     WHERE tenant_key = $1
       AND workspace_key = $2
     ORDER BY status = 'active' DESC, provider ASC, phone_number ASC, created_at DESC`,
    [scope.tenantKey, scope.workspaceKey]
  );

  return Response.json({ numbers: result.rows.map(serializeProviderNumber) });
}

export async function POST(request: Request) {
  const access = await requireLeadAdminAccess({ requireMfa: true });
  if (!access.ok) return access.response;
  const { user, scope } = access;

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
      const result = await db.query(
        `UPDATE call_provider_numbers
         SET provider = $1,
             phone_number = $2,
             account_sid = $3,
             status = $4,
             metadata = $5::jsonb,
             updated_at = now()
         WHERE id = $6
           AND tenant_key = $7
           AND workspace_key = $8
         RETURNING id, provider, phone_number, account_sid, status, metadata, created_at, updated_at`,
        [
          provider,
          phoneNumber,
          accountSid,
          data.status,
          JSON.stringify(metadata),
          data.id,
          scope.tenantKey,
          scope.workspaceKey
        ]
      );
      const row = result.rows[0];
      if (!row) {
        return Response.json({ error: "Provider number not found" }, { status: 404 });
      }

      await recordAuditLog({
        actorUserId: user?.id ?? null,
        tenantKey: scope.tenantKey,
        workspaceKey: scope.workspaceKey,
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

    const result = await db.query(
      `INSERT INTO call_provider_numbers (
         tenant_key, workspace_key, provider, phone_number, account_sid, status, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id, provider, phone_number, account_sid, status, metadata, created_at, updated_at`,
      [
        scope.tenantKey,
        scope.workspaceKey,
        provider,
        phoneNumber,
        accountSid,
        data.status,
        JSON.stringify(metadata)
      ]
    );
    const row = result.rows[0];

    await recordAuditLog({
      actorUserId: user?.id ?? null,
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
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
  const access = await requireLeadAdminAccess({ requireMfa: true });
  if (!access.ok) return access.response;
  const { user, scope } = access;
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const result = await db.query(
    `UPDATE call_provider_numbers
     SET status = 'inactive',
         updated_at = now()
     WHERE id = $1
       AND tenant_key = $2
       AND workspace_key = $3
     RETURNING id, provider, phone_number, account_sid, status, metadata, created_at, updated_at`,
    [id, scope.tenantKey, scope.workspaceKey]
  );
  const row = result.rows[0];
  if (!row) {
    return Response.json({ error: "Provider number not found" }, { status: 404 });
  }

  await recordAuditLog({
    actorUserId: user?.id ?? null,
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
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
