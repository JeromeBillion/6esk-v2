import { NextRequest } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { hasTenantAdminAccess } from "@/server/auth/roles";
import { requestLogger } from "@/server/logger";
import { getTenantOAuthConnections } from "@/server/oauth/connections";

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Dashboard is only for admins
  if (!hasTenantAdminAccess(session)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const connections = await getTenantOAuthConnections(session.tenant_id);

    // Return sanitized data
    return new Response(JSON.stringify({ connections }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    requestLogger(request, { route: "GET /api/admin/oauth-connections" }).error(
      "OAuth connections dashboard fetch failed",
      {
        error,
        tenantId: session.tenant_id
      }
    );
    return new Response("Internal Server Error", { status: 500 });
  }
}
