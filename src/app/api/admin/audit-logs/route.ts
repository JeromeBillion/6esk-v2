import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import { redactCallData } from "@/server/calls/redaction";

const querySchema = z.object({
  limit: z.number().int().min(1).max(200).optional()
});

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit") ?? "50");
  const parsed = querySchema.safeParse({ limit: limitParam });
  const limit = parsed.success ? parsed.data.limit ?? 50 : 50;

  const result = await db.query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.data, a.created_at,
            u.display_name as actor_name, u.email as actor_email
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     ORDER BY a.created_at DESC
     LIMIT $1`,
    [limit]
  );

  return Response.json({
    logs: result.rows.map((row) => ({
      ...row,
      data: redactCallData(row.data ?? null)
    }))
  });
}
