import { canManageTickets } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { tenantScopeFromUser } from "@/server/tenant-context";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 100);

  if (!query) {
    return Response.json({ customers: [] });
  }

  const like = `%${query}%`;
  const scope = tenantScopeFromUser(user);
  const result = await db.query<{
    id: string;
    kind: "registered" | "unregistered";
    display_name: string | null;
    primary_email: string | null;
    primary_phone: string | null;
    external_system: string | null;
    external_user_id: string | null;
    active_ticket_count: string;
    identities: Array<{ type: "email" | "phone"; value: string; isPrimary: boolean }>;
  }>(
    `SELECT
       c.id,
       c.kind,
       c.display_name,
       c.primary_email,
       c.primary_phone,
       c.external_system,
       c.external_user_id,
       COUNT(DISTINCT t.id)::text AS active_ticket_count,
       COALESCE(
         json_agg(
           json_build_object(
             'type', ci.identity_type,
             'value', ci.identity_value,
             'isPrimary', ci.is_primary
           )
         ) FILTER (WHERE ci.id IS NOT NULL),
         '[]'
       ) AS identities
     FROM customers c
     LEFT JOIN customer_identities ci ON ci.customer_id = c.id AND ci.tenant_key = c.tenant_key
     LEFT JOIN tickets t ON t.customer_id = c.id AND t.tenant_key = c.tenant_key AND t.merged_into_ticket_id IS NULL
     WHERE c.tenant_key = $1
       AND c.merged_into_customer_id IS NULL
       AND (
         c.id::text ILIKE $2 OR
         c.display_name ILIKE $2 OR
         c.primary_email ILIKE $2 OR
         c.primary_phone ILIKE $2 OR
         c.external_user_id ILIKE $2 OR
         EXISTS (
           SELECT 1
           FROM customer_identities ciq
           WHERE ciq.customer_id = c.id
             AND ciq.tenant_key = c.tenant_key
             AND ciq.identity_value ILIKE $2
         )
       )
     GROUP BY c.id
     ORDER BY
       MAX(COALESCE(t.updated_at, t.created_at)) DESC NULLS LAST,
       c.updated_at DESC
     LIMIT $3`,
    [scope.tenantKey, like, limit]
  );

  return Response.json({
    customers: result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      displayName: row.display_name,
      primaryEmail: row.primary_email,
      primaryPhone: row.primary_phone,
      externalSystem: row.external_system,
      externalUserId: row.external_user_id,
      activeTicketCount: Number(row.active_ticket_count) || 0,
      identities: row.identities ?? []
    }))
  });
}
