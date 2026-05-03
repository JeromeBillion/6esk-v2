import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isInternalStaff } from "@/server/auth/roles";
import { listTenants, provisionTenant } from "@/server/tenant/lifecycle";
import type { TenantStatus } from "@/server/tenant/types";

const listSchema = z.object({
  status: z.enum(["active", "suspended", "closed"]).optional(),
  limit: z.coerce.number().min(1).max(500).optional().default(100)
});

const provisionSchema = z.object({
  slug: z.string().min(3).max(64).regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
  displayName: z.string().min(1).max(100),
  plan: z.string().optional()
});

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const rawStatus = searchParams.get("status");
  const rawLimit = searchParams.get("limit");

  const parsed = listSchema.safeParse({
    status: rawStatus || undefined,
    limit: rawLimit || undefined
  });

  if (!parsed.success) {
    return Response.json({ error: "Invalid query parameters" }, { status: 400 });
  }

  const tenants = await listTenants({
    status: parsed.data.status as TenantStatus | undefined,
    limit: parsed.data.limit
  });

  return Response.json({ tenants });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isInternalStaff(user)) {
    return Response.json({ error: "Forbidden. 6esk Staff only." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = provisionSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenant = await provisionTenant({
      slug: parsed.data.slug,
      displayName: parsed.data.displayName,
      plan: parsed.data.plan,
      actorUserId: user?.id
    });
    return Response.json({ tenant }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("duplicate key value")) {
      return Response.json({ error: "Tenant slug already exists" }, { status: 409 });
    }
    throw error;
  }
}
