import { z } from "zod";
import { requireBackofficeSensitiveAccess } from "@/server/backoffice/authz";
import {
  BackofficeWorkflowError,
  linkBackofficeCaseArtifact
} from "@/server/backoffice/workflows";
import { isPublicHttpsUrl } from "@/server/security/outbound-url";
import { BACKOFFICE_LINK_TYPES } from "@6esk/types/backoffice";

const safeUrlSchema = z.string().trim().url().max(2048).refine(isPublicHttpsUrl, {
  message: "URL must use public https and cannot target localhost or private networks"
});

const r2KeySchema = z.string().trim().min(1).max(500).refine(
  (value) => !value.startsWith("/") && !value.includes("..") && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value),
  { message: "R2 key must be a relative object key without traversal segments" }
);

const linkSchema = z.object({
  tenantId: z.string().uuid().optional(),
  linkType: z.enum(BACKOFFICE_LINK_TYPES),
  label: z.string().min(1).max(160),
  url: safeUrlSchema.optional().nullable(),
  r2Key: r2KeySchema.optional().nullable(),
  metadata: z.record(z.unknown()).optional()
}).refine((value) => value.url || value.r2Key, {
  message: "Either url or r2Key is required",
  path: ["url"]
});

const paramsSchema = z.object({
  caseId: z.string().uuid()
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> }
) {
  const auth = await requireBackofficeSensitiveAccess();
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = linkSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ error: "Invalid route parameters", details: parsedParams.error.issues }, { status: 400 });
  }
  const { caseId } = parsedParams.data;
  try {
    const link = await linkBackofficeCaseArtifact({
      caseId,
      ...parsed.data,
      actorUserId: auth.user.id
    });
    return Response.json({ link }, { status: 201 });
  } catch (error) {
    if (error instanceof BackofficeWorkflowError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  }
}
