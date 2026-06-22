import { getSessionUser } from "@/server/auth/session";
import { isInternalStaff } from "@/server/auth/roles";
import { getMarginSnapshot, getTenantMarginSnapshot } from "@/server/billing/margin";
import { z } from "zod";

const querySchema = z.object({
  tenantId: z.string().uuid().optional(),
  windowDays: z.coerce.number().min(1).max(90).optional()
});

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 });
  }
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    tenantId: url.searchParams.get("tenantId") || undefined,
    windowDays: url.searchParams.get("windowDays") || undefined
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid query parameters", details: parsed.error.issues }, { status: 400 });
  }

  const snapshot = parsed.data.tenantId
    ? await getTenantMarginSnapshot({
        tenantId: parsed.data.tenantId,
        windowDays: parsed.data.windowDays
      })
    : await getMarginSnapshot({ windowDays: parsed.data.windowDays });
  return Response.json(snapshot);
}
