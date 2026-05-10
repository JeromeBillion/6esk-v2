import { NextRequest } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { hasTenantAdminAccess } from "@/server/auth/roles";
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
    console.error("[OAuth Dashboard] Failed to fetch connections:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
