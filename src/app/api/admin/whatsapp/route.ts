import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { db } from "@/server/db";
import { decryptSecret, encryptSecret } from "@/server/agents/secret";

const payloadSchema = z.object({
  provider: z.string().min(1),
  phoneNumber: z.string().min(3),
  wabaId: z.string().optional().nullable(),
  accessToken: z.string().optional().nullable(),
  verifyToken: z.string().optional().nullable(),
  status: z.enum(["active", "paused", "inactive"]).optional()
});

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await db.query(
    `SELECT id, provider, phone_number, waba_id, access_token, verify_token, status, created_at, updated_at
     FROM whatsapp_accounts
     ORDER BY created_at DESC
     LIMIT 1`
  );

  const account = result.rows[0] ?? null;
  if (!account) {
    return Response.json({ account: null });
  }

  return Response.json({
    account: {
      id: account.id,
      provider: account.provider,
      phoneNumber: account.phone_number,
      wabaId: account.waba_id,
      accessToken: account.access_token ? decryptSecret(account.access_token) : "",
      verifyToken: account.verify_token ?? "",
      status: account.status,
      createdAt: account.created_at,
      updatedAt: account.updated_at
    }
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const data = parsed.data;
  const existing = await db.query(
    `SELECT id FROM whatsapp_accounts ORDER BY created_at DESC LIMIT 1`
  );
  const existingId = existing.rows[0]?.id ?? null;
  const status = data.status ?? "inactive";
  const storedToken = data.accessToken ? encryptSecret(data.accessToken) : null;

  let accountId = existingId;
  if (existingId) {
    await db.query(
      `UPDATE whatsapp_accounts
       SET provider = $1,
           phone_number = $2,
           waba_id = $3,
           access_token = $4,
           verify_token = $5,
           status = $6,
           updated_at = now()
       WHERE id = $7`,
      [
        data.provider,
        data.phoneNumber,
        data.wabaId ?? null,
        storedToken,
        data.verifyToken ?? null,
        status,
        existingId
      ]
    );
  } else {
    const insert = await db.query<{ id: string }>(
      `INSERT INTO whatsapp_accounts (provider, phone_number, waba_id, access_token, verify_token, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        data.provider,
        data.phoneNumber,
        data.wabaId ?? null,
        storedToken,
        data.verifyToken ?? null,
        status
      ]
    );
    accountId = insert.rows[0].id;
  }

  await recordAuditLog({
    actorUserId: user?.id ?? null,
    action: existingId ? "whatsapp_account_updated" : "whatsapp_account_created",
    entityType: "whatsapp_account",
    entityId: accountId ?? undefined
  });

  return Response.json({ status: "saved", id: accountId });
}
