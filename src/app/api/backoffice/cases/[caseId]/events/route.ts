import { z } from "zod";
import { requireBackofficeSensitiveAccess } from "@/server/backoffice/authz";
import {
  appendBackofficeCaseEvent,
  BackofficeWorkflowError
} from "@/server/backoffice/workflows";
import { BACKOFFICE_CASE_EVENT_TYPES } from "@6esk/types/backoffice";

const eventSchema = z.object({
  tenantId: z.string().uuid().optional(),
  eventType: z.enum(BACKOFFICE_CASE_EVENT_TYPES).default("note_added"),
  note: z.string().max(2000).optional().nullable(),
  metadata: z.record(z.unknown()).optional()
});

const paramsSchema = z.object({
  caseId: z.string().uuid()
});

export async function POST(
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

  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ error: "Invalid route parameters", details: parsedParams.error.issues }, { status: 400 });
  }
  const { caseId } = parsedParams.data;
  try {
    const event = await appendBackofficeCaseEvent({
      caseId,
      ...parsed.data,
      actorUserId: auth.user.id
    });
    return Response.json({ event }, { status: 201 });
  } catch (error) {
    if (error instanceof BackofficeWorkflowError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}
