import { z } from "zod";
import {
  requireBackofficeSensitiveAccess,
  requireBackofficeStaff
} from "@/server/backoffice/authz";
import {
  createBackofficeCase,
  listBackofficeCases
} from "@/server/backoffice/workflows";
import {
  BACKOFFICE_CASE_PRIORITIES,
  BACKOFFICE_CASE_STATUSES,
  BACKOFFICE_CASE_TYPES
} from "@6esk/types/backoffice";

const querySchema = z.object({
  tenantId: z.string().uuid().optional(),
  status: z.enum(BACKOFFICE_CASE_STATUSES).optional(),
  caseType: z.enum(BACKOFFICE_CASE_TYPES).optional(),
  limit: z.coerce.number().min(1).max(200).optional().default(50)
});

const createSchema = z.object({
  tenantId: z.string().uuid(),
  caseType: z.enum(BACKOFFICE_CASE_TYPES),
  title: z.string().min(3).max(200),
  summary: z.string().max(2000).optional().nullable(),
  priority: z.enum(BACKOFFICE_CASE_PRIORITIES).optional(),
  ownerUserId: z.string().uuid().optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  externalReference: z.string().max(160).optional().nullable(),
  metadata: z.record(z.unknown()).optional()
});

export async function GET(request: Request) {
  const auth = await requireBackofficeStaff();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    tenantId: searchParams.get("tenantId") || undefined,
    status: searchParams.get("status") || undefined,
    caseType: searchParams.get("caseType") || undefined,
    limit: searchParams.get("limit") || undefined
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid query parameters", details: parsed.error.issues }, { status: 400 });
  }

  const cases = await listBackofficeCases(parsed.data);
  return Response.json({ cases });
}

export async function POST(request: Request) {
  const auth = await requireBackofficeSensitiveAccess();
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
  }

  const backofficeCase = await createBackofficeCase({
    ...parsed.data,
    actorUserId: auth.user.id
  });
  return Response.json({ case: backofficeCase }, { status: 201 });
}
