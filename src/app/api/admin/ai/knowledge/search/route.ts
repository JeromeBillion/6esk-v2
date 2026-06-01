import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { KnowledgeUploadError, retrieveKnowledge } from "@/server/ai/knowledge-base";
import { tenantScopeFromUser } from "@/server/tenant-context";

const searchSchema = z.object({
  query: z.string().min(1).max(1000),
  limit: z.number().int().min(1).max(20).optional()
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = searchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const scope = tenantScopeFromUser(user);
    const results = await retrieveKnowledge({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      query: parsed.data.query,
      limit: parsed.data.limit,
      metadata: {
        requestedByUserId: user?.id ?? null,
        route: "/api/admin/ai/knowledge/search"
      }
    });
    return Response.json({ results });
  } catch (error) {
    if (error instanceof KnowledgeUploadError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}
