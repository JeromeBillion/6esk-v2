import { getMarginSnapshot, getTenantMarginSnapshot } from "@/server/billing/margin";
import { requireBackofficeStaff } from "@/server/backoffice/authz";
import { z } from "zod";

const querySchema = z.object({
  tenantId: z.string().uuid().optional(),
  windowDays: z.coerce.number().min(1).max(90).optional()
});

export async function GET(request: Request) {
  const auth = await requireBackofficeStaff(request.headers);
  if (!auth.ok) return auth.response;

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
