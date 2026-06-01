import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { runKnowledgeRetentionSweep } from "@/server/ai/knowledge-base";
import { tenantScopeFromUser } from "@/server/tenant-context";

const retentionRunSchema = z.object({
  limit: z.number().int().min(1).max(500).optional()
});

function parseLimit(request: Request) {
  const url = new URL(request.url);
  const raw = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  if (Number.isNaN(raw)) return 100;
  return Math.min(Math.max(raw, 1), 500);
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await runKnowledgeRetentionSweep(tenantScopeFromUser(user), {
    dryRun: true,
    limit: parseLimit(request)
  });
  return Response.json({ result });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const parsed = retentionRunSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const result = await runKnowledgeRetentionSweep(tenantScopeFromUser(user), {
    dryRun: false,
    limit: parsed.data.limit,
    actorUserId: user?.id ?? null
  });
  return Response.json({ status: "completed", result });
}
