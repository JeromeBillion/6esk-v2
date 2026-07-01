import { z } from "zod";
import {
  requireBackofficeSensitiveAccess,
  requireBackofficeStaff
} from "@/server/backoffice/authz";
import {
  BackofficeWorkflowError,
  getBackofficeCase,
  listBackofficeCaseEvents,
  listBackofficeCaseLinks,
  updateBackofficeCase
} from "@/server/backoffice/workflows";
import {
  BACKOFFICE_CASE_PRIORITIES,
  BACKOFFICE_CASE_STATUSES
} from "@6esk/types/backoffice";

const updateSchema = z.object({
  tenantId: z.string().uuid(),
  status: z.enum(BACKOFFICE_CASE_STATUSES).optional(),
  priority: z.enum(BACKOFFICE_CASE_PRIORITIES).optional(),
  title: z.string().min(3).max(200).optional(),
  summary: z.string().max(2000).optional().nullable(),
  ownerUserId: z.string().uuid().optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
  externalReference: z.string().max(160).optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
  note: z.string().max(2000).optional().nullable()
});

const paramsSchema = z.object({
  caseId: z.string().uuid()
});

const getQuerySchema = z.object({
  tenantId: z.string().uuid().optional()
});

function workflowErrorResponse(error: unknown) {
  if (error instanceof BackofficeWorkflowError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  throw error;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const auth = await requireBackofficeStaff(request.headers);
  if (!auth.ok) return auth.response;

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ error: "Invalid route parameters", details: parsedParams.error.issues }, { status: 400 });
  }
  const { caseId } = parsedParams.data;
  const { searchParams } = new URL(request.url);
  const parsedQuery = getQuerySchema.safeParse({
    tenantId: searchParams.get("tenantId") || undefined
  });
  if (!parsedQuery.success) {
    return Response.json({ error: "Invalid query parameters", details: parsedQuery.error.issues }, { status: 400 });
  }
  const { tenantId } = parsedQuery.data;
  try {
    const [backofficeCase, events, links] = await Promise.all([
      getBackofficeCase({ caseId, tenantId }),
      listBackofficeCaseEvents({ caseId, tenantId }),
      listBackofficeCaseLinks({ caseId, tenantId })
    ]);
    if (!backofficeCase) {
      return Response.json({ error: "Backoffice case not found" }, { status: 404 });
    }
    return Response.json({ case: backofficeCase, events, links });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const auth = await requireBackofficeSensitiveAccess(request.headers);
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ error: "Invalid route parameters", details: parsedParams.error.issues }, { status: 400 });
  }
  const { caseId } = parsedParams.data;
  try {
    const backofficeCase = await updateBackofficeCase({
      caseId,
      ...parsed.data,
      actorUserId: auth.user.id
    });
    return Response.json({ case: backofficeCase });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
