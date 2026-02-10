import { z } from "zod";
import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { canManageTickets } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";

const payloadSchema = z.object({
  to: z.string().min(3),
  text: z.string().optional(),
  template: z
    .object({
      name: z.string(),
      language: z.string(),
      components: z.array(z.record(z.unknown())).optional()
    })
    .optional()
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
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

  const accountResult = await db.query(
    `SELECT id, status FROM whatsapp_accounts ORDER BY created_at DESC LIMIT 1`
  );
  const account = accountResult.rows[0];
  if (!account || account.status !== "active") {
    return Response.json({ error: "WhatsApp account not configured" }, { status: 409 });
  }

  await db.query(
    `INSERT INTO whatsapp_events (direction, payload, status)
     VALUES ($1, $2, $3)`,
    ["outbound", parsed.data, "queued"]
  );

  await recordAuditLog({
    actorUserId: user.id,
    action: "whatsapp_send_queued",
    entityType: "whatsapp",
    data: { to: parsed.data.to }
  });

  return Response.json({ status: "queued" });
}
