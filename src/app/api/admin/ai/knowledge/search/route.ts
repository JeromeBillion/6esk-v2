import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { retrievePublishedKnowledge } from "@/server/ai/knowledge-retrieval";

const searchSchema = z
  .object({
    query: z.string().trim().min(2).max(500),
    folderIds: z.array(z.string().uuid()).max(50).optional(),
    limit: z.number().int().min(1).max(12).optional(),
    queryPurpose: z.string().trim().min(1).max(80).optional(),
    excludeUnsafeContent: z.boolean().optional()
  })
  .strict();

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || !isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = searchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const result = await retrievePublishedKnowledge({
    tenantId: user.tenant_id,
    actorUserId: user.id,
    query: parsed.data.query,
    folderIds: parsed.data.folderIds ?? [],
    limit: parsed.data.limit ?? 6,
    queryPurpose: parsed.data.queryPurpose ?? "admin_test",
    excludeUnsafeContent: parsed.data.excludeUnsafeContent ?? false
  });

  return Response.json(result);
}
