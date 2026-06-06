import { db } from "@/server/db";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";

export async function GET() {
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const result = await db.query(
    `SELECT id, name, description
     FROM roles
     ORDER BY name`
  );

  return Response.json({ roles: result.rows });
}
