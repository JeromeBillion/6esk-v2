import { z } from "zod";
import { requireLeadAdminAccess } from "@/server/auth/admin-guard";
import { runKnowledgeRetentionSweep } from "@/server/ai/knowledge-base";

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
  const access = await requireLeadAdminAccess();
  if (!access.ok) return access.response;

  const result = await runKnowledgeRetentionSweep(access.scope, {
    dryRun: true,
    limit: parseLimit(request)
  });
  return Response.json({ result });
}

export async function POST(request: Request) {
  const access = await requireLeadAdminAccess({ requireMfa: true });
  if (!access.ok) return access.response;
  const { user, scope } = access;

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

  const result = await runKnowledgeRetentionSweep(scope, {
    dryRun: false,
    limit: parsed.data.limit,
    actorUserId: user?.id ?? null
  });
  return Response.json({ status: "completed", result });
}
